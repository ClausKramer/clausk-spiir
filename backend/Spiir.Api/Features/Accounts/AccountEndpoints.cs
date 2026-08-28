using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Mvc;
using Spiir.Api.Data.Repositories;
using Spiir.Api.Domain.Entities;
using Spiir.Api.Features.Categorization;
using Spiir.Api.Infrastructure.CsvImport;
using Spiir.Api.Infrastructure.EnableBanking;
using Spiir.Api.Services;

namespace Spiir.Api.Features.Accounts;

public static class AccountEndpoints
{
    public static IEndpointRouteBuilder MapAccountEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/accounts").WithTags("Accounts").RequireAuthorization();
        var institutions = app.MapGroup("/institutions").WithTags("Institutions").RequireAuthorization();

        institutions.MapGet("/", GetInstitutions);

        group.MapGet("/", ListAccounts);
        group.MapPost("/connect", ConnectBank);
        group.MapPost("/finalize", FinalizeConnection);
        group.MapPatch("/{id:guid}", RenameAccount);
        // Antiforgery protection (CSRF via ambient cookies) doesn't apply here — this endpoint is
        // authenticated by a Bearer token the browser never sends automatically, so there's no
        // ambient credential for a third-party site to ride on. DisableAntiforgery() opts out of
        // ASP.NET Core's default requirement that any form-binding endpoint go through antiforgery
        // middleware, which this app doesn't otherwise need and hasn't configured.
        group.MapPost("/{id:guid}/import-csv", ImportCsv).DisableAntiforgery();
        group.MapDelete("/{id:guid}", DeleteAccount);

        return app;
    }

    private static async Task<IResult> GetInstitutions(
        IEnableBankingClient eb,
        string country = "DK",
        CancellationToken ct = default)
    {
        try
        {
            var list = await eb.GetAspspsAsync(country, ct);
            return TypedResults.Ok(list.Select(a => new { a.Name, a.Country, a.Bic, a.Logo }));
        }
        catch (Exception ex)
        {
            return TypedResults.Problem($"Enable Banking error: {ex.Message}", statusCode: 502);
        }
    }

    private static async Task<IResult> ListAccounts(
        BankAccountRepository bankAccounts,
        ICurrentUser currentUser,
        CancellationToken ct)
    {
        var userId = currentUser.GetRequiredUserId();
        var accounts = await bankAccounts.GetAllForUserAsync(userId, ct);
        return TypedResults.Ok(accounts.Select(a => new
        {
            a.Id,
            a.ExternalAccountId,
            a.Name,
            a.Iban,
            a.Currency,
            a.LastSyncedAt,
            a.CreatedAt,
        }));
    }

    private static async Task<IResult> ConnectBank(
        [FromBody] ConnectBankRequest req,
        IEnableBankingClient eb,
        RequisitionRepository requisitions,
        ICurrentUser currentUser,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.AspspName) || string.IsNullOrWhiteSpace(req.AspspCountry))
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                ["aspspName"] = ["AspspName and aspspCountry are required."]
            });

        var reference = Guid.NewGuid().ToString("N");
        string url;
        try
        {
            url = await eb.StartAuthorizationAsync(req.AspspName, req.AspspCountry, reference, ct);
        }
        catch (Exception ex)
        {
            return TypedResults.Problem($"Enable Banking error: {ex.Message}", statusCode: 502);
        }

        var userId = currentUser.GetRequiredUserId();
        await requisitions.InsertAsync(new Requisition
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Reference = reference,
            AspspName = req.AspspName,
            AspspCountry = req.AspspCountry,
            Status = RequisitionStatus.Pending,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        }, ct);

        return TypedResults.Ok(new { url, reference });
    }

    private static async Task<IResult> FinalizeConnection(
        [FromBody] FinalizeRequest req,
        IEnableBankingClient eb,
        RequisitionRepository requisitions,
        BankAccountRepository bankAccounts,
        ICurrentUser currentUser,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.Ref) || string.IsNullOrWhiteSpace(req.Code))
            return TypedResults.BadRequest(new { error = "ref and code are required." });

        var userId = currentUser.GetRequiredUserId();
        var requisition = await requisitions.GetPendingByReferenceAsync(userId, req.Ref, ct);

        if (requisition is null)
            return TypedResults.NotFound(new { error = "Requisition not found or already processed." });

        EnableBankingSession session;
        try
        {
            session = await eb.CreateSessionAsync(req.Code, ct);
        }
        catch (Exception ex)
        {
            await requisitions.UpdateStatusAsync(requisition.Id, RequisitionStatus.Failed, DateTime.UtcNow, ct);
            return TypedResults.Problem($"Enable Banking error: {ex.Message}", statusCode: 502);
        }

        var now = DateTime.UtcNow;
        var created = new List<object>();

        foreach (var ebAccount in session.Accounts)
        {
            var existing = await bankAccounts.ExistsByExternalIdAsync(userId, ebAccount.Uid, ct);
            if (existing) continue;

            var account = new BankAccount
            {
                Id = Guid.NewGuid(),
                UserId = userId,
                ExternalAccountId = ebAccount.Uid,
                Iban = ebAccount.Iban,
                Name = ebAccount.Name ?? ebAccount.Iban ?? ebAccount.Uid,
                Currency = ebAccount.Currency,
                CreatedAt = now,
            };
            await bankAccounts.InsertAsync(account, ct);
            created.Add(new { account.Id, account.Name, account.Iban, account.Currency });
        }

        await requisitions.UpdateStatusAsync(requisition.Id, RequisitionStatus.Linked, now, ct);

        return TypedResults.Ok(new { accounts = created, count = created.Count });
    }

    private static async Task<IResult> RenameAccount(
        Guid id,
        [FromBody] RenameAccountRequest req,
        BankAccountRepository bankAccounts,
        ICurrentUser currentUser,
        CancellationToken ct)
    {
        var name = req.Name?.Trim();
        if (string.IsNullOrWhiteSpace(name))
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                ["name"] = ["Name is required."]
            });

        var userId = currentUser.GetRequiredUserId();
        var renamed = await bankAccounts.RenameAsync(userId, id, name, ct);
        return renamed ? TypedResults.NoContent() : TypedResults.NotFound();
    }

    private static async Task<IResult> ImportCsv(
        Guid id,
        IFormFile file,
        BankAccountRepository bankAccounts,
        TransactionRepository transactions,
        CategoryRepository categories,
        ICategorizationEngine categorizer,
        ICurrentUser currentUser,
        CancellationToken ct)
    {
        if (file is null || file.Length == 0)
            return TypedResults.BadRequest(new { error = "No file uploaded." });
        if (file.Length > 5 * 1024 * 1024)
            return TypedResults.BadRequest(new { error = "File is too large (max 5 MB)." });

        var userId = currentUser.GetRequiredUserId();
        var account = await bankAccounts.GetByIdAsync(userId, id, ct);
        if (account is null)
            return TypedResults.NotFound(new { error = "Account not found." });

        string content;
        using (var reader = new StreamReader(file.OpenReadStream(), Encoding.UTF8, detectEncodingFromByteOrderMarks: true))
            content = await reader.ReadToEndAsync(ct);

        var parsed = TransactionCsvParser.Parse(content);
        if (parsed.Rows.Count == 0)
            return TypedResults.BadRequest(new { error = "No importable rows found.", details = parsed.Errors });

        // Dedup against both what's already stored and other rows within this same file — Add()
        // returning false covers both cases, since a match either way means "already accounted for".
        var externalIds = await transactions.GetExistingExternalIdsAsync(userId, id, ct);
        var userCategories = await categories.GetAllForUserAsync(userId, ct);
        var categoriesByName = userCategories.ToDictionary(c => c.Name, c => c.Id, StringComparer.OrdinalIgnoreCase);

        var now = DateTime.UtcNow;
        var imported = 0;
        var skipped = 0;

        foreach (var row in parsed.Rows)
        {
            var externalId = CsvExternalId(row);
            if (!externalIds.Add(externalId)) { skipped++; continue; }

            Guid? categoryId;
            bool isCategoryManual;
            if (row.CategoryName is not null && categoriesByName.TryGetValue(row.CategoryName, out var matchedId))
            {
                categoryId = matchedId;
                isCategoryManual = true;
            }
            else
            {
                categoryId = await categorizer.CategorizeAsync(row.Description, userId, ct);
                isCategoryManual = false;
            }

            await transactions.InsertAsync(new Transaction
            {
                Id = Guid.NewGuid(),
                UserId = userId,
                BankAccountId = id,
                ExternalTransactionId = externalId,
                BookingDate = row.BookingDate,
                Amount = row.Amount,
                Currency = account.Currency,
                Description = row.Description,
                CategoryId = categoryId,
                IsCategoryManual = isCategoryManual,
                CreatedAt = now,
            }, ct);
            imported++;
        }

        return TypedResults.Ok(new
        {
            imported,
            skipped,
            errors = parsed.Errors,
            message = $"Imported {imported} transaction(s), skipped {skipped} duplicate(s).",
        });
    }

    // Deterministic per (date, amount, description) so re-uploading the same file is idempotent —
    // CSV rows have no bank-assigned id to dedup on the way synced transactions do. Prefixed to
    // keep this id space distinct from anything a real bank could ever hand back.
    private static string CsvExternalId(ParsedCsvRow row)
    {
        var raw = $"{row.BookingDate:O}|{row.Amount}|{row.Description}";
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(raw))).ToLowerInvariant();
        return $"csv:{hash[..32]}";
    }

    private static async Task<IResult> DeleteAccount(
        Guid id,
        BankAccountRepository bankAccounts,
        ICurrentUser currentUser,
        CancellationToken ct)
    {
        var userId = currentUser.GetRequiredUserId();
        var deleted = await bankAccounts.DeleteAsync(userId, id, ct);
        return deleted ? TypedResults.NoContent() : TypedResults.NotFound();
    }
}

public record ConnectBankRequest(string AspspName, string AspspCountry);
public record FinalizeRequest(string Ref, string Code);
public record RenameAccountRequest(string Name);

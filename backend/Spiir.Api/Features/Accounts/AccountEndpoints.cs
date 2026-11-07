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
        group.MapPost("/{id:guid}/refresh-balance", RefreshBalance);
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
            // The bank's own figure, with everything needed to say how much to trust it: which
            // balance it is, the date it describes and when it was read. The client needs all
            // three — a balance shown as a bare number is a claim about now that it can't support.
            a.Balance,
            a.BalanceCurrency,
            a.BalanceType,
            a.BalanceReferenceDate,
            a.BalanceFetchedAt,
        }));
    }

    // An explicit, account-holder-initiated balance read.
    //
    // Sync fetches balances on a 12-hour clock to stay inside the PSD2 cap on *unattended* AISP
    // access (see SyncEndpoints). This endpoint exists because that cap is about polling without
    // the customer present: when the account holder asks for their balance, the request is
    // attended, so it is not rationed the same way and doesn't need the gap.
    private static async Task<IResult> RefreshBalance(
        Guid id,
        BankAccountRepository bankAccounts,
        IEnableBankingClient eb,
        ICurrentUser currentUser,
        CancellationToken ct)
    {
        var userId = currentUser.GetRequiredUserId();
        var account = await bankAccounts.GetByIdAsync(userId, id, ct);
        if (account is null) return TypedResults.NotFound();

        EnableBankingBalance? balance;
        try
        {
            balance = await eb.GetBalanceAsync(account.ExternalAccountId, ct);
        }
        catch (Exception ex)
        {
            // Consent lapses after 90 days and the bank then refuses the read. Saying so beats a
            // bare 502, because the fix is to reconnect the account rather than to retry.
            return TypedResults.Problem(
                $"Could not read the balance from the bank: {ex.Message} "
                + "If the account's consent has expired, reconnect it and try again.",
                statusCode: 502);
        }

        if (balance is null)
            return TypedResults.Problem(
                "The bank reported no balance for this account.", statusCode: 502);

        var now = DateTime.UtcNow;
        await bankAccounts.UpdateBalanceAsync(
            userId, id, balance.Amount, balance.Currency,
            balance.BalanceType, balance.ReferenceDate, now, ct);

        return TypedResults.Ok(new
        {
            balance = balance.Amount,
            balanceCurrency = balance.Currency,
            balanceType = balance.BalanceType,
            isBooked = balance.IsBooked,
            balanceReferenceDate = balance.ReferenceDate,
            balanceFetchedAt = now,
        });
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

        using var buffer = new MemoryStream();
        await file.OpenReadStream().CopyToAsync(buffer, ct);
        var content = DecodeCsv(buffer.ToArray());

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

        // Rows to actually import, resolved first so the whole file can be categorized in one
        // batch rather than a rules pass (and possible Claude call) per row.
        //
        // Identical rows within a file are counted rather than collapsed: buying the same thing
        // twice at the same merchant on the same day is a real pattern (two scooter passes, two
        // app-store charges), and keying only on date+amount+description silently dropped those.
        // Including the occurrence index keeps re-importing the same file idempotent — the same
        // rows land on the same indexes — while letting genuine repeats through.
        var occurrences = new Dictionary<string, int>();
        var toImport = new List<(int Index, ParsedCsvRow Row, string ExternalId)>();
        for (var i = 0; i < parsed.Rows.Count; i++)
        {
            var row = parsed.Rows[i];
            var rowKey = $"{row.BookingDate:O}|{row.Amount}|{row.Description}";
            var occurrence = occurrences.TryGetValue(rowKey, out var seen) ? seen : 0;
            occurrences[rowKey] = occurrence + 1;

            var externalId = CsvExternalId(row, occurrence);
            if (!externalIds.Add(externalId)) { skipped++; continue; }
            toImport.Add((i, row, externalId));
        }

        var needsCategorizing = toImport
            .Where(x => x.Row.CategoryName is null || !categoriesByName.ContainsKey(x.Row.CategoryName))
            .Select(x => x.Row.Description)
            .ToList();
        var categoryByDescription = await categorizer.CategorizeManyAsync(needsCategorizing, userId, ct);

        foreach (var (i, row, externalId) in toImport)
        {
            Guid? categoryId;
            bool isCategoryManual;
            if (row.CategoryName is not null && categoriesByName.TryGetValue(row.CategoryName, out var matchedId))
            {
                categoryId = matchedId;
                isCategoryManual = true;
            }
            else
            {
                categoryId = categoryByDescription.TryGetValue(row.Description, out var autoId) ? autoId : null;
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
                // Nudged by row position so rows sharing a BookingDate (same-day transactions in
                // one file) still get a meaningful, stable secondary sort order instead of all
                // landing on the exact same instant and leaving ties to an arbitrary tiebreaker.
                CreatedAt = now.AddTicks(i),
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

    // Danish bank exports are frequently Latin-1 rather than UTF-8 (Danske Bank's are), where a
    // lone 0xF8 byte is 'ø'. Decoded as UTF-8 that's an invalid sequence and silently becomes
    // U+FFFD, which turns the "Beløb" header into "Bel�b" — the amount column then doesn't match
    // any known alias and the whole file is rejected as unparseable. So: honour a BOM if present,
    // otherwise try strict UTF-8 and fall back to Latin-1 when the bytes aren't valid UTF-8.
    private static string DecodeCsv(byte[] bytes)
    {
        if (bytes.Length >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF)
            return Encoding.UTF8.GetString(bytes, 3, bytes.Length - 3);

        try
        {
            return new UTF8Encoding(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true).GetString(bytes);
        }
        catch (DecoderFallbackException)
        {
            return Encoding.Latin1.GetString(bytes);
        }
    }

    // Deterministic per (date, amount, description, occurrence) so re-uploading the same file is
    // idempotent — CSV rows have no bank-assigned id to dedup on the way synced transactions do.
    // Prefixed to keep this id space distinct from anything a real bank could ever hand back.
    private static string CsvExternalId(ParsedCsvRow row, int occurrence)
    {
        var raw = $"{row.BookingDate:O}|{row.Amount}|{row.Description}|{occurrence}";
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

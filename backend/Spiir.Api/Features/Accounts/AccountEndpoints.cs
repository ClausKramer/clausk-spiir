using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Spiir.Api.Data;
using Spiir.Api.Domain.Entities;
using Spiir.Api.Infrastructure.GoCardless;
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
        group.MapDelete("/{id:guid}", DeleteAccount);

        return app;
    }

    private static async Task<IResult> GetInstitutions(
        IGoCardlessClient gc,
        string country = "DK",
        CancellationToken ct = default)
    {
        try
        {
            var list = await gc.GetInstitutionsAsync(country, ct);
            return TypedResults.Ok(list.Select(i => new { i.Id, i.Name, i.Bic, i.Logo }));
        }
        catch (Exception ex)
        {
            return TypedResults.Problem($"GoCardless error: {ex.Message}", statusCode: 502);
        }
    }

    private static async Task<IResult> ListAccounts(
        AppDbContext db,
        CancellationToken ct)
    {
        var accounts = await db.BankAccounts
            .Select(a => new
            {
                a.Id,
                a.GoCardlessAccountId,
                a.Name,
                a.Iban,
                a.Currency,
                a.LastSyncedAt,
                a.CreatedAt,
            })
            .ToListAsync(ct);
        return TypedResults.Ok(accounts);
    }

    private static async Task<IResult> ConnectBank(
        [FromBody] ConnectBankRequest req,
        IGoCardlessClient gc,
        AppDbContext db,
        ICurrentUser currentUser,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.InstitutionId))
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                ["institutionId"] = ["InstitutionId is required."]
            });

        var reference = Guid.NewGuid().ToString("N");
        RequisitionDto gcReq;
        try
        {
            gcReq = await gc.CreateRequisitionAsync(req.InstitutionId, reference, ct);
        }
        catch (Exception ex)
        {
            return TypedResults.Problem($"GoCardless error: {ex.Message}", statusCode: 502);
        }

        var userId = currentUser.GetRequiredUserId();
        db.Requisitions.Add(new Requisition
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            GoCardlessRequisitionId = gcReq.Id,
            Reference = reference,
            InstitutionId = req.InstitutionId,
            Status = RequisitionStatus.Pending,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync(ct);

        return TypedResults.Ok(new { link = gcReq.Link, reference });
    }

    private static async Task<IResult> FinalizeConnection(
        [FromBody] FinalizeRequest req,
        IGoCardlessClient gc,
        AppDbContext db,
        ICurrentUser currentUser,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.Ref))
            return TypedResults.BadRequest(new { error = "ref is required." });

        var userId = currentUser.GetRequiredUserId();
        var requisition = await db.Requisitions
            .FirstOrDefaultAsync(r => r.Reference == req.Ref && r.Status == RequisitionStatus.Pending, ct);

        if (requisition is null)
            return TypedResults.NotFound(new { error = "Requisition not found or already processed." });

        IReadOnlyList<GoCardlessAccount> gcAccounts;
        try
        {
            gcAccounts = await gc.GetAccountsAsync(requisition.GoCardlessRequisitionId, ct);
        }
        catch (Exception ex)
        {
            requisition.Status = RequisitionStatus.Failed;
            requisition.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);
            return TypedResults.Problem($"GoCardless error: {ex.Message}", statusCode: 502);
        }

        var now = DateTime.UtcNow;
        var created = new List<object>();

        foreach (var gcAccount in gcAccounts)
        {
            var existing = await db.BankAccounts
                .IgnoreQueryFilters()
                .AnyAsync(a => a.UserId == userId && a.GoCardlessAccountId == gcAccount.Id, ct);

            if (existing) continue;

            var account = new BankAccount
            {
                Id = Guid.NewGuid(),
                UserId = userId,
                GoCardlessAccountId = gcAccount.Id,
                Iban = gcAccount.Iban,
                Name = gcAccount.Name ?? gcAccount.Iban ?? gcAccount.Id,
                Currency = gcAccount.Currency,
                CreatedAt = now,
            };
            db.BankAccounts.Add(account);
            created.Add(new { account.Id, account.Name, account.Iban, account.Currency });
        }

        requisition.Status = RequisitionStatus.Linked;
        requisition.UpdatedAt = now;
        await db.SaveChangesAsync(ct);

        return TypedResults.Ok(new { accounts = created, count = created.Count });
    }

    private static async Task<IResult> DeleteAccount(
        Guid id,
        AppDbContext db,
        CancellationToken ct)
    {
        var account = await db.BankAccounts.FindAsync([id], ct);
        if (account is null) return TypedResults.NotFound();
        db.BankAccounts.Remove(account);
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }
}

public record ConnectBankRequest(string InstitutionId);
public record FinalizeRequest(string Ref);

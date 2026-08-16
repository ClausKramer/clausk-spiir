using Spiir.Api.Data.Repositories;
using Spiir.Api.Domain.Entities;
using Spiir.Api.Features.Categorization;
using Spiir.Api.Infrastructure.GoCardless;
using Spiir.Api.Services;

namespace Spiir.Api.Features.Sync;

public static class SyncEndpoints
{
    // GoCardless allows ~4 calls/day per account. We enforce a minimum gap between syncs.
    private static readonly TimeSpan MinSyncGap = TimeSpan.FromHours(5);

    public static IEndpointRouteBuilder MapSyncEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/sync").WithTags("Sync").RequireAuthorization();
        group.MapPost("/", SyncAll);
        return app;
    }

    private static async Task<IResult> SyncAll(
        BankAccountRepository bankAccounts,
        TransactionRepository transactions,
        IGoCardlessClient gc,
        ICategorizationEngine categorizer,
        ICurrentUser currentUser,
        ILoggerFactory loggerFactory,
        CancellationToken ct)
    {
        var userId = currentUser.GetRequiredUserId();
        var accounts = await bankAccounts.GetAllForUserAsync(userId, ct);
        if (accounts.Count == 0)
            return TypedResults.Ok(new { message = "No bank accounts to sync.", synced = 0, skipped = 0, newTransactions = 0 });

        var logger = loggerFactory.CreateLogger("Sync");
        var now = DateTime.UtcNow;
        int synced = 0, skipped = 0, totalNew = 0;

        foreach (var account in accounts)
        {
            if (account.LastSyncedAt.HasValue && now - account.LastSyncedAt.Value < MinSyncGap)
            {
                logger.LogInformation("Skipping account {Id} (synced {Ago:0}m ago)", account.Id,
                    (now - account.LastSyncedAt.Value).TotalMinutes);
                skipped++;
                continue;
            }

            try
            {
                // Fetch from earliest unsynced date (or last 90 days on first sync)
                DateOnly? dateFrom = account.LastSyncedAt.HasValue
                    ? DateOnly.FromDateTime(account.LastSyncedAt.Value.AddDays(-1))
                    : DateOnly.FromDateTime(now.AddDays(-90));

                var gcTransactions = await gc.GetTransactionsAsync(account.GoCardlessAccountId, dateFrom, ct);
                logger.LogInformation("Fetched {Count} transactions for account {Id}", gcTransactions.Count, account.Id);

                // Load existing IDs to avoid duplicates
                var existingIds = await transactions.GetExistingGoCardlessIdsAsync(userId, account.Id, ct);

                var newTx = gcTransactions
                    .Where(t => !existingIds.Contains(t.TransactionId))
                    .ToList();

                foreach (var t in newTx)
                {
                    var categoryId = await categorizer.CategorizeAsync(t.Description, userId, ct);
                    await transactions.InsertAsync(new Transaction
                    {
                        Id = Guid.NewGuid(),
                        UserId = userId,
                        BankAccountId = account.Id,
                        GoCardlessTransactionId = t.TransactionId,
                        BookingDate = t.BookingDate,
                        Amount = t.Amount,
                        Currency = t.Currency,
                        Description = t.Description,
                        CategoryId = categoryId,
                        IsCategoryManual = false,
                        CreatedAt = now,
                    }, ct);
                }

                await bankAccounts.UpdateLastSyncedAtAsync(userId, account.Id, now, ct);

                totalNew += newTx.Count;
                synced++;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to sync account {Id}", account.Id);
            }
        }

        return TypedResults.Ok(new
        {
            synced,
            skipped,
            newTransactions = totalNew,
            message = $"Synced {synced} account(s), added {totalNew} transaction(s).",
        });
    }
}

using Spiir.Api.Data.Repositories;
using Spiir.Api.Domain.Entities;
using Spiir.Api.Features.Categorization;
using Spiir.Api.Infrastructure.EnableBanking;
using Spiir.Api.Services;

namespace Spiir.Api.Features.Sync;

public static class SyncEndpoints
{
    // PSD2 RTS on strong customer authentication caps AISP polling at ~4 calls/day per account
    // without customer interaction. We enforce a minimum gap between syncs to stay under that.
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
        IEnableBankingClient eb,
        ICategorizationEngine categorizer,
        ICurrentUser currentUser,
        ILoggerFactory loggerFactory,
        bool fullHistory = false,
        CancellationToken ct = default)
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
            // The RTS cap applies to *unattended* polling; a full-history fetch is an explicit
            // user action, so the gap doesn't apply and would otherwise just block it.
            if (!fullHistory && account.LastSyncedAt.HasValue && now - account.LastSyncedAt.Value < MinSyncGap)
            {
                logger.LogInformation("Skipping account {Id} (synced {Ago:0}m ago)", account.Id,
                    (now - account.LastSyncedAt.Value).TotalMinutes);
                skipped++;
                continue;
            }

            try
            {
                // First sync asks for the longest history the bank will give rather than a fixed
                // window — a hardcoded 90 days silently truncated everything older, and banks
                // typically only expose full history for a short period after consent is granted,
                // so a too-small first request loses data that can't be re-fetched later.
                // Subsequent syncs just need what's happened since, with a day of overlap for
                // transactions that settled late (dedup on ExternalTransactionId handles the rest).
                // fullHistory forces the same path for an already-synced account, since accounts
                // synced under the old fixed-window behaviour are missing everything before it.
                var wantLongest = fullHistory || !account.LastSyncedAt.HasValue;
                DateOnly? dateFrom = wantLongest
                    ? null
                    : DateOnly.FromDateTime(account.LastSyncedAt!.Value.AddDays(-1));

                var ebTransactions = await eb.GetTransactionsAsync(
                    account.ExternalAccountId, dateFrom, longestHistory: wantLongest, ct);
                logger.LogInformation("Fetched {Count} transactions for account {Id}", ebTransactions.Count, account.Id);

                // Load existing IDs to avoid duplicates
                var existingIds = await transactions.GetExistingExternalIdsAsync(userId, account.Id, ct);

                var newTx = ebTransactions
                    .Where(t => !existingIds.Contains(t.TransactionId))
                    .ToList();

                // Categorize the whole batch up front — one pass over the rules per distinct
                // merchant, and at most a handful of Claude calls, instead of per transaction.
                var categoryByDescription = await categorizer.CategorizeManyAsync(
                    newTx.Select(t => t.Description).ToList(), userId, ct);

                foreach (var t in newTx)
                {
                    await transactions.InsertAsync(new Transaction
                    {
                        Id = Guid.NewGuid(),
                        UserId = userId,
                        BankAccountId = account.Id,
                        ExternalTransactionId = t.TransactionId,
                        BookingDate = t.BookingDate,
                        Amount = t.Amount,
                        Currency = t.Currency,
                        Description = t.Description,
                        CategoryId = categoryByDescription.TryGetValue(t.Description, out var categoryId) ? categoryId : null,
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

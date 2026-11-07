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

    // Reading a balance is a second AISP access, charged against the same daily cap as the
    // transaction fetch beside it, so it deliberately runs on a slower clock than the sync: at
    // this gap a sync costs two accesses twice a day and one access the rest of the time, instead
    // of doubling every sync's cost. A balance that is a few hours stale is still worth far more
    // than the running transaction sum it replaces, and the account page can always ask for a
    // fresh one — that request comes from the account holder, so the unattended cap doesn't bind.
    private static readonly TimeSpan MinBalanceGap = TimeSpan.FromHours(12);

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
        int synced = 0, skipped = 0, totalNew = 0, balancesUpdated = 0;

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

                // Best-effort and in its own try: the transactions above are already committed, so
                // letting a balance failure escape would skip the LastSyncedAt write and make the
                // next sync re-fetch everything it just imported.
                if (!account.BalanceFetchedAt.HasValue || now - account.BalanceFetchedAt.Value >= MinBalanceGap)
                {
                    try
                    {
                        var balance = await eb.GetBalanceAsync(account.ExternalAccountId, ct);
                        if (balance is not null)
                        {
                            await bankAccounts.UpdateBalanceAsync(
                                userId, account.Id, balance.Amount, balance.Currency,
                                balance.BalanceType, balance.ReferenceDate, now, ct);
                            balancesUpdated++;
                        }
                    }
                    catch (Exception ex)
                    {
                        // The last balance we stored stays as it is, with its own timestamp saying
                        // how old it is. Overwriting it with nothing would turn a stale figure into
                        // no figure, which is worse.
                        logger.LogWarning(ex, "Failed to read balance for account {Id}", account.Id);
                    }
                }
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to sync account {Id}", account.Id);
            }
        }

        // Run after every sync, not once: the settled twin of a planned payment can arrive in any
        // later sync, and only then does the planned copy become identifiable as superseded.
        var excludedPlanned = await transactions.ExcludeSupersededPlannedCopiesAsync(userId, ct);
        if (excludedPlanned > 0)
            logger.LogInformation("Excluded {Count} planned entries superseded by their settled copy.", excludedPlanned);

        return TypedResults.Ok(new
        {
            synced,
            skipped,
            newTransactions = totalNew,
            balancesUpdated,
            excludedPlanned,
            message = $"Synced {synced} account(s), added {totalNew} transaction(s)."
                      + (excludedPlanned > 0 ? $" Excluded {excludedPlanned} planned payment(s) now settled." : ""),
        });
    }
}

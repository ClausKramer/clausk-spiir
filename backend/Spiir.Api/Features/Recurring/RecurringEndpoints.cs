using Spiir.Api.Data.Repositories;
using Spiir.Api.Features.Transactions;
using Spiir.Api.Services;

namespace Spiir.Api.Features.Recurring;

public static class RecurringEndpoints
{
    // How far back detection looks. Long enough to establish a yearly cadence (needs one full
    // repeat) without scanning a user's entire history on every request.
    private const int LookbackMonths = 13;

    public static IEndpointRouteBuilder MapRecurringEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/recurring").WithTags("Recurring").RequireAuthorization();

        group.MapGet("/", GetRecurring);
        group.MapGet("/dismissed", GetDismissed);
        group.MapPost("/{merchantKey}/dismiss", Dismiss);
        group.MapPost("/{merchantKey}/undismiss", Undismiss);

        return app;
    }

    private static DateOnly Today => DateOnly.FromDateTime(DateTime.UtcNow);

    // The one place bills are detected, so the recurring page, the month outlook and the
    // "bills" filter on the transaction query can never disagree about what counts as one.
    // windowEnd is exclusive: detection looks at the LookbackMonths before it.
    internal static async Task<(IReadOnlyList<RecurringSeries> Series, HashSet<string> Keys)> LoadRecurringAsync(
        TransactionRepository transactions,
        RecurringDismissalRepository dismissals,
        Guid userId,
        Guid[]? accountIds,
        DateOnly windowEnd,
        CancellationToken ct)
    {
        var from = windowEnd.AddMonths(-LookbackMonths);

        // Same settled/non-transfer feed the spending dashboard and budgets use — a standing
        // order to a savings account shouldn't turn up here as a "subscription."
        var (settled, pairedIds) = await TransactionEndpoints.LoadWithPairingAsync(
            transactions, userId, accountIds, from, windowEnd, ct);
        var spending = settled.Where(t => !TransactionEndpoints.IsTransfer(t, pairedIds)).ToList();

        var dismissedKeys = await dismissals.GetDismissedKeysAsync(userId, ct);
        var series = RecurringDetector.Detect(spending)
            .Where(s => !dismissedKeys.Contains(s.MerchantKey))
            .ToList();

        return (series, series.Select(s => s.MerchantKey).ToHashSet(StringComparer.OrdinalIgnoreCase));
    }

    private static async Task<IResult> GetRecurring(
        TransactionRepository transactions,
        RecurringDismissalRepository dismissals,
        ICurrentUser currentUser,
        CancellationToken ct = default)
    {
        var userId = currentUser.GetRequiredUserId();
        var (detected, _) = await LoadRecurringAsync(transactions, dismissals, userId, null, Today.AddDays(1), ct);
        var series = detected.OrderByDescending(s => s.MonthlyEquivalentCost).ToList();

        return TypedResults.Ok(new
        {
            series = series.Select(s => new
            {
                s.MerchantKey,
                s.DisplayName,
                s.CategoryId,
                s.CategoryName,
                s.CategoryEmoji,
                cadence = s.Cadence.ToString(),
                s.OccurrenceCount,
                s.FirstSeen,
                s.LastSeen,
                s.LastAmount,
                s.PreviousAmount,
                s.PriceChanged,
                s.MonthlyEquivalentCost,
                s.NextExpectedDate,
            }),
            totalMonthlyEquivalent = series.Sum(s => s.MonthlyEquivalentCost),
            count = series.Count,
        });
    }

    private static async Task<IResult> GetDismissed(
        RecurringDismissalRepository dismissals, ICurrentUser currentUser, CancellationToken ct = default)
    {
        var dismissed = await dismissals.GetDismissedAsync(currentUser.GetRequiredUserId(), ct);
        return TypedResults.Ok(dismissed.Select(d => new { d.MerchantKey, d.DismissedAt }));
    }

    private static async Task<IResult> Dismiss(
        string merchantKey, RecurringDismissalRepository dismissals, ICurrentUser currentUser,
        CancellationToken ct = default)
    {
        await dismissals.DismissAsync(currentUser.GetRequiredUserId(), merchantKey, ct);
        return TypedResults.NoContent();
    }

    private static async Task<IResult> Undismiss(
        string merchantKey, RecurringDismissalRepository dismissals, ICurrentUser currentUser,
        CancellationToken ct = default)
    {
        await dismissals.UndismissAsync(currentUser.GetRequiredUserId(), merchantKey, ct);
        return TypedResults.NoContent();
    }
}

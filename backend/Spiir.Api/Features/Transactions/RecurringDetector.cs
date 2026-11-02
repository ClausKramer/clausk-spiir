using Spiir.Api.Data.Repositories;
using Spiir.Api.Features.Categorization;

namespace Spiir.Api.Features.Transactions;

public enum RecurringCadence { Weekly, Biweekly, Monthly, Quarterly, Yearly }

public record RecurringSeries(
    string MerchantKey,
    string DisplayName,
    Guid? CategoryId,
    string? CategoryName,
    string? CategoryEmoji,
    RecurringCadence Cadence,
    int OccurrenceCount,
    DateOnly FirstSeen,
    DateOnly LastSeen,
    decimal LastAmount,
    decimal PreviousAmount,
    bool PriceChanged,
    decimal MonthlyEquivalentCost,
    DateOnly NextExpectedDate);

// Identifies transactions to the same merchant that repeat on a regular cadence — subscriptions
// and bills, as opposed to a merchant you simply happen to visit often. Grouped by
// MerchantNormalizer.MerchantKey rather than raw description, the same identity notion
// categorization rules and the transaction-query "merchant" filter already use, so a detected
// series and its drill-down agree on what counts as "the same merchant."
public static class RecurringDetector
{
    // Checked shortest interval first: a genuinely monthly bill must not get reported as
    // quarterly just because one stretch of its history also loosely fits a coarser cadence.
    // MinOccurrences is higher for short cadences precisely because there's more data available
    // to demand it from — three monthly charges are unremarkable, but three years of the same
    // amount hitting quarterly is real evidence, while two is the most a 13-month lookback can
    // ever offer for a yearly cadence.
    // Months is the calendar step for the cadences that follow the calendar (0 for the ones that
    // count days). A bill due "the 1st" falls on the 1st of the next month, not 30 days on — and
    // the difference matters once the date is used to say which month a bill still lands in.
    private record CadenceRule(RecurringCadence Cadence, int IntervalDays, int ToleranceDays, int MinOccurrences, decimal MonthlyFactor, int Months);

    private static readonly CadenceRule[] Rules =
    [
        new(RecurringCadence.Weekly, IntervalDays: 7, ToleranceDays: 2, MinOccurrences: 3, MonthlyFactor: 4.33m, Months: 0),
        new(RecurringCadence.Biweekly, IntervalDays: 14, ToleranceDays: 3, MinOccurrences: 3, MonthlyFactor: 2.17m, Months: 0),
        new(RecurringCadence.Monthly, IntervalDays: 30, ToleranceDays: 5, MinOccurrences: 3, MonthlyFactor: 1m, Months: 1),
        new(RecurringCadence.Quarterly, IntervalDays: 91, ToleranceDays: 10, MinOccurrences: 2, MonthlyFactor: 1m / 3m, Months: 3),
        new(RecurringCadence.Yearly, IntervalDays: 365, ToleranceDays: 20, MinOccurrences: 2, MonthlyFactor: 1m / 12m, Months: 12),
    ];

    /// <summary>The occurrence that follows <paramref name="date"/> for a series on this cadence.</summary>
    public static DateOnly Advance(RecurringCadence cadence, DateOnly date)
    {
        var rule = Rules.First(r => r.Cadence == cadence);
        return rule.Months > 0 ? date.AddMonths(rule.Months) : date.AddDays(rule.IntervalDays);
    }

    /// <summary>True for cadences that follow the calendar (monthly and longer), as opposed to counting days.</summary>
    public static bool FollowsCalendar(RecurringCadence cadence) => Rules.First(r => r.Cadence == cadence).Months > 0;

    /// <summary>Days between occurrences, for cadences that count days.</summary>
    public static int IntervalDays(RecurringCadence cadence) => Rules.First(r => r.Cadence == cadence).IntervalDays;

    // A price rise shouldn't break the pattern match — a subscription that went from 79 to 99 is
    // still the same subscription — so amount is never part of the grouping key, only reported.
    private const decimal PriceChangeThreshold = 0.01m;

    public static IReadOnlyList<RecurringSeries> Detect(IReadOnlyList<TransactionListItem> transactions)
    {
        var results = new List<RecurringSeries>();

        // Expenses only: a subscription or bill is money going out. Bucketing by merchant key
        // first keeps the gap analysis local to transactions that could plausibly be the same
        // series, rather than comparing every transaction against every other.
        foreach (var group in transactions.Where(t => t.Amount < 0).GroupBy(t => MerchantNormalizer.MerchantKey(t.Description)))
        {
            var ordered = group.OrderBy(t => t.BookingDate).ToList();
            if (ordered.Count < 2) continue;

            var gaps = new List<int>(ordered.Count - 1);
            for (var i = 1; i < ordered.Count; i++)
                gaps.Add(ordered[i].BookingDate.DayNumber - ordered[i - 1].BookingDate.DayNumber);

            var matched = Rules.FirstOrDefault(rule =>
                ordered.Count >= rule.MinOccurrences
                && gaps.TakeLast(rule.MinOccurrences - 1)
                    .All(gap => Math.Abs(gap - rule.IntervalDays) <= rule.ToleranceDays));
            if (matched is null) continue;

            var last = ordered[^1];
            var previous = ordered[^2];
            var lastAmount = -last.Amount;
            var previousAmount = -previous.Amount;

            results.Add(new RecurringSeries(
                MerchantKey: group.Key,
                DisplayName: ordered.GroupBy(t => t.Description).OrderByDescending(g => g.Count()).First().Key,
                CategoryId: last.CategoryId,
                CategoryName: last.CategoryName,
                CategoryEmoji: last.CategoryEmoji,
                Cadence: matched.Cadence,
                OccurrenceCount: ordered.Count,
                FirstSeen: ordered[0].BookingDate,
                LastSeen: last.BookingDate,
                LastAmount: lastAmount,
                PreviousAmount: previousAmount,
                PriceChanged: Math.Abs(lastAmount - previousAmount) > previousAmount * PriceChangeThreshold,
                MonthlyEquivalentCost: lastAmount * matched.MonthlyFactor,
                NextExpectedDate: Advance(matched.Cadence, last.BookingDate)));
        }

        return results;
    }
}

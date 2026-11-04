using Spiir.Api.Data.Repositories;
using Spiir.Api.Domain.Entities;
using Spiir.Api.Features.Categorization;
using Spiir.Api.Features.Recurring;
using Spiir.Api.Features.Transactions;
using Spiir.Api.Services;

namespace Spiir.Api.Features.Month;

public static class MonthEndpoints
{
    // How many months before the one being viewed make up a "typical" month.
    private const int BaselineMonths = 12;

    public static IEndpointRouteBuilder MapMonthEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/month").WithTags("Month").RequireAuthorization();
        group.MapGet("/outlook", GetOutlook);
        return app;
    }

    private static DateOnly Today => DateOnly.FromDateTime(DateTime.UtcNow);

    private record BaselineMonth(
        int Year, int Month, decimal[] Expense, decimal[] Everyday, decimal[] Income,
        Dictionary<string, decimal> Kinds);

    // Day-indexed totals (1..31) for one month's rows, so any "through day N" figure is a slice sum.
    private static decimal[] ByDay(IEnumerable<TransactionListItem> rows, Func<TransactionListItem, decimal> value)
    {
        var totals = new decimal[32];
        foreach (var t in rows) totals[t.BookingDate.Day] += value(t);
        return totals;
    }

    private static decimal Median(IEnumerable<decimal> values)
    {
        var sorted = values.OrderBy(v => v).ToList();
        if (sorted.Count == 0) return 0m;
        var mid = sorted.Count / 2;
        return sorted.Count % 2 == 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2m;
    }

    private static decimal Sum(decimal[] byDay, int fromDay, int toDay)
    {
        var sum = 0m;
        for (var d = Math.Max(1, fromDay); d <= Math.Min(31, toDay); d++) sum += byDay[d];
        return sum;
    }

    // "How is this month going", which a month's totals alone can't say. Early in the month they
    // are dominated by whatever lumpy bill fell on the 1st, income hasn't arrived yet, and nothing
    // says whether the number is high — so each figure is set against the same point in the
    // previous twelve months, and the rest of the month is split into what is already owed (bills
    // the recurring detector has found) and what is only ever a guess (everyday spending).
    //
    // Everything is computed over the same settled, non-transfer, non-duplicate rows as the
    // dashboard, and "bills" comes from the same detector the recurring page and the transaction
    // query's recurring filter use, so each figure that can be opened reconciles with its rows.
    private static async Task<IResult> GetOutlook(
        TransactionRepository transactions,
        RecurringDismissalRepository dismissals,
        ICurrentUser currentUser,
        Guid[]? accountIds = null,
        int? year = null,
        int? month = null,
        CancellationToken ct = default)
    {
        var userId = currentUser.GetRequiredUserId();
        var today = Today;
        var y = year ?? today.Year;
        var m = month is >= 1 and <= 12 ? month.Value : today.Month;
        var monthStart = new DateOnly(y, m, 1);
        var monthEnd = monthStart.AddMonths(1);
        var daysInMonth = DateTime.DaysInMonth(y, m);

        var isCurrent = today >= monthStart && today < monthEnd;
        var isFinished = today >= monthEnd;
        var elapsed = isCurrent ? today.Day : isFinished ? daysInMonth : 0;

        var (settled, pairedIds) = await TransactionEndpoints.LoadWithPairingAsync(
            transactions, userId, accountIds, monthStart.AddMonths(-BaselineMonths), monthEnd, ct);
        var spending = settled.Where(t => !TransactionEndpoints.IsTransfer(t, pairedIds)).ToList();

        var windowEnd = monthEnd < today.AddDays(1) ? monthEnd : today.AddDays(1);
        var (series, billKeys) = await RecurringEndpoints.LoadRecurringAsync(
            transactions, dismissals, userId, accountIds, windowEnd, ct);

        var isBill = spending
            .Where(t => t.Amount < 0)
            .ToDictionary(t => t.Id, t => billKeys.Contains(MerchantNormalizer.MerchantKey(t.Description)));

        static decimal Expense(TransactionListItem t) => t.Amount < 0 ? -t.Amount : 0m;
        static decimal Income(TransactionListItem t) => t.Amount > 0 ? t.Amount : 0m;
        decimal Everyday(TransactionListItem t) => t.Amount < 0 && !isBill[t.Id] ? -t.Amount : 0m;

        var byMonth = spending
            .GroupBy(t => (t.BookingDate.Year, t.BookingDate.Month))
            .ToDictionary(g => g.Key, g => g.ToList());

        // A month with no transactions at all is missing data (the bank wasn't connected that far
        // back), not a month where nothing was spent, and would drag every average toward zero.
        var monthsWithData = settled.Select(t => (t.BookingDate.Year, t.BookingDate.Month)).ToHashSet();

        // What a month's spending is made of, in the same buckets the dashboard's "committed vs
        // discretionary" split uses, so the two can be read side by side. "other" is expense filed
        // under an income or transfer category, which the dashboard's split leaves out.
        static string KindBucket(TransactionListItem t) => t.CategoryKind switch
        {
            null => "uncategorized",
            CategoryKind.Fixed => "fixed",
            CategoryKind.Variable => "variable",
            CategoryKind.Savings => "savings",
            CategoryKind.Debt => "debt",
            _ => "other",
        };

        var baseline = new List<BaselineMonth>();
        for (var back = 1; back <= BaselineMonths; back++)
        {
            var start = monthStart.AddMonths(-back);
            if (!monthsWithData.Contains((start.Year, start.Month))) continue;
            var rows = byMonth.TryGetValue((start.Year, start.Month), out var r) ? r : [];
            baseline.Add(new BaselineMonth(
                start.Year,
                start.Month,
                ByDay(rows, Expense),
                ByDay(rows, Everyday),
                ByDay(rows, Income),
                rows.Where(t => t.Amount < 0)
                    .GroupBy(KindBucket)
                    .ToDictionary(g => g.Key, g => g.Sum(Expense))));
        }

        var thisRows = byMonth.TryGetValue((y, m), out var current) ? current : [];
        var expenseByDay = ByDay(thisRows, Expense);
        var everydayByDay = ByDay(thisRows, Everyday);
        var incomeByDay = ByDay(thisRows, Income);

        var spentSoFar = Sum(expenseByDay, 1, 31);
        var everydaySoFar = Sum(everydayByDay, 1, 31);
        var incomeSoFar = Sum(incomeByDay, 1, 31);

        var cumulative = new List<decimal>();
        var running = 0m;
        for (var d = 1; d <= elapsed; d++)
        {
            running += expenseByDay[d];
            cumulative.Add(running);
        }

        // Bills the detector expects to land in this month and that haven't yet. A bill that
        // follows the calendar is expected once, on its date, if it hasn't been paid this month; a
        // weekly or fortnightly one on every remaining date. A date that has already passed with
        // no payment seen is kept and marked overdue — the bank often posts a day or two late, and
        // dropping it would make the month look cheaper than it is.
        var stillToCome = new List<object>();
        var stillToComeTotal = 0m;
        if (isCurrent)
        {
            var lastDay = monthEnd.AddDays(-1);
            foreach (var s in series.OrderBy(s => s.NextExpectedDate))
            {
                var dates = new List<DateOnly>();
                if (RecurringDetector.FollowsCalendar(s.Cadence))
                {
                    var due = s.NextExpectedDate;
                    if (s.LastSeen < monthStart && due >= monthStart && due <= lastDay) dates.Add(due);
                }
                else
                {
                    // Only while the series is still alive: a weekly payment last seen two months
                    // ago has stopped, and projecting it forward would invent bills.
                    var interval = RecurringDetector.IntervalDays(s.Cadence);
                    if (today.DayNumber - s.LastSeen.DayNumber <= 3 * interval)
                    {
                        for (var due = s.NextExpectedDate; due <= lastDay; due = RecurringDetector.Advance(s.Cadence, due))
                            if (due > today) dates.Add(due);
                    }
                }

                foreach (var due in dates)
                {
                    stillToComeTotal += s.LastAmount;
                    stillToCome.Add(new
                    {
                        s.MerchantKey,
                        s.DisplayName,
                        s.CategoryEmoji,
                        amount = s.LastAmount,
                        expectedDate = due,
                        overdue = due <= today,
                    });
                }
            }
        }

        object? typical = null;
        decimal? expectedMonthEnd = isFinished ? spentSoFar : null;
        decimal? incomeStillToCome = null;
        decimal? everydayStillToCome = null;

        if (baseline.Count > 0)
        {
            decimal Avg(Func<BaselineMonth, decimal> f) => baseline.Average(f);
            decimal AvgKind(string kind) => Avg(b => b.Kinds.TryGetValue(kind, out var v) ? v : 0m);

            // "Typical" is the middle month, not the mean. A mean is dragged by one-offs — a
            // property purchase or a large transfer in a single month of the twelve moved it by a
            // hundred thousand — and a one-off is not typical by definition. The estimate of where
            // the month ends is built on these figures, so a skewed baseline spoils that too. The
            // mean is still returned as `averageMonthSpend` and the split by kind is of the mean,
            // so it adds up and the difference between the two says how lumpy the year was.
            decimal Typ(Func<BaselineMonth, decimal> f) => Median(baseline.Select(f));

            var everydayRemaining = isCurrent ? Typ(b => Sum(b.Everyday, elapsed + 1, 31)) : 0m;
            typical = new
            {
                // The months the average is taken over, so a figure that looks wrong can be
                // checked rather than argued with: one enormous month, or every month high.
                months = baseline
                    .OrderBy(b => b.Year).ThenBy(b => b.Month)
                    .Select(b => new { b.Year, b.Month, spend = Sum(b.Expense, 1, 31) })
                    .ToList(),
                byKind = new
                {
                    @fixed = AvgKind("fixed"),
                    variable = AvgKind("variable"),
                    savings = AvgKind("savings"),
                    debt = AvgKind("debt"),
                    uncategorized = AvgKind("uncategorized"),
                    other = AvgKind("other"),
                },
                monthSpend = Typ(b => Sum(b.Expense, 1, 31)),
                averageMonthSpend = Avg(b => Sum(b.Expense, 1, 31)),
                spendByNow = Typ(b => Sum(b.Expense, 1, elapsed)),
                everydayByNow = Typ(b => Sum(b.Everyday, 1, elapsed)),
                everydayRemaining,
                income = Typ(b => Sum(b.Income, 1, 31)),
                incomeByNow = Typ(b => Sum(b.Income, 1, elapsed)),
                // Median taken separately at each day. Every month's running total only ever
                // rises, so the median of them at each day does too and the line stays monotone.
                cumulative = Enumerable.Range(1, daysInMonth).Select(d => Typ(b => Sum(b.Expense, 1, d))).ToList(),
            };

            // What's been spent, plus the bills still due, plus everyday spending at its usual
            // pace for the days left. Bills are kept out of the "usual pace" part so one that has
            // already fallen this month isn't counted a second time as an average of past ones.
            if (isCurrent)
            {
                expectedMonthEnd = spentSoFar + stillToComeTotal + everydayRemaining;
                everydayStillToCome = everydayRemaining;
                // Income still to arrive: what a typical month brings, less what has come. Never
                // negative — a month that has already out-earned the usual doesn't owe anything back.
                incomeStillToCome = Math.Max(0m, Typ(b => Sum(b.Income, 1, 31)) - incomeSoFar);
            }
        }

        // Whether the balance stays above zero is the question for a single account, such as a
        // budget account fed by a transfer on payday. The balance is what this app has tracked —
        // the sum of the transactions it holds — so it is only as good as the history behind it.
        object? balance = null;
        if (isCurrent)
        {
            var balanceNow = await transactions.GetNetBalanceAsync(userId, accountIds, today, ct);
            decimal? expectedEnd = incomeStillToCome is null || everydayStillToCome is null
                ? null
                : balanceNow + incomeStillToCome.Value - stillToComeTotal - everydayStillToCome.Value;
            balance = new
            {
                current = balanceNow,
                incomeStillToCome,
                billsStillToCome = stillToComeTotal,
                everydayStillToCome,
                expectedEnd,
            };
        }

        return TypedResults.Ok(new
        {
            year = y,
            month = m,
            daysInMonth,
            elapsedDays = elapsed,
            isCurrent,
            isFinished,
            hasBaseline = baseline.Count > 0,
            baselineMonths = baseline.Count,
            spentSoFar,
            billsPaid = spentSoFar - everydaySoFar,
            everydaySoFar,
            incomeSoFar,
            cumulative,
            typical,
            stillToCome = new { total = stillToComeTotal, items = stillToCome },
            expectedMonthEnd,
            balance,
        });
    }
}

using Spiir.Api.Data.Repositories;
using Spiir.Api.Features.Transactions;
using Spiir.Api.Services;

namespace Spiir.Api.Features.Budgets;

public static class BudgetEndpoints
{
    // How many months before the one being viewed make up the baseline "typical month".
    private const int BaselineMonths = 12;

    // A month is called unusual when it runs this far above the baseline. Wide enough that
    // ordinary month-to-month wobble doesn't trip it, narrow enough that a quarterly or yearly
    // charge landing in an otherwise ordinary month does.
    private const decimal UnusualMultiplier = 1.5m;

    public static IEndpointRouteBuilder MapBudgetEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/budgets").WithTags("Budgets").RequireAuthorization();

        group.MapGet("/", GetBudgets);
        group.MapPut("/{categoryId:guid}", SetBudget);
        group.MapGet("/dashboard", GetDashboard);

        return app;
    }

    private static DateOnly Today => DateOnly.FromDateTime(DateTime.UtcNow);

    // Every top-level group, whether or not it has a limit set yet, so the page can offer every
    // group as settable rather than only the ones already budgeted.
    private static async Task<IResult> GetBudgets(
        BudgetRepository budgets,
        CategoryRepository categories,
        ICurrentUser currentUser,
        CancellationToken ct = default)
    {
        var userId = currentUser.GetRequiredUserId();
        var groups = (await categories.GetAllForUserAsync(userId, ct))
            .Where(c => c.ParentCategoryId is null)
            .OrderBy(c => c.Name)
            .ToList();
        var limits = (await budgets.GetBudgetsAsync(userId, ct))
            .ToDictionary(b => b.CategoryId, b => b.LimitAmount);

        return TypedResults.Ok(groups.Select(g => new
        {
            categoryId = g.Id,
            categoryName = g.Name,
            categoryEmoji = g.Emoji,
            limitAmount = limits.TryGetValue(g.Id, out var limit) ? limit : (decimal?)null,
        }));
    }

    private record BudgetRequest(decimal? LimitAmount);

    private static async Task<IResult> SetBudget(
        Guid categoryId, BudgetRequest body, BudgetRepository budgets, ICurrentUser currentUser,
        CancellationToken ct = default)
    {
        var userId = currentUser.GetRequiredUserId();

        // A blank box means "no limit for this category" — must remove any stale limit rather
        // than leave one standing that the user thinks they cleared.
        if (body.LimitAmount is null)
        {
            await budgets.DeleteBudgetAsync(userId, categoryId, ct);
            return TypedResults.NoContent();
        }

        if (body.LimitAmount < 0)
            return TypedResults.BadRequest(new { error = "A budget can't be negative." });

        await budgets.UpsertBudgetAsync(userId, categoryId, body.LimitAmount.Value, ct);
        return TypedResults.NoContent();
    }

    // Actual spend reuses the exact settled/non-transfer pipeline the spending dashboard computes
    // with — the same TransactionEndpoints helpers, not a second derivation of what "spend" means
    // — so a budget's actual figure always agrees with the number the spending dashboard shows
    // for that same group and month.
    //
    // Alongside this month, each group gets a baseline: its average over the twelve months
    // *before* this one. A group can mix a monthly cost with a quarterly or yearly one (rent and
    // a mortgage both file under Housing), so no single schedule describes it — but averaging
    // smooths any lumpy charge without being told when it falls, and comparing this month to a
    // baseline that excludes it means an unusually large month can't inflate its own yardstick.
    private static async Task<IResult> GetDashboard(
        BudgetRepository budgets,
        CategoryRepository categories,
        TransactionRepository transactions,
        ICurrentUser currentUser,
        int? year = null,
        int? month = null,
        CancellationToken ct = default)
    {
        var userId = currentUser.GetRequiredUserId();
        var today = Today;
        var y = year ?? today.Year;
        var m = month is >= 1 and <= 12 ? month.Value : today.Month;
        var targetMonth = new DateOnly(y, m, 1);

        var from = targetMonth.AddMonths(-BaselineMonths);
        var to = targetMonth.AddMonths(1);

        var allCategories = await categories.GetAllForUserAsync(userId, ct);
        var (settled, pairedIds) = await TransactionEndpoints.LoadWithPairingAsync(transactions, userId, null, from, to, ct);
        var spending = settled.Where(t => !TransactionEndpoints.IsTransfer(t, pairedIds)).ToList();

        // A month with no transactions at all is missing data (the bank wasn't connected that far
        // back), not a month where nothing was spent — counting it would drag every average down.
        // A month that has transactions, just none in a given group, is a genuine zero for it.
        var monthsWithData = settled
            .Select(t => (t.BookingDate.Year, t.BookingDate.Month))
            .ToHashSet();

        var actualByMonthByGroup = spending
            .GroupBy(t => (t.BookingDate.Year, t.BookingDate.Month))
            .ToDictionary(
                g => g.Key,
                g => TransactionEndpoints.RollUpToGroups(TransactionEndpoints.CategoryBreakdown(g.ToList()), allCategories)
                    .Where(r => r.CategoryId is not null)
                    .ToDictionary(r => r.CategoryId!.Value, r => r.Total));

        decimal ActualIn(DateOnly monthStart, Guid categoryId) =>
            actualByMonthByGroup.TryGetValue((monthStart.Year, monthStart.Month), out var byGroup)
            && byGroup.TryGetValue(categoryId, out var total)
                ? total
                : 0m;

        // Null rather than zero when there's no history to average: "typically nothing" would
        // claim a baseline that doesn't exist yet.
        decimal? BaselineFor(Guid categoryId)
        {
            var sum = 0m;
            var counted = 0;
            for (var i = 1; i <= BaselineMonths; i++)
            {
                var monthStart = targetMonth.AddMonths(-i);
                if (!monthsWithData.Contains((monthStart.Year, monthStart.Month))) continue;
                sum += ActualIn(monthStart, categoryId);
                counted++;
            }
            return counted == 0 ? null : sum / counted;
        }

        var limits = (await budgets.GetBudgetsAsync(userId, ct)).ToDictionary(b => b.CategoryId, b => b.LimitAmount);
        var groups = allCategories.Where(c => c.ParentCategoryId is null).OrderBy(c => c.Name).ToList();

        var rows = groups.Select(g =>
        {
            var actual = ActualIn(targetMonth, g.Id);
            var average = BaselineFor(g.Id);
            var limit = limits.TryGetValue(g.Id, out var l) ? l : (decimal?)null;
            return new
            {
                categoryId = g.Id,
                categoryName = g.Name,
                categoryEmoji = g.Emoji,
                limit,
                actual,
                average,
                remaining = limit is null ? (decimal?)null : limit.Value - actual,
                // Only meaningful against a real, non-zero baseline — a first-ever expense has
                // nothing to be unusual relative to.
                unusual = average is > 0 && actual > average.Value * UnusualMultiplier,
            };
        })
        // Budgeted groups first (most relevant to a budget page), then unbudgeted groups that
        // still had spend, so a category worth attention isn't buried below a zero-spend one.
        .OrderByDescending(r => r.limit is not null)
        .ThenByDescending(r => r.actual)
        .ToList();

        return TypedResults.Ok(new
        {
            year = y,
            month = m,
            groups = rows,
            totalLimit = rows.Where(r => r.limit is not null).Sum(r => r.limit!.Value),
            totalActual = rows.Sum(r => r.actual),
            totalAverage = rows.Sum(r => r.average ?? 0m),
            hasAnyBudgets = limits.Count > 0,
        });
    }
}

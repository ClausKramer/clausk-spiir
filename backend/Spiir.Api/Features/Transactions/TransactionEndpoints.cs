using Spiir.Api.Data.Repositories;
using Spiir.Api.Services;

namespace Spiir.Api.Features.Transactions;

public static class TransactionEndpoints
{
    public static IEndpointRouteBuilder MapTransactionEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/transactions").WithTags("Transactions").RequireAuthorization();

        group.MapGet("/", GetTransactions);
        group.MapGet("/summary", GetMonthlySummary);
        group.MapGet("/dashboard", GetDashboard);
        group.MapPatch("/{id:guid}/category", SetCategory);

        return app;
    }

    private static async Task<IResult> GetTransactions(
        TransactionRepository transactions,
        ICurrentUser currentUser,
        int page = 1,
        int pageSize = 50,
        Guid[]? accountIds = null,
        CancellationToken ct = default)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 200);

        var userId = currentUser.GetRequiredUserId();
        var (items, total) = await transactions.GetPageAsync(userId, page, pageSize, accountIds, ct);

        return TypedResults.Ok(new { items, totalCount = total, page, pageSize });
    }

    private static async Task<IResult> GetMonthlySummary(
        TransactionRepository transactions,
        ICurrentUser currentUser,
        int? year = null,
        int? month = null,
        CancellationToken ct = default)
    {
        var now = DateTime.UtcNow;
        var targetYear = year ?? now.Year;
        var targetMonth = month ?? now.Month;

        var from = new DateOnly(targetYear, targetMonth, 1);
        var to = from.AddMonths(1);

        var userId = currentUser.GetRequiredUserId();
        var rows = await transactions.GetCategoryBreakdownAsync(userId, null, from, to, ct);

        return TypedResults.Ok(new { year = targetYear, month = targetMonth, categories = rows });
    }

    private static async Task<IResult> GetDashboard(
        TransactionRepository transactions,
        ICurrentUser currentUser,
        Guid[]? accountIds = null,
        int months = 6,
        CancellationToken ct = default)
    {
        months = Math.Clamp(months, 1, 24);

        var now = DateOnly.FromDateTime(DateTime.UtcNow);
        var to = new DateOnly(now.Year, now.Month, 1).AddMonths(1);
        var from = to.AddMonths(-months);

        var userId = currentUser.GetRequiredUserId();

        var flow = await transactions.GetMonthlyFlowAsync(userId, accountIds, from, to, ct);
        var categories = await transactions.GetCategoryBreakdownAsync(userId, accountIds, from, to, ct);
        var netBalance = await transactions.GetNetBalanceAsync(userId, accountIds, ct);

        // Fill in months with no transactions so the flow grid always shows exactly `months` cards.
        var byKey = flow.ToDictionary(r => (r.Year, r.Month));
        var monthlyFlow = Enumerable.Range(0, months)
            .Select(i => from.AddMonths(i))
            .Select(d => byKey.TryGetValue((d.Year, d.Month), out var row)
                ? new { row.Year, row.Month, row.Income, row.Expense, Net = row.Income - row.Expense }
                : new { Year = d.Year, Month = d.Month, Income = 0m, Expense = 0m, Net = 0m })
            .ToList();

        var avgIncome = monthlyFlow.Count > 0 ? monthlyFlow.Average(m => m.Income) : 0m;
        var avgExpense = monthlyFlow.Count > 0 ? monthlyFlow.Average(m => m.Expense) : 0m;

        return TypedResults.Ok(new
        {
            from,
            to,
            months,
            monthlyFlow,
            categoryBreakdown = categories,
            kpis = new
            {
                avgMonthlyIncome = avgIncome,
                avgMonthlyExpense = avgExpense,
                avgMonthlySurplus = avgIncome - avgExpense,
                netBalance,
            },
        });
    }

    private record SetCategoryRequest(Guid? CategoryId);

    private static async Task<IResult> SetCategory(
        Guid id,
        SetCategoryRequest body,
        TransactionRepository transactions,
        CategoryRepository categories,
        ICurrentUser currentUser,
        CancellationToken ct = default)
    {
        var userId = currentUser.GetRequiredUserId();

        if (body.CategoryId.HasValue)
        {
            var categoryExists = await categories.ExistsAsync(userId, body.CategoryId.Value, ct);
            if (!categoryExists) return TypedResults.BadRequest(new { error = "Category not found." });
        }

        var updated = await transactions.SetCategoryAsync(userId, id, body.CategoryId, ct);
        return updated ? TypedResults.NoContent() : TypedResults.NotFound();
    }
}

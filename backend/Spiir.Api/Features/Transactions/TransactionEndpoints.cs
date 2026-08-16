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
        group.MapPatch("/{id:guid}/category", SetCategory);

        return app;
    }

    private static async Task<IResult> GetTransactions(
        TransactionRepository transactions,
        ICurrentUser currentUser,
        int page = 1,
        int pageSize = 50,
        CancellationToken ct = default)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 200);

        var userId = currentUser.GetRequiredUserId();
        var (items, total) = await transactions.GetPageAsync(userId, page, pageSize, ct);

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
        var rows = await transactions.GetMonthlySummaryAsync(userId, from, to, ct);

        return TypedResults.Ok(new { year = targetYear, month = targetMonth, categories = rows });
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

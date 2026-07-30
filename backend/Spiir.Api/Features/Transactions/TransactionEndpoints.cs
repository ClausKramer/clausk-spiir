using Microsoft.EntityFrameworkCore;
using Spiir.Api.Data;
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
        AppDbContext db,
        ICurrentUser currentUser,
        int page = 1,
        int pageSize = 50,
        CancellationToken ct = default)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 200);

        var query = db.Transactions
            .Include(t => t.Category)
            .OrderByDescending(t => t.BookingDate)
            .ThenByDescending(t => t.CreatedAt);

        var total = await query.CountAsync(ct);
        var items = await query
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(t => new
            {
                t.Id,
                t.BankAccountId,
                t.BookingDate,
                t.Amount,
                t.Currency,
                t.Description,
                t.CategoryId,
                CategoryName = t.Category != null ? t.Category.Name : null,
                CategoryEmoji = t.Category != null ? t.Category.Emoji : null,
                t.IsCategoryManual,
            })
            .ToListAsync(ct);

        return TypedResults.Ok(new { items, totalCount = total, page, pageSize });
    }

    private static async Task<IResult> GetMonthlySummary(
        AppDbContext db,
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

        var rows = await db.Transactions
            .Where(t => t.BookingDate >= from && t.BookingDate < to && t.Amount < 0)
            .GroupBy(t => new { t.CategoryId, CategoryName = t.Category != null ? t.Category.Name : null, CategoryEmoji = t.Category != null ? t.Category.Emoji : null })
            .Select(g => new
            {
                g.Key.CategoryId,
                g.Key.CategoryName,
                g.Key.CategoryEmoji,
                Total = -g.Sum(t => t.Amount),
            })
            .OrderByDescending(r => r.Total)
            .ToListAsync(ct);

        return TypedResults.Ok(new { year = targetYear, month = targetMonth, categories = rows });
    }

    private record SetCategoryRequest(Guid? CategoryId);

    private static async Task<IResult> SetCategory(
        Guid id,
        SetCategoryRequest body,
        AppDbContext db,
        ICurrentUser currentUser,
        CancellationToken ct = default)
    {
        var tx = await db.Transactions.FindAsync([id], ct);
        if (tx is null) return TypedResults.NotFound();

        if (body.CategoryId.HasValue)
        {
            var categoryExists = await db.Categories.AnyAsync(c => c.Id == body.CategoryId.Value, ct);
            if (!categoryExists) return TypedResults.BadRequest(new { error = "Category not found." });
        }

        tx.CategoryId = body.CategoryId;
        tx.IsCategoryManual = true;
        await db.SaveChangesAsync(ct);

        return TypedResults.NoContent();
    }
}

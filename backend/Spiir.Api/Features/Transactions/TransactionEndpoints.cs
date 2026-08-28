using Spiir.Api.Data.Repositories;
using Spiir.Api.Features.Categorization;
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
        group.MapPost("/recategorize", Recategorize);
        group.MapGet("/similar", GetSimilar);
        group.MapPost("/apply-to-similar", ApplyToSimilar);
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

    // Re-runs categorization over transactions already stored, which sync never revisits (it only
    // categorizes what it just fetched). Needed whenever the rules change underneath existing
    // data — new merchant rules, or the Claude fallback being configured after transactions were
    // already imported. Never touches rows the user categorized by hand.
    private static async Task<IResult> Recategorize(
        TransactionRepository transactions,
        ICategorizationEngine categorizer,
        ICurrentUser currentUser,
        bool onlyUncategorized = true,
        CancellationToken ct = default)
    {
        var userId = currentUser.GetRequiredUserId();

        var candidates = await transactions.GetAutoCategorizedDescriptionsAsync(userId, onlyUncategorized, ct);
        if (candidates.Count == 0)
            return TypedResults.Ok(new { examined = 0, updated = 0, message = "Nothing to recategorize." });

        var categoryByDescription = await categorizer.CategorizeManyAsync(
            candidates.Select(c => c.Description).ToList(), userId, ct);

        // Grouped so each category is one UPDATE ... IN (...) rather than a round trip per row.
        var updated = 0;
        foreach (var group in candidates
                     .Select(c => (c.Id, CategoryId: categoryByDescription.TryGetValue(c.Description, out var id) ? id : (Guid?)null))
                     .Where(x => x.CategoryId.HasValue)
                     .GroupBy(x => x.CategoryId!.Value))
        {
            updated += await transactions.SetCategoryForManyAsync(
                userId, group.Select(x => x.Id).ToList(), group.Key, ct);
        }

        return TypedResults.Ok(new
        {
            examined = candidates.Count,
            updated,
            message = $"Recategorized {updated} of {candidates.Count} transaction(s).",
        });
    }

    private record SetCategoryRequest(Guid? CategoryId);

    private static async Task<IResult> SetCategory(
        Guid id,
        SetCategoryRequest body,
        TransactionRepository transactions,
        CategoryRepository categories,
        CategorizationRuleRepository rules,
        ICurrentUser currentUser,
        CancellationToken ct = default)
    {
        var userId = currentUser.GetRequiredUserId();

        if (body.CategoryId.HasValue)
        {
            var categoryExists = await categories.ExistsAsync(userId, body.CategoryId.Value, ct);
            if (!categoryExists) return TypedResults.BadRequest(new { error = "Category not found." });
        }

        var description = await transactions.GetDescriptionAsync(userId, id, ct);
        var updated = await transactions.SetCategoryAsync(userId, id, body.CategoryId, ct);
        if (!updated) return TypedResults.NotFound();

        // Only ever this one transaction. Applying to similar ones, and learning a rule from the
        // correction, are a separate confirmed step (/similar then /apply-to-similar) — matching
        // is a heuristic, and silently rewriting dozens of unrelated rows on a single click is
        // both surprising and tedious to undo.
        var merchant = body.CategoryId.HasValue && !string.IsNullOrWhiteSpace(description)
            ? MerchantNormalizer.MerchantKey(description)
            : null;

        return TypedResults.Ok(new { merchantKey = merchant });
    }

    // Learned rules sit above the seeded defaults (priority 10) so an explicit correction always
    // beats a generic seeded pattern that matched the same text.
    private const int LearnedRulePriority = 100;

    // Auto-categorized transactions that a rule learned from this one would also match. Matched by
    // the same substring test the rule itself uses, so the preview is exactly what would change.
    // Normalized in C# rather than matched in SQL because the normalizer removes noise from the
    // middle of the text — a LIKE against the raw description would miss the rows this targets.
    private static async Task<IResult> GetSimilar(
        Guid transactionId,
        TransactionRepository transactions,
        ICurrentUser currentUser,
        CancellationToken ct = default)
    {
        var userId = currentUser.GetRequiredUserId();

        var description = await transactions.GetDescriptionAsync(userId, transactionId, ct);
        if (description is null) return TypedResults.NotFound();

        var merchant = MerchantNormalizer.MerchantKey(description);
        if (string.IsNullOrWhiteSpace(merchant))
            return TypedResults.Ok(new { merchantKey = merchant, items = Array.Empty<object>() });

        var candidates = await transactions.GetAutoCategorizedForPreviewAsync(userId, ct);
        var matches = candidates
            .Where(c => c.Id != transactionId && Matches(c.Description, merchant))
            .Select(c => new
            {
                c.Id,
                c.BookingDate,
                c.Amount,
                c.Currency,
                c.Description,
                c.CategoryId,
                c.CategoryName,
                c.CategoryEmoji,
            })
            .ToList();

        return TypedResults.Ok(new { merchantKey = merchant, items = matches });
    }

    private static bool Matches(string description, string merchant) =>
        MerchantNormalizer.Normalize(description).Contains(merchant, StringComparison.OrdinalIgnoreCase)
        || description.Contains(merchant, StringComparison.OrdinalIgnoreCase);

    private record ApplyToSimilarRequest(Guid CategoryId, Guid[] TransactionIds, string? MerchantKey, bool CreateRule);

    // Applies a category to the transactions the user picked out of the preview, and optionally
    // remembers the choice as a rule for future imports. Both parts are opt-in: someone may want
    // to fix these rows without committing to a rule, or vice versa.
    private static async Task<IResult> ApplyToSimilar(
        ApplyToSimilarRequest body,
        TransactionRepository transactions,
        CategoryRepository categories,
        CategorizationRuleRepository rules,
        ICurrentUser currentUser,
        CancellationToken ct = default)
    {
        var userId = currentUser.GetRequiredUserId();

        if (!await categories.ExistsAsync(userId, body.CategoryId, ct))
            return TypedResults.BadRequest(new { error = "Category not found." });

        var updated = body.TransactionIds.Length > 0
            ? await transactions.SetCategoryForManyAsync(userId, body.TransactionIds, body.CategoryId, ct)
            : 0;

        var ruleCreated = false;
        if (body.CreateRule && !string.IsNullOrWhiteSpace(body.MerchantKey))
        {
            await rules.UpsertLearnedRuleAsync(userId, body.MerchantKey, body.CategoryId, LearnedRulePriority, ct);
            ruleCreated = true;
        }

        return TypedResults.Ok(new
        {
            updated,
            ruleCreated,
            message = ruleCreated
                ? $"Updated {updated} transaction(s) and saved a rule for future ones."
                : $"Updated {updated} transaction(s).",
        });
    }
}

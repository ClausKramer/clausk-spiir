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
        group.MapGet("/dashboard", GetDashboard);
        group.MapGet("/by-category", GetByCategory);
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
        int? year = null,
        int? month = null,
        bool includeFuture = true,
        CancellationToken ct = default)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 200);

        // year is optional here, unlike on the dashboard: the per-account transaction list wants
        // everything ever recorded, while the dashboard always scopes to a chosen period.
        var (from, to) = year is null ? (default(DateOnly?), default(DateOnly?)) : ResolvePeriod(year, month) switch
        {
            var p => ((DateOnly?)p.From, (DateOnly?)p.To),
        };

        var userId = currentUser.GetRequiredUserId();
        // The dashboard opts out of scheduled payments — it's an analysis view, and rows excluded
        // from every figure on the page are noise there. The per-account list keeps them, since
        // that view is for seeing everything the bank has on an account.
        var (items, total) = await transactions.GetPageAsync(
            userId, page, pageSize, accountIds, from, to, includeFuture ? null : Today, ct);

        // Which rows the dashboard's totals left out as matched internal transfers. Computed over
        // the whole period rather than the current page — pairing depends on the counterpart being
        // in scope, and it usually isn't on the same page. Skipped without a period: that's the
        // per-account list, where a single account can't pair against itself anyway.
        var paired = from.HasValue && to.HasValue
            ? InternalTransferDetector.FindPairedIds(
                (await transactions.GetForPeriodAsync(userId, accountIds, from.Value, to.Value, ct))
                    .Where(t => !IsFuture(t)).ToList())
            : [];

        return TypedResults.Ok(new
        {
            items = items.Select(t => WithFlags(t, paired.Contains(t.Id))),
            totalCount = total,
            page,
            pageSize,
        });
    }

    // Banks report scheduled payments alongside settled ones, dated when they will happen. They
    // haven't moved any money yet, so they're kept out of every total and flagged instead — the
    // client marks them rather than hiding them, since a scheduled payment is still worth seeing.
    private static DateOnly Today => DateOnly.FromDateTime(DateTime.UtcNow);

    private static bool IsFuture(TransactionListItem t) => t.BookingDate > Today;

    private static object WithFutureFlag(TransactionListItem t) => WithFlags(t, isTransfer: false);

    // isTransfer marks a row the totals deliberately left out because it paired against an
    // opposite leg in another of the user's accounts. Surfaced so an excluded row is visibly
    // excluded — otherwise it's indistinguishable from one the matching simply missed.
    private static object WithFlags(TransactionListItem t, bool isTransfer) => new
    {
        t.Id,
        t.BankAccountId,
        t.BookingDate,
        t.Amount,
        t.Currency,
        t.Description,
        t.CategoryId,
        t.CategoryName,
        t.CategoryEmoji,
        t.IsCategoryManual,
        IsFuture = IsFuture(t),
        IsTransfer = isTransfer,
    };

    // A calendar period: a whole year, or one month of it when month is given. Returns the
    // half-open range [from, to) plus how many month buckets it spans, so callers can build a
    // complete flow grid including months with no transactions.
    private static (DateOnly From, DateOnly To, int MonthCount) ResolvePeriod(int? year, int? month)
    {
        var targetYear = year ?? DateTime.UtcNow.Year;

        if (month is >= 1 and <= 12)
        {
            var start = new DateOnly(targetYear, month.Value, 1);
            return (start, start.AddMonths(1), 1);
        }

        var yearStart = new DateOnly(targetYear, 1, 1);
        return (yearStart, yearStart.AddYears(1), 12);
    }

    private static async Task<IResult> GetDashboard(
        TransactionRepository transactions,
        ICurrentUser currentUser,
        Guid[]? accountIds = null,
        int? year = null,
        int? month = null,
        CancellationToken ct = default)
    {
        var (from, to, months) = ResolvePeriod(year, month);

        var userId = currentUser.GetRequiredUserId();

        var allItems = await transactions.GetForPeriodAsync(userId, accountIds, from, to, ct);
        var availableYears = await transactions.GetAvailableYearsAsync(userId, accountIds, ct);
        // asOf: a payment scheduled for next week hasn't left the account, so it shouldn't be in
        // the balance either — the figure describes money that has actually moved.
        var netBalance = await transactions.GetNetBalanceAsync(userId, accountIds, Today, ct);

        // Scheduled payments are dated in the future and haven't happened yet; counting them would
        // report spending that may still be cancelled, and would make the current month look worse
        // than it is. Dropped before any aggregation, including transfer pairing — a future leg
        // has no settled counterpart to net against.
        var items = allItems.Where(t => !IsFuture(t)).ToList();
        var futureCount = allItems.Count - items.Count;

        // Matched transfers are dropped from income, expenses and category spending: both legs are
        // in view, they cancel out, and counting them would inflate both sides by the same amount
        // while describing no real money in or out. Net balance deliberately keeps them — it
        // reflects what's actually sitting in the accounts, and a matched pair already sums to zero.
        var spending = ExcludingInternalTransfers(items);
        var transferCount = items.Count - spending.Count;

        var byMonth = spending
            .GroupBy(t => (t.BookingDate.Year, t.BookingDate.Month))
            .ToDictionary(
                g => g.Key,
                g => (Income: g.Where(t => t.Amount > 0).Sum(t => t.Amount),
                      Expense: g.Where(t => t.Amount < 0).Sum(t => -t.Amount)));

        // Fill in months with no transactions so the flow grid always shows exactly `months` cards.
        var monthlyFlow = Enumerable.Range(0, months)
            .Select(i => from.AddMonths(i))
            .Select(d =>
            {
                byMonth.TryGetValue((d.Year, d.Month), out var row);
                return new { d.Year, d.Month, row.Income, row.Expense, Net = row.Income - row.Expense };
            })
            .ToList();

        var avgIncome = monthlyFlow.Count > 0 ? monthlyFlow.Average(m => m.Income) : 0m;
        var avgExpense = monthlyFlow.Count > 0 ? monthlyFlow.Average(m => m.Expense) : 0m;

        return TypedResults.Ok(new
        {
            from,
            to,
            year = from.Year,
            month,
            months,
            // Always includes the selected year even if it has no transactions yet, so the picker
            // can't end up unable to represent its own current selection.
            availableYears = availableYears.Append(from.Year).Distinct().OrderDescending().ToList(),
            monthlyFlow,
            categoryBreakdown = CategoryBreakdown(spending),
            excludedTransfers = transferCount,
            excludedFuture = futureCount,
            kpis = new
            {
                avgMonthlyIncome = avgIncome,
                avgMonthlyExpense = avgExpense,
                avgMonthlySurplus = avgIncome - avgExpense,
                netBalance,
            },
        });
    }

    // The transactions making up one bar of the dashboard's category breakdown. Deliberately takes
    // the same accountIds and period as the dashboard and applies the same transfer exclusion, so
    // the rows shown always add up to the total the user clicked — a drill-down that didn't
    // reconcile would be worse than none.
    private static async Task<IResult> GetByCategory(
        TransactionRepository transactions,
        ICurrentUser currentUser,
        Guid? categoryId = null,
        Guid[]? accountIds = null,
        int? year = null,
        int? month = null,
        CancellationToken ct = default)
    {
        var (from, to, _) = ResolvePeriod(year, month);

        var userId = currentUser.GetRequiredUserId();
        var allItems = await transactions.GetForPeriodAsync(userId, accountIds, from, to, ct);

        // Same exclusions as the dashboard, in the same order, so this reconciles with the bar.
        var settled = allItems.Where(t => !IsFuture(t)).ToList();
        var matching = ExcludingInternalTransfers(settled)
            .Where(t => t.Amount < 0 && t.CategoryId == categoryId)
            .OrderByDescending(t => t.BookingDate)
            .ToList();

        return TypedResults.Ok(new
        {
            categoryId,
            from,
            to,
            total = matching.Sum(t => -t.Amount),
            items = matching.Select(WithFutureFlag),
        });
    }

    private static List<TransactionListItem> ExcludingInternalTransfers(IReadOnlyList<TransactionListItem> items)
    {
        var paired = InternalTransferDetector.FindPairedIds(items);
        return items.Where(t => !paired.Contains(t.Id)).ToList();
    }

    private static List<MonthlySummaryRow> CategoryBreakdown(IReadOnlyList<TransactionListItem> items) =>
        items
            .Where(t => t.Amount < 0)
            .GroupBy(t => (t.CategoryId, t.CategoryName, t.CategoryEmoji))
            .Select(g => new MonthlySummaryRow(g.Key.CategoryId, g.Key.CategoryName, g.Key.CategoryEmoji, g.Sum(t => -t.Amount)))
            .OrderByDescending(r => r.Total)
            .ToList();

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

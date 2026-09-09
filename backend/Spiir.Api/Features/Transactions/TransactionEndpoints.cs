using Spiir.Api.Data.Repositories;
using Spiir.Api.Domain.Entities;
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
        group.MapGet("/by-flow", GetByFlow);
        group.MapGet("/query", GetQuery);
        group.MapPost("/recategorize", Recategorize);
        group.MapGet("/similar", GetSimilar);
        group.MapPost("/apply-to-similar", ApplyToSimilar);
        group.MapGet("/counterpart-candidates", GetCounterpartCandidates);
        group.MapPost("/mark-transfer", MarkTransfer);
        group.MapGet("/duplicates", GetDuplicates);
        group.MapPost("/mark-duplicate", MarkDuplicate);
        group.MapPatch("/{id:guid}/category", SetCategory);

        return app;
    }

    private static async Task<IResult> GetTransactions(
        TransactionRepository transactions,
        TagRepository tags,
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
        // Duplicates ride along with includeFuture: the dashboard wants only rows that count, the
        // per-account list wants everything on record so a mismarked duplicate can be found again.
        var (items, total) = await transactions.GetPageAsync(
            userId, page, pageSize, accountIds, from, to, includeFuture ? null : Today,
            includeDuplicates: includeFuture, ct: ct);

        // Which rows the dashboard's totals left out as matched internal transfers. Computed over
        // the whole period rather than the current page — pairing depends on the counterpart being
        // in scope, and it usually isn't on the same page. Skipped without a period: that's the
        // per-account list, where a single account can't pair against itself anyway.
        var paired = from.HasValue && to.HasValue
            ? (await LoadWithPairingAsync(transactions, userId, accountIds, from.Value, to.Value, ct)).PairedIds
            : [];

        // One lookup for the whole page rather than a query per row.
        var tagsByTransaction = await tags.GetForTransactionsAsync(userId, items.Select(t => t.Id).ToList(), ct);

        // Deliberately unscoped by period — it's what the period picker offers, so filtering it by
        // the current filter would let the picker drop the year you'd need to get back out.
        var availableYears = await transactions.GetAvailableYearsAsync(userId, accountIds, ct);

        return TypedResults.Ok(new
        {
            items = items.Select(t => WithFlags(t, IsTransfer(t, paired), tagsByTransaction[t.Id])),
            totalCount = total,
            page,
            pageSize,
            availableYears = availableYears.Append(year ?? Today.Year).Distinct().OrderDescending().ToList(),
        });
    }

    // Banks report scheduled payments alongside settled ones, dated when they will happen. They
    // haven't moved any money yet, so they're kept out of every total and flagged instead — the
    // client marks them rather than hiding them, since a scheduled payment is still worth seeing.
    private static DateOnly Today => DateOnly.FromDateTime(DateTime.UtcNow);

    private static bool IsFuture(TransactionListItem t) => t.BookingDate > Today;

    private static object WithFutureFlag(TransactionListItem t) => WithFlags(t, t.IsManualTransfer);

    // isTransfer marks a row the totals deliberately left out because it paired against an
    // opposite leg in another of the user's accounts. Surfaced so an excluded row is visibly
    // excluded — otherwise it's indistinguishable from one the matching simply missed.
    private static object WithFlags(
        TransactionListItem t, bool isTransfer, IEnumerable<TransactionTagLink>? tagLinks = null) => new
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
        t.IsDuplicate,
        IsFuture = IsFuture(t),
        IsTransfer = isTransfer,
        // Distinguished from an auto-matched pair so the UI can show that this one was a decision
        // rather than a guess, and offer to undo it.
        t.IsManualTransfer,
        Tags = (tagLinks ?? []).Select(l => new { l.TagId, l.Name }),
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
        CategoryRepository categories,
        TagRepository tags,
        ICurrentUser currentUser,
        Guid[]? accountIds = null,
        int? year = null,
        int? month = null,
        CancellationToken ct = default)
    {
        var (from, to, months) = ResolvePeriod(year, month);

        var userId = currentUser.GetRequiredUserId();
        var allCategories = await categories.GetAllForUserAsync(userId, ct);

        var availableYears = await transactions.GetAvailableYearsAsync(userId, accountIds, ct);
        // asOf: a payment scheduled for next week hasn't left the account, so it shouldn't be in
        // the balance either — the figure describes money that has actually moved.
        var netBalance = await transactions.GetNetBalanceAsync(userId, accountIds, Today, ct);

        // Scheduled payments are dated in the future and haven't happened yet; counting them would
        // report spending that may still be cancelled, and would make the current month look worse
        // than it is. Dropped before any aggregation, including transfer pairing — a future leg
        // has no settled counterpart to net against.
        var (items, pairedIds) = await LoadWithPairingAsync(transactions, userId, accountIds, from, to, ct);
        var allInPeriod = await transactions.GetForPeriodAsync(userId, accountIds, from, to, ct);
        var futureCount = allInPeriod.Count(IsFuture);

        // Matched transfers are dropped from income, expenses and category spending: both legs are
        // in view, they cancel out, and counting them would inflate both sides by the same amount
        // while describing no real money in or out. Net balance deliberately keeps them — it
        // reflects what's actually sitting in the accounts, and a matched pair already sums to zero.
        var spending = items.Where(t => !IsTransfer(t, pairedIds)).ToList();
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

        // Months of the period that actually saw spending. Per-month averages divide by this
        // rather than by the period length: a year that's only half elapsed would otherwise be
        // averaged against months that haven't happened, halving every figure.
        var monthsWithData = spending
            .Where(t => t.Amount < 0)
            .Select(t => (t.BookingDate.Year, t.BookingDate.Month))
            .Distinct()
            .Count();

        return TypedResults.Ok(new
        {
            from,
            to,
            year = from.Year,
            month,
            months,
            monthsWithData,
            // Always includes the selected year even if it has no transactions yet, so the picker
            // can't end up unable to represent its own current selection.
            availableYears = availableYears.Append(from.Year).Distinct().OrderDescending().ToList(),
            monthlyFlow,
            // Rolled up to top-level groups: a budget is read at that level, and the category page
            // is where a group gets broken back down into its leaves.
            categoryBreakdown = RollUpToGroups(CategoryBreakdown(spending), allCategories),
            // Committed versus discretionary — the split a budget is actually acted on. Derived
            // from the category's declared kind rather than inferred from how often it recurs.
            spendingByKind = SpendingByKind(spending, allCategories),
            tagBreakdown = await TagBreakdownAsync(tags, userId, spending, ct),
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

    // The rows behind any figure on any page. Every calculated number links here with the filters
    // that produced it, so a total the reader doesn't believe can always be opened and counted.
    //
    // The filters mirror the aggregations one-for-one — same scope, same exclusions, same order —
    // because a drill-down that doesn't reconcile with the number it came from is worse than no
    // drill-down at all.
    private static async Task<IResult> GetQuery(
        TransactionRepository transactions,
        CategoryRepository categories,
        TagRepository tags,
        ICurrentUser currentUser,
        Guid[]? accountIds = null,
        int? year = null,
        int? month = null,
        // "settled" is the set every dashboard figure is computed over: no matched transfers, no
        // scheduled payments, no duplicates. The others open the rows those exclusions removed,
        // and "balance" is the net-balance figure's own scope — everything up to today, transfers
        // included, since a matched pair nets to zero and still belongs to what's in the account.
        string scope = "settled",
        Guid? categoryId = null,
        bool uncategorized = false,
        Guid? tagId = null,
        string? merchant = null,
        string? kind = null,
        string? direction = null,
        CancellationToken ct = default)
    {
        var userId = currentUser.GetRequiredUserId();
        var allCategories = await categories.GetAllForUserAsync(userId, ct);
        var isBalance = scope.Equals("balance", StringComparison.OrdinalIgnoreCase);

        var (from, to, months) = ResolvePeriod(year, month);

        List<TransactionListItem> rows;
        if (isBalance)
        {
            // Net balance is not period-scoped: it's everything that has actually moved, up to
            // today. Scoping it to the selected period would describe a different number.
            rows = (await transactions.GetForPeriodAsync(userId, accountIds, new DateOnly(1900, 1, 1), Today.AddDays(1), ct))
                .Where(t => !IsFuture(t))
                .ToList();
        }
        else
        {
            var (settled, pairedIds) = await LoadWithPairingAsync(transactions, userId, accountIds, from, to, ct);
            var inPeriod = await transactions.GetForPeriodAsync(userId, accountIds, from, to, ct);

            rows = scope.ToLowerInvariant() switch
            {
                // Scheduled payments never reach LoadWithPairingAsync — it drops them — so this
                // one reads the unfiltered period instead.
                "future" => inPeriod.Where(IsFuture).ToList(),
                "transfers" => settled.Where(t => IsTransfer(t, pairedIds)).ToList(),
                _ => settled.Where(t => !IsTransfer(t, pairedIds)).ToList(),
            };
        }

        // A group means the group and its leaves, same as the category page — transactions file
        // to leaves, so matching the group alone would find nothing.
        if (categoryId is { } cid)
        {
            var wanted = new HashSet<Guid>(
                allCategories.Where(c => c.ParentCategoryId == cid).Select(c => c.Id)) { cid };
            rows = rows.Where(t => t.CategoryId is { } c && wanted.Contains(c)).ToList();
        }
        else if (uncategorized)
        {
            rows = rows.Where(t => t.CategoryId is null).ToList();
        }

        if (kind is not null)
        {
            var kindById = allCategories.ToDictionary(c => c.Id, c => c.Kind);
            rows = rows
                .Where(t => t.CategoryId is { } c
                            && kindById.TryGetValue(c, out var k)
                            && k.Equals(kind, StringComparison.OrdinalIgnoreCase))
                .ToList();
        }

        if (merchant is not null)
            rows = rows
                .Where(t => MerchantNormalizer.MerchantKey(t.Description)
                    .Equals(merchant, StringComparison.OrdinalIgnoreCase))
                .ToList();

        if (direction is not null)
        {
            var wantIncome = direction.Equals("income", StringComparison.OrdinalIgnoreCase);
            rows = rows.Where(t => wantIncome ? t.Amount > 0 : t.Amount < 0).ToList();
        }

        // Applied last: the tag lookup only needs the rows that survived everything else.
        var links = await tags.GetForTransactionsAsync(userId, rows.Select(t => t.Id).ToList(), ct);
        if (tagId is { } tid)
            rows = rows.Where(t => links[t.Id].Any(l => l.TagId == tid)).ToList();

        rows = rows.OrderByDescending(t => t.BookingDate).ThenBy(t => t.Description).ToList();

        var inflow = rows.Where(t => t.Amount > 0).Sum(t => t.Amount);
        var outflow = rows.Where(t => t.Amount < 0).Sum(t => -t.Amount);

        var byMonth = rows
            .GroupBy(t => (t.BookingDate.Year, t.BookingDate.Month))
            .ToDictionary(g => g.Key, g => g.Sum(t => t.Amount));

        // Only meaningful for a period-scoped query; the balance scope spans all history and has
        // no fixed month count to lay out against.
        var monthlyTotals = isBalance
            ? []
            : Enumerable.Range(0, months)
                .Select(i => from.AddMonths(i))
                .Select(d =>
                {
                    byMonth.TryGetValue((d.Year, d.Month), out var net);
                    return new { d.Year, d.Month, Net = net };
                })
                .ToList();

        return TypedResults.Ok(new
        {
            scope = isBalance ? "balance" : scope.ToLowerInvariant(),
            from = isBalance ? (DateOnly?)null : from,
            to = isBalance ? (DateOnly?)null : to,
            year = isBalance ? (int?)null : from.Year,
            month,
            months = isBalance ? 0 : months,
            // All three are returned because different figures on the pages mean different ones:
            // an expense bar means outflow, an income bar inflow, net balance and the net line
            // mean net. The caller displays the one it linked from.
            net = inflow - outflow,
            inflow,
            outflow,
            count = rows.Count,
            // Months of the period that saw any of these rows — the divisor behind any figure
            // presented as a monthly average.
            monthsWithData = byMonth.Count,
            monthlyTotals,
            items = rows.Select(t => WithFlags(t, t.IsManualTransfer, links[t.Id])),
        });
    }

    // One bar of the monthly cash flow chart: everything in or out of a single month, in one
    // direction. Applies the same exclusions the chart's own figures do — matched transfers,
    // scheduled payments and duplicates — so the total here is the height of the bar clicked.
    private static async Task<IResult> GetByFlow(
        TransactionRepository transactions,
        CategoryRepository categories,
        TagRepository tags,
        ICurrentUser currentUser,
        string direction = "expense",
        Guid[]? accountIds = null,
        int? year = null,
        int? month = null,
        CancellationToken ct = default)
    {
        var income = string.Equals(direction, "income", StringComparison.OrdinalIgnoreCase);
        var (from, to, monthCount) = ResolvePeriod(year, month);

        var userId = currentUser.GetRequiredUserId();
        var allCategories = await categories.GetAllForUserAsync(userId, ct);

        var (settled, pairedIds) = await LoadWithPairingAsync(transactions, userId, accountIds, from, to, ct);
        var nonTransfer = settled.Where(t => !IsTransfer(t, pairedIds)).ToList();

        // Strictly one side. Unlike a category — where a refund belongs to the category that the
        // purchase did — an income bar is the sum of money in and nothing else, so mixing
        // directions would stop the total matching the bar.
        var matching = nonTransfer
            .Where(t => income ? t.Amount > 0 : t.Amount < 0)
            .OrderByDescending(t => t.BookingDate)
            .ToList();

        // Positive throughout, whichever direction: a bar has a height, not a sign.
        decimal Magnitude(TransactionListItem t) => income ? t.Amount : -t.Amount;
        var total = matching.Sum(Magnitude);

        // Grouped to top-level groups, matching how the dashboard's category chart reads, so
        // clicking through from either place tells the same story.
        var groupOf = allCategories.ToDictionary(c => c.Id, c => c.ParentCategoryId ?? c.Id);
        var nameById = allCategories.ToDictionary(c => c.Id, c => (c.Name, c.Emoji));
        var byCategory = matching
            .GroupBy(t => t.CategoryId is { } c && groupOf.TryGetValue(c, out var g) ? g : (Guid?)null)
            .Select(g => new
            {
                CategoryId = g.Key,
                Name = g.Key is { } k && nameById.TryGetValue(k, out var n) ? n.Name : null,
                Emoji = g.Key is { } k2 && nameById.TryGetValue(k2, out var n2) ? n2.Emoji : null,
                Total = g.Sum(Magnitude),
                Count = g.Count(),
            })
            .OrderByDescending(c => c.Total)
            .ToList();

        var bySource = matching
            .GroupBy(t => MerchantNormalizer.MerchantKey(t.Description), StringComparer.OrdinalIgnoreCase)
            .Select(g => new
            {
                Merchant = g.Key,
                Total = g.Sum(Magnitude),
                Count = g.Count(),
                Average = g.Average(Magnitude),
                Largest = g.Max(Magnitude),
            })
            .OrderByDescending(m => m.Total)
            .ToList();

        var byAccount = matching
            .GroupBy(t => t.BankAccountId)
            .Select(g => new { BankAccountId = g.Key, Total = g.Sum(Magnitude), Count = g.Count() })
            .OrderByDescending(a => a.Total)
            .ToList();

        var byMonth = matching
            .GroupBy(t => (t.BookingDate.Year, t.BookingDate.Month))
            .ToDictionary(g => g.Key, g => g.Sum(Magnitude));

        var monthlyTotals = Enumerable.Range(0, monthCount)
            .Select(i => from.AddMonths(i))
            .Select(d =>
            {
                byMonth.TryGetValue((d.Year, d.Month), out var amount);
                return new { d.Year, d.Month, Total = amount };
            })
            .ToList();

        // The comparison that makes a single month readable: is this one normal? Averaged over
        // months that actually had activity, so a part-year doesn't drag the baseline down.
        var monthsWithData = byMonth.Count(kv => kv.Value > 0);
        var periodAverage = monthsWithData > 0 ? byMonth.Values.Sum() / monthsWithData : 0m;

        var tagLinks = await tags.GetForTransactionsAsync(userId, matching.Select(t => t.Id).ToList(), ct);

        return TypedResults.Ok(new
        {
            direction = income ? "income" : "expense",
            from,
            to,
            year = from.Year,
            month,
            total,
            byCategory,
            bySource,
            byAccount,
            monthlyTotals,
            tagBreakdown = TagTotals(matching, tagLinks),
            stats = new
            {
                transactionCount = matching.Count,
                average = matching.Count > 0 ? total / matching.Count : 0m,
                largest = matching.Count > 0 ? matching.Max(Magnitude) : 0m,
                // Null when there's nothing to compare against — a single month of history has
                // no "usual" to be above or below, and inventing one would mislead.
                periodAverage = monthsWithData > 1 ? periodAverage : (decimal?)null,
                monthsWithData,
            },
            items = matching.Select(t => WithFlags(t, t.IsManualTransfer, tagLinks[t.Id])),
        });
    }

    // The transactions making up one bar of the dashboard's category breakdown. Deliberately takes
    // the same accountIds and period as the dashboard and applies the same transfer exclusion, so
    // the rows shown always add up to the total the user clicked — a drill-down that didn't
    // reconcile would be worse than none.
    private static async Task<IResult> GetByCategory(
        TransactionRepository transactions,
        CategoryRepository categories,
        TagRepository tags,
        ICurrentUser currentUser,
        Guid? categoryId = null,
        Guid[]? accountIds = null,
        int? year = null,
        int? month = null,
        CancellationToken ct = default)
    {
        var (from, to, _) = ResolvePeriod(year, month);

        var userId = currentUser.GetRequiredUserId();
        var allCategories = await categories.GetAllForUserAsync(userId, ct);

        // The dashboard's bars are top-level groups, but transactions file to leaves — so asking
        // for a group has to mean the group and everything under it, or clicking a bar would find
        // nothing at all. A leaf just matches itself.
        var children = categoryId is { } id
            ? allCategories.Where(c => c.ParentCategoryId == id).Select(c => c.Id).ToList()
            : [];
        var wanted = categoryId is { } self ? new HashSet<Guid>(children) { self } : [];
        bool Matches(TransactionListItem t) =>
            categoryId is null ? t.CategoryId is null : t.CategoryId is { } c && wanted.Contains(c);

        // Same exclusions as the dashboard, in the same order, so this reconciles with the bar.
        // Both directions are included: a refund carrying the category belongs to it as much as
        // the purchase did, and netting it off is the only figure that describes what the
        // category actually cost.
        var (settled, pairedIds) = await LoadWithPairingAsync(transactions, userId, accountIds, from, to, ct);
        var nonTransfer = settled.Where(t => !IsTransfer(t, pairedIds)).ToList();
        var matching = nonTransfer
            .Where(Matches)
            .OrderByDescending(t => t.BookingDate)
            .ToList();

        // Sign convention throughout: positive means money out. So a refund (a deposit) reduces
        // the total, and a category whose refunds outweigh its spending goes negative.
        var total = matching.Sum(t => -t.Amount);
        var spendTotal = matching.Where(t => t.Amount < 0).Sum(t => -t.Amount);
        var refundTotal = matching.Where(t => t.Amount > 0).Sum(t => t.Amount);
        var monthsInPeriod = ResolvePeriod(year, month).MonthCount;

        // Share denominator is the net spend of the bars the dashboard actually draws — grouped
        // the same way, so a group's share is measured against other groups rather than against
        // individual leaves. Net-positive only, so income categories don't inflate it.
        var groupIdByCategory = allCategories.ToDictionary(
            c => c.Id, c => c.ParentCategoryId ?? c.Id);
        var totalSpending = nonTransfer
            .GroupBy(t => t.CategoryId is { } c && groupIdByCategory.TryGetValue(c, out var g) ? g : t.CategoryId)
            .Select(g => g.Sum(t => -t.Amount))
            .Where(v => v > 0)
            .Sum();

        // Which months of the period actually have data. Averages divide by this rather than by
        // the period length, so a part-way-through year doesn't understate the monthly rate by
        // averaging real months against months that haven't happened.
        var monthsWithData = nonTransfer
            .Where(t => t.Amount < 0)
            .Select(t => (t.BookingDate.Year, t.BookingDate.Month))
            .Distinct()
            .Count();
        var divisor = Math.Max(1, monthsWithData);

        var byMonth = matching
            .GroupBy(t => (t.BookingDate.Year, t.BookingDate.Month))
            .ToDictionary(g => g.Key, g => g.Sum(t => -t.Amount));

        var monthlyTotals = Enumerable.Range(0, monthsInPeriod)
            .Select(i => from.AddMonths(i))
            .Select(d =>
            {
                byMonth.TryGetValue((d.Year, d.Month), out var amount);
                return new { d.Year, d.Month, Total = amount };
            })
            .ToList();

        // Grouped by the same merchant key the categorisation rules use, so "where does this
        // category actually go" lines up with what a learned rule would match on.
        var merchants = matching
            .GroupBy(t => MerchantNormalizer.MerchantKey(t.Description), StringComparer.OrdinalIgnoreCase)
            .Select(g => new
            {
                Merchant = g.Key,
                Total = g.Sum(t => -t.Amount),
                Count = g.Count(),
                Average = g.Average(t => -t.Amount),
                Largest = g.Max(t => -t.Amount),
                RefundTotal = g.Where(t => t.Amount > 0).Sum(t => t.Amount),
                MonthsPresent = g.Select(t => (t.BookingDate.Year, t.BookingDate.Month)).Distinct().Count(),
                // Present in most months of a multi-month period — a standing cost rather than a
                // one-off. Meaningless over a single month, so never flagged there. Counted on
                // charges only: a merchant that refunded you in three months isn't a standing cost.
                IsRecurring = monthsInPeriod > 1
                              && g.Where(t => t.Amount < 0)
                                  .Select(t => (t.BookingDate.Year, t.BookingDate.Month)).Distinct().Count()
                                 >= Math.Max(2, (int)Math.Ceiling(divisor * 0.6)),
            })
            .OrderByDescending(m => m.Total)
            .ToList();

        var byAccount = matching
            .GroupBy(t => t.BankAccountId)
            .Select(g => new { BankAccountId = g.Key, Total = g.Sum(t => -t.Amount), Count = g.Count() })
            .OrderByDescending(a => a.Total)
            .ToList();

        var tagLinks = await tags.GetForTransactionsAsync(userId, matching.Select(t => t.Id).ToList(), ct);

        // What a group is made of. Empty for a leaf, which has nothing to break down. Rows the
        // group holds directly (filed on the group itself rather than a leaf) appear as "Other",
        // so the parts always add up to the whole.
        var nameById = allCategories.ToDictionary(c => c.Id, c => (c.Name, c.Emoji));
        var childBreakdown = children.Count == 0
            ? []
            : matching
                .GroupBy(t => t.CategoryId == categoryId ? (Guid?)null : t.CategoryId)
                .Select(g => new
                {
                    CategoryId = g.Key,
                    Name = g.Key is { } k && nameById.TryGetValue(k, out var n) ? n.Name : "Other",
                    Emoji = g.Key is { } k2 && nameById.TryGetValue(k2, out var n2) ? n2.Emoji : null,
                    Total = g.Sum(t => -t.Amount),
                    Count = g.Count(),
                })
                .OrderByDescending(c => c.Total)
                .ToList();

        return TypedResults.Ok(new
        {
            categoryId,
            childBreakdown,
            from,
            to,
            year = from.Year,
            month,
            total,
            monthlyTotals,
            merchants,
            byAccount,
            spendTotal,
            refundTotal,
            stats = new
            {
                transactionCount = matching.Count,
                refundCount = matching.Count(t => t.Amount > 0),
                averagePerMonth = total / divisor,
                // Averaged over charges only — mixing refunds in would drag the "typical purchase"
                // figure toward zero and describe nothing real.
                averageTransaction = matching.Count(t => t.Amount < 0) is var charges && charges > 0
                    ? spendTotal / charges
                    : 0m,
                largest = matching.Any(t => t.Amount < 0) ? matching.Where(t => t.Amount < 0).Max(t => -t.Amount) : 0m,
                // What share of everything spent in this period landed in this category.
                shareOfSpending = totalSpending > 0 ? total / totalSpending : 0m,
                recurringTotal = merchants.Where(m => m.IsRecurring).Sum(m => m.Total),
                monthsWithData,
            },
            // How this category splits across the labels the user put on it by hand — the
            // "Padel" slice of Fritid, the "Clara" slice of Familie. Only tags present here.
            tagBreakdown = TagTotals(matching, tagLinks),
            items = matching.Select(t => WithFlags(t, t.IsManualTransfer, tagLinks[t.Id])),
        });
    }

    // Tag totals over an already-filtered set of rows, same sign convention as the caller's
    // totals (positive = money out). A transaction with two tags counts toward both, so these
    // deliberately do not sum to the category total.
    private static object TagTotals(
        IReadOnlyList<TransactionListItem> rows, ILookup<Guid, TransactionTagLink> links) =>
        rows
            .SelectMany(t => links[t.Id].Select(l => (Link: l, t.Amount)))
            .GroupBy(x => x.Link.TagId)
            .Select(g => new
            {
                TagId = g.Key,
                Name = g.First().Link.Name,
                Total = g.Sum(x => -x.Amount),
                Count = g.Count(),
            })
            .OrderByDescending(x => x.Total)
            .ToList();

    // Leaf totals folded into their top-level group. A leaf without a parent is already top-level
    // and stands as its own group, so a category the tree doesn't name still appears.
    private static List<MonthlySummaryRow> RollUpToGroups(
        IReadOnlyList<MonthlySummaryRow> leaves, IReadOnlyList<Category> allCategories)
    {
        var byId = allCategories.ToDictionary(c => c.Id);

        return leaves
            .GroupBy(row =>
            {
                if (row.CategoryId is null || !byId.TryGetValue(row.CategoryId.Value, out var category))
                    return (Id: (Guid?)null, Name: (string?)null, Emoji: (string?)null);

                var group = category.ParentCategoryId is { } parentId && byId.TryGetValue(parentId, out var parent)
                    ? parent
                    : category;
                return (Id: (Guid?)group.Id, Name: (string?)group.Name, Emoji: group.Emoji);
            })
            .Select(g => new MonthlySummaryRow(g.Key.Id, g.Key.Name, g.Key.Emoji, g.Sum(r => r.Total)))
            .OrderByDescending(r => r.Total)
            .ToList();
    }

    private static object SpendingByKind(
        IReadOnlyList<TransactionListItem> spending, IReadOnlyList<Category> allCategories)
    {
        var kindById = allCategories.ToDictionary(c => c.Id, c => c.Kind);

        decimal TotalFor(string kind) => spending
            .Where(t => t.Amount < 0
                        && t.CategoryId is { } id
                        && kindById.TryGetValue(id, out var k)
                        && k == kind)
            .Sum(t => -t.Amount);

        var fixedTotal = TotalFor(CategoryKind.Fixed);
        var variableTotal = TotalFor(CategoryKind.Variable);

        return new
        {
            @fixed = fixedTotal,
            variable = variableTotal,
            savings = TotalFor(CategoryKind.Savings),
            debt = TotalFor(CategoryKind.Debt),
            // Spending that hasn't been filed anywhere yet, kept separate rather than folded into
            // variable — otherwise the split would quietly overstate what's discretionary.
            uncategorized = spending
                .Where(t => t.Amount < 0 && (t.CategoryId is null || !kindById.ContainsKey(t.CategoryId.Value)))
                .Sum(t => -t.Amount),
        };
    }

    private static async Task<object> TagBreakdownAsync(
        TagRepository tags, Guid userId, IReadOnlyList<TransactionListItem> spending, CancellationToken ct)
    {
        // Scoped to the transactions already in view, so a tag total sits in the same period and
        // account filter as everything else on the page.
        var links = await tags.GetForTransactionsAsync(userId, spending.Select(t => t.Id).ToList(), ct);
        var amountById = spending.ToDictionary(t => t.Id, t => t.Amount);

        return links
            .SelectMany(g => g.Select(link => (link.TagId, link.Name, Amount: amountById[g.Key])))
            .GroupBy(x => (x.TagId, x.Name))
            .Select(g => new
            {
                tagId = g.Key.TagId,
                name = g.Key.Name,
                total = g.Where(x => x.Amount < 0).Sum(x => -x.Amount),
                count = g.Count(),
            })
            .Where(t => t.count > 0)
            .OrderByDescending(t => t.total)
            .ToList();
    }

    private static List<TransactionListItem> ExcludingInternalTransfers(IReadOnlyList<TransactionListItem> items) =>
        items.Where(t => !IsTransfer(t, InternalTransferDetector.FindPairedIds(items))).ToList();

    // A transfer is either one the user marked by hand — which always wins, since they can see a
    // counterpart the data doesn't contain — or one the matcher paired off.
    private static bool IsTransfer(TransactionListItem t, HashSet<Guid> pairedIds) =>
        t.IsManualTransfer || pairedIds.Contains(t.Id);

    // Pairing needs to see beyond the period being aggregated: a transfer sent on the 31st and
    // received on the 1st has one leg outside any single month, and would otherwise never pair
    // no matter which month you looked at.
    private static async Task<(List<TransactionListItem> InPeriod, HashSet<Guid> PairedIds)> LoadWithPairingAsync(
        TransactionRepository transactions,
        Guid userId,
        Guid[]? accountIds,
        DateOnly from,
        DateOnly to,
        CancellationToken ct)
    {
        var pad = InternalTransferDetector.MaxSettlementDays;
        var padded = await transactions.GetForPeriodAsync(userId, accountIds, from.AddDays(-pad), to.AddDays(pad), ct);

        // Duplicates drop out before anything else, including transfer pairing: a duplicated leg
        // would otherwise consume the pairing its original needed, leaving the real one counted
        // as income or spending.
        var settled = padded.Where(t => !IsFuture(t) && !t.IsDuplicate).ToList();
        var pairedIds = InternalTransferDetector.FindPairedIds(settled);
        var inPeriod = settled.Where(t => t.BookingDate >= from && t.BookingDate < to).ToList();

        return (inPeriod, pairedIds);
    }

    // Net per category: a refund carrying a category cancels out part of that category's spend,
    // so both directions count. Income categories therefore come out negative and are dropped by
    // the caller, which only draws positive bars — they aren't spending and don't belong here.
    private static List<MonthlySummaryRow> CategoryBreakdown(IReadOnlyList<TransactionListItem> items) =>
        items
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

    // Possible other legs for a transaction the user is marking as a transfer. Searched over a
    // wider window than the automatic matcher uses, because here a human confirms the choice —
    // showing a plausible candidate they can reject beats hiding it and leaving them stuck.
    private static async Task<IResult> GetCounterpartCandidates(
        Guid transactionId,
        TransactionRepository transactions,
        ICurrentUser currentUser,
        CancellationToken ct = default)
    {
        var userId = currentUser.GetRequiredUserId();
        var candidates = await transactions.FindCounterpartCandidatesAsync(userId, transactionId, windowDays: 14, ct);

        return TypedResults.Ok(new { items = candidates.Select(WithFutureFlag) });
    }

    private record MarkTransferRequest(Guid[] TransactionIds, bool IsTransfer);

    // Marks transactions as internal transfers by hand, which outranks the matcher in both
    // directions: it catches transfers to accounts that aren't connected (where no counterpart
    // exists to find), and clears false positives the matcher produced.
    private static async Task<IResult> MarkTransfer(
        MarkTransferRequest body,
        TransactionRepository transactions,
        ICurrentUser currentUser,
        CancellationToken ct = default)
    {
        if (body.TransactionIds.Length == 0)
            return TypedResults.BadRequest(new { error = "No transactions given." });

        var userId = currentUser.GetRequiredUserId();
        var updated = await transactions.SetTransferFlagAsync(userId, body.TransactionIds, body.IsTransfer, ct);

        return TypedResults.Ok(new
        {
            updated,
            message = body.IsTransfer
                ? $"Marked {updated} transaction(s) as a transfer."
                : $"Removed the transfer mark from {updated} transaction(s).",
        });
    }

    // Groups of transactions that look like the same payment recorded twice, for the user to
    // review. Each group suggests which copies to drop rather than deciding: when the same
    // transaction arrived from both a CSV import and a bank sync, the bank's own record is the
    // one to keep — it carries the bank's id and will keep matching on future syncs, whereas the
    // imported copy would be re-created by a re-import.
    private static async Task<IResult> GetDuplicates(
        TransactionRepository transactions,
        ICurrentUser currentUser,
        CancellationToken ct = default)
    {
        var userId = currentUser.GetRequiredUserId();
        var candidates = await transactions.FindDuplicateCandidatesAsync(userId, ct);

        var groups = candidates
            .GroupBy(c => (c.BankAccountId, c.BookingDate, c.Amount))
            .Select(g =>
            {
                var copies = g.OrderBy(c => c.CreatedAt).ToList();
                var bankCopies = copies.Where(c => c.Source == "bank").ToList();

                // Which copy survives depends on how the pair arose:
                //
                // csv + bank — keep the bank's. It carries the bank's own id, so it keeps
                //   matching on future syncs, whereas a re-import would recreate the csv one.
                // bank + bank — the bank issued the same payment under two ids, which is what
                //   happens when a pending entry is later re-issued as booked. Keep the newest:
                //   that's the one the most recent sync saw, so it's the id the bank still
                //   reports and the only one that will keep matching.
                // csv + csv — keep the first imported; neither has a bank id to prefer.
                var suggested = bankCopies.Count switch
                {
                    0 => copies.Skip(1).Select(c => c.Id).ToList(),
                    1 => copies.Where(c => c.Source == "csv").Select(c => c.Id).ToList(),
                    _ => copies.Where(c => c.Id != bankCopies[^1].Id).Select(c => c.Id).ToList(),
                };

                return new
                {
                    g.Key.BankAccountId,
                    g.Key.BookingDate,
                    g.Key.Amount,
                    Currency = copies[0].Currency,
                    // What this group looks like, so the UI can explain a pair the user never
                    // created by hand rather than leaving them to wonder.
                    Origin = bankCopies.Count switch
                    {
                        0 => "csv",
                        1 when copies.Count > 1 => "mixed",
                        _ => "bank",
                    },
                    SuggestedIds = suggested,
                    Items = copies.Select(c => new
                    {
                        c.Id, c.Description, c.Source, c.ExternalTransactionId, c.IsDuplicate, c.CreatedAt,
                    }),
                };
            })
            .OrderByDescending(g => g.BookingDate)
            .ToList();

        return TypedResults.Ok(new
        {
            groupCount = groups.Count,
            extraCount = groups.Sum(g => g.SuggestedIds.Count),
            alreadyMarked = candidates.Count(c => c.IsDuplicate),
            groups,
        });
    }

    private record MarkDuplicateRequest(Guid[] TransactionIds, bool IsDuplicate);

    // Marks copies as duplicates. Flagged, not deleted: the detection is a heuristic over
    // account+date+amount, so a wrong call has to be reversible.
    private static async Task<IResult> MarkDuplicate(
        MarkDuplicateRequest body,
        TransactionRepository transactions,
        ICurrentUser currentUser,
        CancellationToken ct = default)
    {
        if (body.TransactionIds.Length == 0)
            return TypedResults.BadRequest(new { error = "No transactions given." });

        var userId = currentUser.GetRequiredUserId();
        var updated = await transactions.SetDuplicateFlagAsync(userId, body.TransactionIds, body.IsDuplicate, ct);

        return TypedResults.Ok(new
        {
            updated,
            message = body.IsDuplicate
                ? $"Marked {updated} transaction(s) as duplicates."
                : $"Restored {updated} transaction(s).",
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

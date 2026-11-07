using Spiir.Api.Data.Repositories;
using Spiir.Api.Domain.Entities;
using Spiir.Api.Services;

namespace Spiir.Api.Features.NetWorth;

public static class NetWorthEndpoints
{
    // Values are asked for after the 5th: bank statements, pension and investment valuations for
    // the previous month are generally settled by then, so a figure recorded earlier would be
    // guesswork that the month then keeps forever.
    private const int RecordFromDay = 5;

    public static IEndpointRouteBuilder MapNetWorthEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/networth").WithTags("NetWorth").RequireAuthorization();

        group.MapGet("/accounts", GetAccounts);
        group.MapPost("/accounts", CreateAccount);
        group.MapPatch("/accounts/{id:guid}", UpdateAccount);
        group.MapDelete("/accounts/{id:guid}", DeleteAccount);

        group.MapGet("/due", GetDue);
        group.MapGet("/entry", GetEntryForm);
        group.MapPost("/entry", SaveEntry);

        group.MapPost("/import", Import);

        group.MapGet("/dashboard", GetDashboard);

        return app;
    }

    private static DateOnly Today => DateOnly.FromDateTime(DateTime.UtcNow);

    private static async Task<IResult> GetAccounts(
        NetWorthRepository repo, ICurrentUser currentUser, bool includeArchived = false,
        CancellationToken ct = default)
    {
        var accounts = await repo.GetAccountsAsync(currentUser.GetRequiredUserId(), includeArchived, ct);
        return TypedResults.Ok(accounts.Select(a => new
        {
            a.Id, a.Name, a.Kind, a.IsLiability, a.Currency, a.BankAccountId, a.IsArchived, a.SortOrder,
        }));
    }

    private record AccountRequest(string Name, string Kind, Guid? BankAccountId, bool IsArchived = false);

    private static async Task<IResult> CreateAccount(
        AccountRequest body, NetWorthRepository repo, ICurrentUser currentUser, CancellationToken ct = default)
    {
        var name = body.Name?.Trim();
        if (string.IsNullOrWhiteSpace(name))
            return TypedResults.BadRequest(new { error = "A name is required." });
        if (!NetWorthKind.IsKnown(body.Kind))
            return TypedResults.BadRequest(new { error = $"Unknown kind '{body.Kind}'." });

        var userId = currentUser.GetRequiredUserId();
        var existing = await repo.GetAccountsAsync(userId, includeArchived: true, ct);

        var account = new NetWorthAccount
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Name = name,
            Kind = body.Kind,
            // Derived, never taken from the client: the caller shouldn't be able to file a
            // mortgage as an asset and quietly double its effect on net worth.
            IsLiability = NetWorthKind.IsLiabilityKind(body.Kind),
            BankAccountId = body.BankAccountId,
            SortOrder = existing.Count,
            CreatedAt = DateTime.UtcNow,
        };
        await repo.InsertAccountAsync(account, ct);

        return TypedResults.Ok(new { account.Id, account.Name, account.Kind, account.IsLiability });
    }

    private static async Task<IResult> UpdateAccount(
        Guid id, AccountRequest body, NetWorthRepository repo, ICurrentUser currentUser,
        CancellationToken ct = default)
    {
        var name = body.Name?.Trim();
        if (string.IsNullOrWhiteSpace(name))
            return TypedResults.BadRequest(new { error = "A name is required." });
        if (!NetWorthKind.IsKnown(body.Kind))
            return TypedResults.BadRequest(new { error = $"Unknown kind '{body.Kind}'." });

        var updated = await repo.UpdateAccountAsync(
            currentUser.GetRequiredUserId(), id, name, body.Kind,
            NetWorthKind.IsLiabilityKind(body.Kind), body.BankAccountId, body.IsArchived, ct);

        return updated ? TypedResults.NoContent() : TypedResults.NotFound();
    }

    private static async Task<IResult> DeleteAccount(
        Guid id, NetWorthRepository repo, ICurrentUser currentUser, CancellationToken ct = default)
    {
        var deleted = await repo.DeleteAccountAsync(currentUser.GetRequiredUserId(), id, ct);
        return deleted ? TypedResults.NoContent() : TypedResults.NotFound();
    }

    // The month being asked for. A month becomes askable on the 5th of the month *after* it, so
    // what is recorded is always a month that has finished and settled: from the 5th of October
    // you are asked for September, and before that for August.
    private static (int Year, int Month) MonthBeingRecorded()
    {
        var today = Today;
        // Before the 5th, the most recent month you can sensibly value is the one before last.
        var anchor = today.Day >= RecordFromDay ? today : today.AddMonths(-1);
        var previous = anchor.AddMonths(-1);
        return (previous.Year, previous.Month);
    }

    private static async Task<IResult> GetDue(
        NetWorthRepository repo, ICurrentUser currentUser, CancellationToken ct = default)
    {
        var userId = currentUser.GetRequiredUserId();
        var accounts = await repo.GetAccountsAsync(userId, includeArchived: false, ct);
        var (year, month) = MonthBeingRecorded();
        var recorded = await repo.GetRecordedAccountIdsAsync(userId, year, month, ct);

        var missing = accounts.Where(a => !recorded.Contains(a.Id)).ToList();

        return TypedResults.Ok(new
        {
            year,
            month,
            // Nothing to ask for before the 5th of the following month, and nothing to ask for
            // if there are no accounts to value yet.
            isDue = accounts.Count > 0 && Today.Day >= RecordFromDay && missing.Count > 0,
            accountCount = accounts.Count,
            missingCount = missing.Count,
            missing = missing.Select(a => new { a.Id, a.Name, a.Kind, a.IsLiability }),
        });
    }

    // The entry form for one month: every account, with the last figure recorded for it as a
    // starting point. A month already recorded comes back with its own values, so the same form
    // is used to correct a month as to enter one.
    private static async Task<IResult> GetEntryForm(
        NetWorthRepository repo,
        TransactionRepository transactions,
        BankAccountRepository bankAccounts,
        ICurrentUser currentUser,
        int? year = null,
        int? month = null,
        CancellationToken ct = default)
    {
        var userId = currentUser.GetRequiredUserId();
        var (defaultYear, defaultMonth) = MonthBeingRecorded();
        var y = year ?? defaultYear;
        var m = month ?? defaultMonth;

        var accounts = await repo.GetAccountsAsync(userId, includeArchived: false, ct);
        var current = (await repo.GetPointsAsync(userId, y, ct))
            .Where(p => p.PeriodMonth == m)
            .ToDictionary(p => p.NetWorthAccountId, p => p.Value);
        var previous = await repo.GetLatestValuesAsync(userId, y, m, ct);

        // What to prefill a linked account's box with — a suggestion either way, but the two
        // possible sources are not equally good and the form says which one it used.
        //
        // The bank's own balance is the better figure when it applies, because it is the whole
        // balance rather than the part our transaction history happens to cover. It only applies
        // when the figure actually describes the month being recorded, though: this form is
        // normally opened on the 5th to record the month just finished, and a balance read on the
        // 5th of November is not October's closing balance — a salary and a rent payment have
        // landed since. So the balance is offered only when its own date falls inside the month,
        // which is the case when the account was synced at month end, and otherwise the running
        // transaction sum (computed as at month end) is the more honest starting point.
        var monthStart = new DateOnly(y, m, 1);
        var asOf = new DateOnly(y, m, DateTime.DaysInMonth(y, m));
        var linked = accounts.Where(a => a.BankAccountId is not null).ToList();

        var bankAccountsById = linked.Count == 0
            ? new Dictionary<Guid, BankAccount>()
            : (await bankAccounts.GetAllForUserAsync(userId, ct)).ToDictionary(a => a.Id);

        var suggestions = new Dictionary<Guid, (decimal Value, string Source, DateOnly AsOf)>();
        foreach (var account in linked)
        {
            var bankAccount = bankAccountsById.GetValueOrDefault(account.BankAccountId!.Value);

            // The date the stored balance describes: the bank's own reference date when it gave
            // one, otherwise the day we read it.
            DateOnly? balanceDate = bankAccount?.BalanceReferenceDate;
            if (balanceDate is null && bankAccount?.BalanceFetchedAt is { } fetched)
                balanceDate = DateOnly.FromDateTime(fetched);

            if (bankAccount?.Balance is { } balance && balanceDate is { } date
                && date >= monthStart && date <= asOf)
            {
                suggestions[account.Id] = (balance, "bank", date);
                continue;
            }

            var sum = await transactions.GetNetBalanceAsync(
                userId, [account.BankAccountId!.Value], asOf, ct);
            suggestions[account.Id] = (sum, "transactions", asOf);
        }

        return TypedResults.Ok(new
        {
            year = y,
            month = m,
            items = accounts.Select(a =>
            {
                var hasSuggestion = suggestions.TryGetValue(a.Id, out var suggestion);
                return new
                {
                    a.Id,
                    a.Name,
                    a.Kind,
                    a.IsLiability,
                    a.Currency,
                    value = current.TryGetValue(a.Id, out var v) ? v : (decimal?)null,
                    previousValue = previous.TryGetValue(a.Id, out var p) ? p : (decimal?)null,
                    suggestedValue = hasSuggestion ? suggestion.Value : (decimal?)null,
                    // "bank" (the balance the bank reported) or "transactions" (our running sum).
                    // The form labels these differently on purpose: one is the account's balance,
                    // the other is an estimate of it, and the user is recording the figure.
                    suggestedSource = hasSuggestion ? suggestion.Source : null,
                    suggestedAsOf = hasSuggestion ? suggestion.AsOf : (DateOnly?)null,
                };
            }),
        });
    }

    private record EntryRequest(int Year, int Month, EntryValue[] Values);
    private record EntryValue(Guid AccountId, decimal? Value, string? Note);

    private static async Task<IResult> SaveEntry(
        EntryRequest body, NetWorthRepository repo, ICurrentUser currentUser, CancellationToken ct = default)
    {
        if (body.Month is < 1 or > 12)
            return TypedResults.BadRequest(new { error = "Month must be 1-12." });

        var userId = currentUser.GetRequiredUserId();
        var accounts = (await repo.GetAccountsAsync(userId, includeArchived: true, ct))
            .ToDictionary(a => a.Id);

        var saved = 0;
        var cleared = 0;
        foreach (var entry in body.Values)
        {
            // Silently ignoring an unknown id would let a bad request half-succeed; skipping it
            // keeps the operation total while never writing against someone else's account.
            if (!accounts.ContainsKey(entry.AccountId)) continue;

            if (entry.Value is null)
            {
                // A blank box means "I don't have a figure for this month", which must remove any
                // stale value rather than leave last month's standing in for it.
                if (await repo.DeleteSnapshotAsync(userId, entry.AccountId, body.Year, body.Month, ct)) cleared++;
                continue;
            }

            // Stored exactly as entered. No normalising by kind: an account is not permanently
            // one side of the balance, and a forced sign can only express the case the
            // classification anticipated.
            await repo.UpsertSnapshotAsync(
                userId, entry.AccountId, body.Year, body.Month, entry.Value.Value, entry.Note, ct);
            saved++;
        }

        return TypedResults.Ok(new
        {
            saved,
            cleared,
            message = (saved, cleared) switch
            {
                (0, 0) => "Nothing recorded.",
                (0, var c) => $"Cleared {c} value(s) for {body.Year}-{body.Month:00}.",
                (var s2, 0) => $"Recorded {s2} value(s) for {body.Year}-{body.Month:00}.",
                var (s2, c) => $"Recorded {s2} and cleared {c} value(s) for {body.Year}-{body.Month:00}.",
            },
        });
    }

    private record ImportRequest(ImportAccount[] Accounts, ImportSnapshot[] Snapshots, bool Replace = false);
    private record ImportAccount(string Name, string Kind);
    private record ImportSnapshot(string Account, int Year, int Month, decimal Value);

    // Bulk import, matched on account name. Built for moving years of history out of a
    // spreadsheet, where the alternative is retyping hundreds of figures by hand.
    //
    // Idempotent by construction: accounts are matched by name rather than created blindly, and
    // snapshots go through the same upsert the monthly form uses, so running it twice lands the
    // same data rather than doubling it. That matters because a half-finished import is the
    // likely failure, and the fix has to be "run it again".
    private static async Task<IResult> Import(
        ImportRequest body, NetWorthRepository repo, ICurrentUser currentUser, CancellationToken ct = default)
    {
        var userId = currentUser.GetRequiredUserId();

        var unknownKinds = body.Accounts.Where(a => !NetWorthKind.IsKnown(a.Kind)).Select(a => a.Kind).Distinct().ToList();
        if (unknownKinds.Count > 0)
            return TypedResults.BadRequest(new { error = $"Unknown kind(s): {string.Join(", ", unknownKinds)}" });

        var existing = (await repo.GetAccountsAsync(userId, includeArchived: true, ct))
            .ToDictionary(a => a.Name, a => a, StringComparer.OrdinalIgnoreCase);

        var createdAccounts = 0;
        foreach (var incoming in body.Accounts)
        {
            var name = incoming.Name.Trim();
            if (name.Length == 0 || existing.ContainsKey(name)) continue;
            var account = new NetWorthAccount
            {
                Id = Guid.NewGuid(),
                UserId = userId,
                Name = name,
                Kind = incoming.Kind,
                IsLiability = NetWorthKind.IsLiabilityKind(incoming.Kind),
                SortOrder = existing.Count + createdAccounts,
                CreatedAt = DateTime.UtcNow,
            };
            await repo.InsertAccountAsync(account, ct);
            existing[name] = account;
            createdAccounts++;
        }

        var skipped = 0;
        var batch = new List<NetWorthRepository.SnapshotValue>(body.Snapshots.Length);
        foreach (var snapshot in body.Snapshots)
        {
            if (snapshot.Month is < 1 or > 12) { skipped++; continue; }
            if (!existing.TryGetValue(snapshot.Account.Trim(), out var account)) { skipped++; continue; }

            // Same rule as the monthly form: stored as given, sign and all.
            batch.Add(new NetWorthRepository.SnapshotValue(account.Id, snapshot.Year, snapshot.Month, snapshot.Value));
        }

        // Written in batches over one connection. An import is thousands of values, and a round
        // trip each would take long enough against a remote database for the request to be cut
        // off partway through.
        var written = await repo.UpsertSnapshotsAsync(userId, batch, ct);

        return TypedResults.Ok(new
        {
            createdAccounts,
            written,
            skipped,
            message = $"Imported {written} value(s) across {body.Accounts.Length} account(s); "
                      + $"{createdAccounts} newly created"
                      + (skipped > 0 ? $", {skipped} skipped" : "") + ".",
        });
    }

    private record MonthTotals(int Year, int Month, decimal Assets, decimal Liabilities)
    {
        public decimal Net => Assets - Liabilities;
    }

    // The progress view. scope=lifetime spans every recorded month; otherwise one calendar year.
    private static async Task<IResult> GetDashboard(
        NetWorthRepository repo,
        ICurrentUser currentUser,
        int? year = null,
        string scope = "year",
        CancellationToken ct = default)
    {
        var userId = currentUser.GetRequiredUserId();
        var lifetime = scope.Equals("lifetime", StringComparison.OrdinalIgnoreCase);
        var targetYear = year ?? Today.Year;

        var points = await repo.GetPointsAsync(userId, lifetime ? null : targetYear, ct);
        var recordedYears = await repo.GetRecordedYearsAsync(userId, ct);
        var accounts = await repo.GetAccountsAsync(userId, includeArchived: true, ct);

        // One row per month that has any recording at all. Months nobody recorded are absent
        // rather than zero — a gap in the record is not a month where everything was worth
        // nothing, and plotting it as zero would draw a cliff that never happened.
        var series = points
            .GroupBy(p => (p.PeriodYear, p.PeriodMonth))
            .OrderBy(g => g.Key.PeriodYear).ThenBy(g => g.Key.PeriodMonth)
            // Split by sign, not by classification. What you own is what is actually in credit
            // this month, so an overdrawn current account counts against you the way it really
            // does rather than being filed as an asset because of its kind. Net stays the plain
            // sum either way, so the two figures always reconcile with it.
            .Select(g => new MonthTotals(
                g.Key.PeriodYear,
                g.Key.PeriodMonth,
                g.Where(p => p.Value > 0).Sum(p => p.Value),
                g.Where(p => p.Value < 0).Sum(p => -p.Value)))
            .ToList();

        var latest = series.LastOrDefault();
        var first = series.FirstOrDefault();
        var previous = series.Count >= 2 ? series[^2] : null;

        // Per kind, at the latest month, plus how it moved. This is what makes "are the loans
        // falling and the investments rising" answerable — a single net figure can rise while
        // debt rises too, and that is exactly the case worth catching.
        var latestKey = latest is null ? (0, 0) : (latest.Year, latest.Month);
        var firstKey = first is null ? (0, 0) : (first.Year, first.Month);
        var previousKey = previous is null ? (0, 0) : (previous.Year, previous.Month);

        decimal SumFor((int, int) key, Func<NetWorthPoint, bool> predicate) => points
            .Where(p => (p.PeriodYear, p.PeriodMonth) == key && predicate(p))
            .Sum(p => p.Value);

        var byKind = points
            .Where(p => (p.PeriodYear, p.PeriodMonth) == latestKey)
            .GroupBy(p => p.Kind)
            .Select(g => new
            {
                kind = g.Key,
                isLiability = g.First().IsLiability,
                value = g.Sum(p => p.Value),
                // Movement is measured against the first month in view, so the year view answers
                // "how has this moved this year" and lifetime answers it since records began.
                since = SumFor(firstKey, p => p.Kind == g.Key),
                sinceLastMonth = SumFor(previousKey, p => p.Kind == g.Key),
            })
            .OrderByDescending(k => k.value)
            .ToList();

        var byAccount = points
            .Where(p => (p.PeriodYear, p.PeriodMonth) == latestKey)
            .Select(p => new
            {
                accountId = p.NetWorthAccountId,
                name = p.AccountName,
                p.Kind,
                p.IsLiability,
                value = p.Value,
                since = SumFor(firstKey, x => x.NetWorthAccountId == p.NetWorthAccountId),
                sinceLastMonth = SumFor(previousKey, x => x.NetWorthAccountId == p.NetWorthAccountId),
            })
            .OrderBy(a => a.IsLiability).ThenByDescending(a => a.value)
            .ToList();

        return TypedResults.Ok(new
        {
            scope = lifetime ? "lifetime" : "year",
            year = lifetime ? (int?)null : targetYear,
            // Always includes the selected year, so the picker can represent its own selection
            // even before anything is recorded in it.
            availableYears = recordedYears.Append(targetYear).Append(Today.Year)
                .Distinct().OrderDescending().ToList(),
            hasAnyRecords = recordedYears.Count > 0,
            accountCount = accounts.Count(a => !a.IsArchived),
            series = series.Select(s => new { s.Year, s.Month, s.Assets, s.Liabilities, s.Net }),
            latest = latest is null ? null : new
            {
                latest.Year, latest.Month, latest.Assets, latest.Liabilities, latest.Net,
                // Change over the period in view, and over the last recorded month. Null rather
                // than zero when there's nothing to compare against — one data point is not a
                // trend, and "+0" would claim it was flat.
                changeInPeriod = first is null || first == latest ? (decimal?)null : latest.Net - first.Net,
                changeLastMonth = previous is null ? (decimal?)null : latest.Net - previous.Net,
                monthsRecorded = series.Count,
            },
            byKind,
            byAccount,
        });
    }
}

using Dapper;
using Spiir.Api.Domain.Entities;

namespace Spiir.Api.Data.Repositories;

public record TransactionListItem(
    Guid Id,
    Guid BankAccountId,
    DateOnly BookingDate,
    decimal Amount,
    string Currency,
    string Description,
    Guid? CategoryId,
    string? CategoryName,
    string? CategoryEmoji,
    bool IsCategoryManual,
    bool IsManualTransfer);

public record MonthlySummaryRow(Guid? CategoryId, string? CategoryName, string? CategoryEmoji, decimal Total);
public record MonthlyFlowRow(int Year, int Month, decimal Income, decimal Expense);

public class TransactionRepository(IDbConnectionFactory connectionFactory)
{
    // IReadOnlyList<Guid>? accountIds: null or empty means "all accounts" (no filter). The
    // accountIds parameter is always passed to Dapper even when unused by the SQL text (e.g. when
    // the filter clause is omitted) — Dapper ignores parameters the query text doesn't reference.
    private static string AccountFilterClause(IReadOnlyList<Guid>? accountIds) =>
        accountIds is { Count: > 0 } ? "AND t.BankAccountId IN @accountIds" : "";

    // Years the user actually has transactions in, so the dashboard's year picker only offers
    // years with something to show.
    public async Task<IReadOnlyList<int>> GetAvailableYearsAsync(
        Guid userId, IReadOnlyList<Guid>? accountIds, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        var filter = AccountFilterClause(accountIds);
        var rows = await conn.QueryAsync<int>(
            $"""
            SELECT DISTINCT YEAR(t.BookingDate) FROM Transactions t
            WHERE t.UserId = @userId {filter}
            ORDER BY 1 DESC
            """,
            new { userId, accountIds });
        return rows.AsList();
    }

    // Transactions in a period, for the accounts in view. The dashboard aggregates these in memory
    // rather than in SQL because internal transfers have to be paired one-to-one before they can
    // be excluded (see InternalTransferDetector), which set-based SQL can't express cleanly.
    public async Task<IReadOnlyList<TransactionListItem>> GetForPeriodAsync(
        Guid userId, IReadOnlyList<Guid>? accountIds, DateOnly from, DateOnly to, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        var filter = AccountFilterClause(accountIds);
        var rows = await conn.QueryAsync<TransactionListItem>(
            $"""
            SELECT t.Id, t.BankAccountId, t.BookingDate, t.Amount, t.Currency, t.Description,
                   t.CategoryId, c.Name AS CategoryName, c.Emoji AS CategoryEmoji, t.IsCategoryManual, t.IsManualTransfer
            FROM Transactions t
            LEFT JOIN Categories c ON c.Id = t.CategoryId
            WHERE t.UserId = @userId AND t.BookingDate >= @from AND t.BookingDate < @to {filter}
            """,
            new { userId, accountIds, from, to });
        return rows.AsList();
    }

    // from/to are optional: the dashboard scopes to its selected period, while the per-account
    // list shows everything on record. notAfter drops bank-scheduled future payments; applied in
    // SQL rather than after paging so page sizes and the total count stay consistent.
    public async Task<(IReadOnlyList<TransactionListItem> Items, int TotalCount)> GetPageAsync(
        Guid userId, int page, int pageSize, IReadOnlyList<Guid>? accountIds,
        DateOnly? from = null, DateOnly? to = null, DateOnly? notAfter = null, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        var filter = AccountFilterClause(accountIds);
        var periodFilter = from.HasValue && to.HasValue
            ? "AND t.BookingDate >= @from AND t.BookingDate < @to"
            : "";
        var futureFilter = notAfter.HasValue ? "AND t.BookingDate <= @notAfter" : "";

        var total = await conn.ExecuteScalarAsync<int>(
            $"SELECT COUNT(*) FROM Transactions t WHERE t.UserId = @userId {filter} {periodFilter} {futureFilter}",
            new { userId, accountIds, from, to, notAfter });

        var items = await conn.QueryAsync<TransactionListItem>(
            $"""
            SELECT t.Id, t.BankAccountId, t.BookingDate, t.Amount, t.Currency, t.Description,
                   t.CategoryId, c.Name AS CategoryName, c.Emoji AS CategoryEmoji, t.IsCategoryManual, t.IsManualTransfer
            FROM Transactions t
            LEFT JOIN Categories c ON c.Id = t.CategoryId
            WHERE t.UserId = @userId {filter} {periodFilter} {futureFilter}
            ORDER BY t.BookingDate DESC, t.CreatedAt DESC, t.Id DESC
            OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
            """,
            new { userId, accountIds, from, to, notAfter, offset = (page - 1) * pageSize, pageSize });

        return (items.AsList(), total);
    }

    // asOf excludes bank-reported scheduled payments dated after it — they haven't moved any money
    // yet, so including them would misstate what's actually in the accounts.
    public async Task<decimal> GetNetBalanceAsync(
        Guid userId, IReadOnlyList<Guid>? accountIds, DateOnly? asOf = null, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        var filter = AccountFilterClause(accountIds);
        var asOfFilter = asOf.HasValue ? "AND t.BookingDate <= @asOf" : "";
        return await conn.ExecuteScalarAsync<decimal>(
            $"SELECT ISNULL(SUM(t.Amount), 0) FROM Transactions t WHERE t.UserId = @userId {filter} {asOfFilter}",
            new { userId, accountIds, asOf });
    }

    public async Task<bool> SetCategoryAsync(Guid userId, Guid transactionId, Guid? categoryId, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        var rowsAffected = await conn.ExecuteAsync(
            """
            UPDATE Transactions SET CategoryId = @categoryId, IsCategoryManual = 1
            WHERE UserId = @userId AND Id = @transactionId
            """,
            new { userId, transactionId, categoryId });
        return rowsAffected > 0;
    }

    public async Task<int> SetTransferFlagAsync(
        Guid userId, IReadOnlyList<Guid> transactionIds, bool isTransfer, CancellationToken ct = default)
    {
        if (transactionIds.Count == 0) return 0;

        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        return await conn.ExecuteAsync(
            "UPDATE Transactions SET IsManualTransfer = @isTransfer WHERE UserId = @userId AND Id IN @transactionIds",
            new { userId, transactionIds, isTransfer });
    }

    // Candidates for "is this the other leg?": opposite amount, a different account, near in time.
    // Deliberately wider than the automatic matcher's window — the user is choosing from this list,
    // so it should err toward showing a plausible counterpart rather than hiding it.
    public async Task<IReadOnlyList<TransactionListItem>> FindCounterpartCandidatesAsync(
        Guid userId, Guid transactionId, int windowDays, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        var rows = await conn.QueryAsync<TransactionListItem>(
            """
            SELECT t.Id, t.BankAccountId, t.BookingDate, t.Amount, t.Currency, t.Description,
                   t.CategoryId, c.Name AS CategoryName, c.Emoji AS CategoryEmoji, t.IsCategoryManual, t.IsManualTransfer
            FROM Transactions t
            LEFT JOIN Categories c ON c.Id = t.CategoryId
            CROSS JOIN (SELECT Amount, BookingDate, BankAccountId FROM Transactions
                        WHERE UserId = @userId AND Id = @transactionId) AS src
            WHERE t.UserId = @userId
              AND t.Id <> @transactionId
              AND t.BankAccountId <> src.BankAccountId
              AND t.Amount = -src.Amount
              AND ABS(DATEDIFF(DAY, t.BookingDate, src.BookingDate)) <= @windowDays
            ORDER BY ABS(DATEDIFF(DAY, t.BookingDate, src.BookingDate)), t.BookingDate DESC
            """,
            new { userId, transactionId, windowDays });
        return rows.AsList();
    }

    // Full rows (not just descriptions) for the "apply to similar transactions?" preview, so the
    // user can see date/amount/current category before deciding which ones to include.
    public async Task<IReadOnlyList<TransactionListItem>> GetAutoCategorizedForPreviewAsync(
        Guid userId, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        var rows = await conn.QueryAsync<TransactionListItem>(
            """
            SELECT t.Id, t.BankAccountId, t.BookingDate, t.Amount, t.Currency, t.Description,
                   t.CategoryId, c.Name AS CategoryName, c.Emoji AS CategoryEmoji, t.IsCategoryManual, t.IsManualTransfer
            FROM Transactions t
            LEFT JOIN Categories c ON c.Id = t.CategoryId
            WHERE t.UserId = @userId AND t.IsCategoryManual = 0
            ORDER BY t.BookingDate DESC, t.CreatedAt DESC, t.Id DESC
            """,
            new { userId });
        return rows.AsList();
    }

    public async Task<string?> GetDescriptionAsync(Guid userId, Guid transactionId, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        return await conn.QuerySingleOrDefaultAsync<string?>(
            "SELECT Description FROM Transactions WHERE UserId = @userId AND Id = @transactionId",
            new { userId, transactionId });
    }

    // Auto-categorized rows only (IsCategoryManual = 0) — a user's own explicit choice is
    // authoritative and must never be overwritten by a rule learned from a different transaction.
    // onlyUncategorized limits it further to rows nothing has managed to categorize yet.
    public async Task<IReadOnlyList<(Guid Id, string Description)>> GetAutoCategorizedDescriptionsAsync(
        Guid userId, bool onlyUncategorized = false, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        var uncategorizedFilter = onlyUncategorized ? "AND CategoryId IS NULL" : "";
        var rows = await conn.QueryAsync<(Guid Id, string Description)>(
            $"SELECT Id, Description FROM Transactions WHERE UserId = @userId AND IsCategoryManual = 0 {uncategorizedFilter}",
            new { userId });
        return rows.AsList();
    }

    public async Task<int> SetCategoryForManyAsync(
        Guid userId, IReadOnlyList<Guid> transactionIds, Guid categoryId, CancellationToken ct = default)
    {
        if (transactionIds.Count == 0) return 0;

        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        // IsCategoryManual stays 0: these were set by a learned rule, not chosen row-by-row, so a
        // later rule change is still free to recategorize them.
        return await conn.ExecuteAsync(
            "UPDATE Transactions SET CategoryId = @categoryId WHERE UserId = @userId AND Id IN @transactionIds AND IsCategoryManual = 0",
            new { userId, transactionIds, categoryId });
    }

    public async Task<HashSet<string>> GetExistingExternalIdsAsync(Guid userId, Guid bankAccountId, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        var ids = await conn.QueryAsync<string>(
            "SELECT ExternalTransactionId FROM Transactions WHERE UserId = @userId AND BankAccountId = @bankAccountId",
            new { userId, bankAccountId });
        return ids.ToHashSet();
    }

    public async Task InsertAsync(Transaction transaction, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(
            """
            INSERT INTO Transactions
                (Id, UserId, BankAccountId, ExternalTransactionId, BookingDate, Amount, Currency,
                 Description, CategoryId, IsCategoryManual, CreatedAt)
            VALUES
                (@Id, @UserId, @BankAccountId, @ExternalTransactionId, @BookingDate, @Amount, @Currency,
                 @Description, @CategoryId, @IsCategoryManual, @CreatedAt)
            """,
            transaction);
    }
}

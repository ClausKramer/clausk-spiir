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
    bool IsCategoryManual);

public record MonthlySummaryRow(Guid? CategoryId, string? CategoryName, string? CategoryEmoji, decimal Total);
public record MonthlyFlowRow(int Year, int Month, decimal Income, decimal Expense);

public class TransactionRepository(IDbConnectionFactory connectionFactory)
{
    // IReadOnlyList<Guid>? accountIds: null or empty means "all accounts" (no filter). The
    // accountIds parameter is always passed to Dapper even when unused by the SQL text (e.g. when
    // the filter clause is omitted) — Dapper ignores parameters the query text doesn't reference.
    private static string AccountFilterClause(IReadOnlyList<Guid>? accountIds) =>
        accountIds is { Count: > 0 } ? "AND t.BankAccountId IN @accountIds" : "";

    // Enable Banking gives no link between the two legs of a transfer between the user's own
    // accounts — each account's feed is independent. Heuristically matched here the way budgeting
    // apps generally do it: another transaction, same user, a *different* account, the exact
    // opposite amount, within a few days (banks don't always settle both legs same-day).
    //
    // Only excluded when the OTHER leg is also within the accounts currently being viewed — a
    // transfer only nets to zero (and should disappear from income/expense) when both sides are in
    // view. Filtered down to just the receiving account (e.g. "Savings" alone, transfer-in from an
    // unselected "Salary"), the money did enter the accounts you're looking at, so it stays real
    // income from that view's perspective — matching the current filter (or all accounts, when
    // there isn't one) constrains where the matching leg is allowed to live.
    private static string TransferExclusionClause(IReadOnlyList<Guid>? accountIds)
    {
        var counterpartFilter = accountIds is { Count: > 0 } ? "AND t2.BankAccountId IN @accountIds" : "";
        return $"""
            AND NOT EXISTS (
                SELECT 1 FROM Transactions t2
                WHERE t2.UserId = t.UserId AND t2.BankAccountId <> t.BankAccountId
                  AND t2.Amount = -t.Amount AND ABS(DATEDIFF(DAY, t2.BookingDate, t.BookingDate)) <= 3
                  {counterpartFilter}
            )
            """;
    }

    public async Task<(IReadOnlyList<TransactionListItem> Items, int TotalCount)> GetPageAsync(
        Guid userId, int page, int pageSize, IReadOnlyList<Guid>? accountIds, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        var filter = AccountFilterClause(accountIds);

        var total = await conn.ExecuteScalarAsync<int>(
            $"SELECT COUNT(*) FROM Transactions t WHERE t.UserId = @userId {filter}",
            new { userId, accountIds });

        var items = await conn.QueryAsync<TransactionListItem>(
            $"""
            SELECT t.Id, t.BankAccountId, t.BookingDate, t.Amount, t.Currency, t.Description,
                   t.CategoryId, c.Name AS CategoryName, c.Emoji AS CategoryEmoji, t.IsCategoryManual
            FROM Transactions t
            LEFT JOIN Categories c ON c.Id = t.CategoryId
            WHERE t.UserId = @userId {filter}
            ORDER BY t.BookingDate DESC, t.CreatedAt DESC, t.Id DESC
            OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
            """,
            new { userId, accountIds, offset = (page - 1) * pageSize, pageSize });

        return (items.AsList(), total);
    }

    public async Task<IReadOnlyList<MonthlyFlowRow>> GetMonthlyFlowAsync(
        Guid userId, IReadOnlyList<Guid>? accountIds, DateOnly from, DateOnly to, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        var filter = AccountFilterClause(accountIds);
        var rows = await conn.QueryAsync<MonthlyFlowRow>(
            $"""
            SELECT YEAR(t.BookingDate) AS Year, MONTH(t.BookingDate) AS Month,
                   SUM(CASE WHEN t.Amount > 0 THEN t.Amount ELSE 0 END) AS Income,
                   SUM(CASE WHEN t.Amount < 0 THEN -t.Amount ELSE 0 END) AS Expense
            FROM Transactions t
            WHERE t.UserId = @userId AND t.BookingDate >= @from AND t.BookingDate < @to {filter} {TransferExclusionClause(accountIds)}
            GROUP BY YEAR(t.BookingDate), MONTH(t.BookingDate)
            ORDER BY Year, Month
            """,
            new { userId, accountIds, from, to });
        return rows.AsList();
    }

    public async Task<IReadOnlyList<MonthlySummaryRow>> GetCategoryBreakdownAsync(
        Guid userId, IReadOnlyList<Guid>? accountIds, DateOnly from, DateOnly to, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        var filter = AccountFilterClause(accountIds);
        var rows = await conn.QueryAsync<MonthlySummaryRow>(
            $"""
            SELECT t.CategoryId, c.Name AS CategoryName, c.Emoji AS CategoryEmoji, -SUM(t.Amount) AS Total
            FROM Transactions t
            LEFT JOIN Categories c ON c.Id = t.CategoryId
            WHERE t.UserId = @userId AND t.BookingDate >= @from AND t.BookingDate < @to AND t.Amount < 0 {filter} {TransferExclusionClause(accountIds)}
            GROUP BY t.CategoryId, c.Name, c.Emoji
            ORDER BY Total DESC
            """,
            new { userId, accountIds, from, to });
        return rows.AsList();
    }

    public async Task<decimal> GetNetBalanceAsync(Guid userId, IReadOnlyList<Guid>? accountIds, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        var filter = AccountFilterClause(accountIds);
        return await conn.ExecuteScalarAsync<decimal>(
            $"SELECT ISNULL(SUM(t.Amount), 0) FROM Transactions t WHERE t.UserId = @userId {filter}",
            new { userId, accountIds });
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

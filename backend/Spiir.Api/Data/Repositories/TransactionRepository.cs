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

public class TransactionRepository(IDbConnectionFactory connectionFactory)
{
    public async Task<(IReadOnlyList<TransactionListItem> Items, int TotalCount)> GetPageAsync(
        Guid userId, int page, int pageSize, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);

        var total = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM Transactions WHERE UserId = @userId",
            new { userId });

        var items = await conn.QueryAsync<TransactionListItem>(
            """
            SELECT t.Id, t.BankAccountId, t.BookingDate, t.Amount, t.Currency, t.Description,
                   t.CategoryId, c.Name AS CategoryName, c.Emoji AS CategoryEmoji, t.IsCategoryManual
            FROM Transactions t
            LEFT JOIN Categories c ON c.Id = t.CategoryId
            WHERE t.UserId = @userId
            ORDER BY t.BookingDate DESC, t.CreatedAt DESC
            OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
            """,
            new { userId, offset = (page - 1) * pageSize, pageSize });

        return (items.AsList(), total);
    }

    public async Task<IReadOnlyList<MonthlySummaryRow>> GetMonthlySummaryAsync(
        Guid userId, DateOnly from, DateOnly to, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        var rows = await conn.QueryAsync<MonthlySummaryRow>(
            """
            SELECT t.CategoryId, c.Name AS CategoryName, c.Emoji AS CategoryEmoji, -SUM(t.Amount) AS Total
            FROM Transactions t
            LEFT JOIN Categories c ON c.Id = t.CategoryId
            WHERE t.UserId = @userId AND t.BookingDate >= @from AND t.BookingDate < @to AND t.Amount < 0
            GROUP BY t.CategoryId, c.Name, c.Emoji
            ORDER BY Total DESC
            """,
            new { userId, from, to });
        return rows.AsList();
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

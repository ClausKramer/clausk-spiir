using Dapper;

namespace Spiir.Api.Data.Repositories;

public record BudgetRow(Guid CategoryId, decimal LimitAmount);

public class BudgetRepository(IDbConnectionFactory connectionFactory)
{
    public async Task<IReadOnlyList<BudgetRow>> GetBudgetsAsync(Guid userId, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        return (await conn.QueryAsync<BudgetRow>(
            "SELECT CategoryId, LimitAmount FROM Budgets WHERE UserId = @userId",
            new { userId })).AsList();
    }

    /// <summary>Sets a category's monthly limit, replacing any existing one rather than doubling it.</summary>
    public async Task UpsertBudgetAsync(
        Guid userId, Guid categoryId, decimal limitAmount, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        var now = DateTime.UtcNow;
        await conn.ExecuteAsync(
            """
            UPDATE Budgets SET LimitAmount = @limitAmount, UpdatedAt = @now
            WHERE UserId = @userId AND CategoryId = @categoryId;

            IF @@ROWCOUNT = 0
            INSERT INTO Budgets (Id, UserId, CategoryId, LimitAmount, CreatedAt, UpdatedAt)
            VALUES (NEWID(), @userId, @categoryId, @limitAmount, @now, @now);
            """,
            new { userId, categoryId, limitAmount, now });
    }

    public async Task<bool> DeleteBudgetAsync(Guid userId, Guid categoryId, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        var rows = await conn.ExecuteAsync(
            "DELETE FROM Budgets WHERE UserId = @userId AND CategoryId = @categoryId",
            new { userId, categoryId });
        return rows > 0;
    }
}

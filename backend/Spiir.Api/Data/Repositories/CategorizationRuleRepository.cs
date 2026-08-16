using Dapper;
using Spiir.Api.Domain.Entities;

namespace Spiir.Api.Data.Repositories;

public class CategorizationRuleRepository(IDbConnectionFactory connectionFactory)
{
    public async Task<IReadOnlyList<CategorizationRule>> GetAllForUserOrderedAsync(Guid userId, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        var rows = await conn.QueryAsync<CategorizationRule>(
            """
            SELECT Id, UserId, Pattern, IsRegex, CategoryId, Priority, CreatedAt
            FROM CategorizationRules
            WHERE UserId = @userId
            ORDER BY Priority DESC, Id
            """,
            new { userId });
        return rows.AsList();
    }

    public async Task InsertManyAsync(IEnumerable<CategorizationRule> rules, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(
            """
            INSERT INTO CategorizationRules (Id, UserId, Pattern, IsRegex, CategoryId, Priority, CreatedAt)
            VALUES (@Id, @UserId, @Pattern, @IsRegex, @CategoryId, @Priority, @CreatedAt)
            """,
            rules);
    }
}

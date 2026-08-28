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

    // Learned rules (created when the user manually recategorizes) are upserted on their exact
    // pattern so correcting the same merchant twice repoints the existing rule instead of piling
    // up conflicting ones. Priority is used to rank learned rules above the seeded defaults.
    public async Task UpsertLearnedRuleAsync(
        Guid userId, string pattern, Guid categoryId, int priority, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(
            """
            UPDATE CategorizationRules
            SET CategoryId = @categoryId, Priority = @priority
            WHERE UserId = @userId AND Pattern = @pattern AND IsRegex = 0;

            IF @@ROWCOUNT = 0
                INSERT INTO CategorizationRules (Id, UserId, Pattern, IsRegex, CategoryId, Priority, CreatedAt)
                VALUES (NEWID(), @userId, @pattern, 0, @categoryId, @priority, @now);
            """,
            new { userId, pattern, categoryId, priority, now = DateTime.UtcNow });
    }

    // Learned rules only (priority above the seeded defaults) — an escape hatch for when a
    // correction taught something too broad. Seeded defaults are left untouched.
    public async Task<int> DeleteLearnedRulesAsync(Guid userId, int minPriority, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        return await conn.ExecuteAsync(
            "DELETE FROM CategorizationRules WHERE UserId = @userId AND Priority >= @minPriority",
            new { userId, minPriority });
    }

    public async Task<int> DeleteByIdsAsync(Guid userId, IReadOnlyList<Guid> ids, CancellationToken ct = default)
    {
        if (ids.Count == 0) return 0;

        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        return await conn.ExecuteAsync(
            "DELETE FROM CategorizationRules WHERE UserId = @userId AND Id IN @ids",
            new { userId, ids });
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

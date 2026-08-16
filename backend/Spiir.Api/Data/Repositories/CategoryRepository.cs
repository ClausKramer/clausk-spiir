using Dapper;
using Spiir.Api.Domain.Entities;

namespace Spiir.Api.Data.Repositories;

public class CategoryRepository(IDbConnectionFactory connectionFactory)
{
    public async Task<IReadOnlyList<Category>> GetAllForUserAsync(Guid userId, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        var rows = await conn.QueryAsync<Category>(
            "SELECT Id, UserId, Name, Emoji, CreatedAt FROM Categories WHERE UserId = @userId ORDER BY Name",
            new { userId });
        return rows.AsList();
    }

    public async Task<bool> ExistsAsync(Guid userId, Guid categoryId, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        return await conn.ExecuteScalarAsync<bool>(
            "SELECT CASE WHEN EXISTS (SELECT 1 FROM Categories WHERE UserId = @userId AND Id = @categoryId) THEN 1 ELSE 0 END",
            new { userId, categoryId });
    }

    public async Task InsertManyAsync(IEnumerable<Category> categories, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(
            "INSERT INTO Categories (Id, UserId, Name, Emoji, CreatedAt) VALUES (@Id, @UserId, @Name, @Emoji, @CreatedAt)",
            categories);
    }
}

using Dapper;
using Spiir.Api.Domain.Entities;

namespace Spiir.Api.Data.Repositories;

public class CategoryRepository(IDbConnectionFactory connectionFactory)
{
    public async Task<IReadOnlyList<Category>> GetAllForUserAsync(Guid userId, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        var rows = await conn.QueryAsync<Category>(
            """
            SELECT Id, UserId, Name, Emoji, ParentCategoryId, Kind, CreatedAt
            FROM Categories WHERE UserId = @userId ORDER BY Name
            """,
            new { userId });
        return rows.AsList();
    }

    public async Task RenameAsync(Guid userId, Guid categoryId, string name, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(
            "UPDATE Categories SET Name = @name WHERE UserId = @userId AND Id = @categoryId",
            new { userId, categoryId, name });
    }

    public async Task SetParentAndKindAsync(
        Guid userId, Guid categoryId, Guid? parentCategoryId, string kind, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(
            """
            UPDATE Categories SET ParentCategoryId = @parentCategoryId, Kind = @kind
            WHERE UserId = @userId AND Id = @categoryId
            """,
            new { userId, categoryId, parentCategoryId, kind });
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
            """
            INSERT INTO Categories (Id, UserId, Name, Emoji, ParentCategoryId, Kind, CreatedAt)
            VALUES (@Id, @UserId, @Name, @Emoji, @ParentCategoryId, @Kind, @CreatedAt)
            """,
            categories);
    }
}

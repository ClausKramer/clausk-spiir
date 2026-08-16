using Dapper;
using Spiir.Api.Domain.Entities;

namespace Spiir.Api.Data.Repositories;

public class UserRepository(IDbConnectionFactory connectionFactory)
{
    public async Task<User?> GetByIdAsync(Guid id, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        return await conn.QuerySingleOrDefaultAsync<User>(
            "SELECT Id, Email, CreatedAt FROM Users WHERE Id = @id",
            new { id });
    }

    public async Task<User?> GetByEmailAsync(string email, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        return await conn.QuerySingleOrDefaultAsync<User>(
            "SELECT Id, Email, CreatedAt FROM Users WHERE Email = @email",
            new { email });
    }

    public async Task InsertAsync(User user, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(
            "INSERT INTO Users (Id, Email, CreatedAt) VALUES (@Id, @Email, @CreatedAt)",
            user);
    }
}

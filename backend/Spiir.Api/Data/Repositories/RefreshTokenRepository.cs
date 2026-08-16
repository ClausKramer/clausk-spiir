using Dapper;
using Spiir.Api.Domain.Entities;

namespace Spiir.Api.Data.Repositories;

public class RefreshTokenRepository(IDbConnectionFactory connectionFactory)
{
    public async Task InsertAsync(RefreshToken token, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(
            """
            INSERT INTO RefreshTokens (Id, UserId, TokenHash, CreatedAt, ExpiresAt, RevokedAt)
            VALUES (@Id, @UserId, @TokenHash, @CreatedAt, @ExpiresAt, @RevokedAt)
            """,
            token);
    }

    // Not scoped by UserId — same rationale as MagicLinkTokenRepository.GetValidWithUserByHashAsync.
    public async Task<(RefreshToken Token, User User)?> GetValidWithUserByHashAsync(
        string tokenHash, DateTime now, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        var rows = await conn.QueryAsync<RefreshToken, User, (RefreshToken, User)>(
            """
            SELECT t.Id, t.UserId, t.TokenHash, t.CreatedAt, t.ExpiresAt, t.RevokedAt,
                   u.Id, u.Email, u.CreatedAt
            FROM RefreshTokens t
            JOIN Users u ON u.Id = t.UserId
            WHERE t.TokenHash = @tokenHash AND t.RevokedAt IS NULL AND t.ExpiresAt > @now
            """,
            (t, u) => (t, u),
            new { tokenHash, now },
            splitOn: "Id");

        return rows.FirstOrDefault();
    }

    public async Task RevokeAsync(Guid id, DateTime revokedAt, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(
            "UPDATE RefreshTokens SET RevokedAt = @revokedAt WHERE Id = @id",
            new { id, revokedAt });
    }

    public async Task RevokeByHashAsync(string tokenHash, DateTime revokedAt, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(
            "UPDATE RefreshTokens SET RevokedAt = @revokedAt WHERE TokenHash = @tokenHash AND RevokedAt IS NULL",
            new { tokenHash, revokedAt });
    }
}

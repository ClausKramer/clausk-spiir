using Dapper;
using Spiir.Api.Domain.Entities;

namespace Spiir.Api.Data.Repositories;

public class MagicLinkTokenRepository(IDbConnectionFactory connectionFactory)
{
    // Immediately expires any still-active (unconsumed, unexpired) tokens for a user —
    // called before issuing a fresh magic link so only the newest one is redeemable.
    public async Task ExpireActiveTokensAsync(Guid userId, DateTime now, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(
            """
            UPDATE MagicLinkTokens SET ExpiresAt = @now
            WHERE UserId = @userId AND ConsumedAt IS NULL AND ExpiresAt > @now
            """,
            new { userId, now });
    }

    public async Task InsertAsync(MagicLinkToken token, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(
            """
            INSERT INTO MagicLinkTokens (Id, UserId, TokenHash, CreatedAt, ExpiresAt, ConsumedAt)
            VALUES (@Id, @UserId, @TokenHash, @CreatedAt, @ExpiresAt, @ConsumedAt)
            """,
            token);
    }

    // Not scoped by UserId — the raw token hash is the only thing the caller has at this point
    // (this mirrors the pre-Dapper behavior, which explicitly bypassed the per-user filter here too).
    public async Task<(MagicLinkToken Token, User User)?> GetValidWithUserByHashAsync(
        string tokenHash, DateTime now, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        var rows = await conn.QueryAsync<MagicLinkToken, User, (MagicLinkToken, User)>(
            """
            SELECT t.Id, t.UserId, t.TokenHash, t.CreatedAt, t.ExpiresAt, t.ConsumedAt,
                   u.Id, u.Email, u.CreatedAt
            FROM MagicLinkTokens t
            JOIN Users u ON u.Id = t.UserId
            WHERE t.TokenHash = @tokenHash AND t.ConsumedAt IS NULL AND t.ExpiresAt > @now
            """,
            (t, u) => (t, u),
            new { tokenHash, now },
            splitOn: "Id");

        // See RefreshTokenRepository: FirstOrDefault on non-nullable tuples never yields null.
        var list = rows.AsList();
        return list.Count == 0 ? null : list[0];
    }

    public async Task MarkConsumedAsync(Guid id, DateTime consumedAt, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(
            "UPDATE MagicLinkTokens SET ConsumedAt = @consumedAt WHERE Id = @id",
            new { id, consumedAt });
    }
}

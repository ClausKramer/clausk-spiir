using Dapper;

namespace Spiir.Api.Data.Repositories;

public class RecurringDismissalRepository(IDbConnectionFactory connectionFactory)
{
    public async Task<HashSet<string>> GetDismissedKeysAsync(Guid userId, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        var keys = await conn.QueryAsync<string>(
            "SELECT MerchantKey FROM DismissedRecurringSeries WHERE UserId = @userId",
            new { userId });
        return new HashSet<string>(keys, StringComparer.OrdinalIgnoreCase);
    }

    public record DismissedRow(string MerchantKey, DateTime DismissedAt);

    public async Task<IReadOnlyList<DismissedRow>> GetDismissedAsync(Guid userId, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        return (await conn.QueryAsync<DismissedRow>(
            "SELECT MerchantKey, DismissedAt FROM DismissedRecurringSeries WHERE UserId = @userId ORDER BY DismissedAt DESC",
            new { userId })).AsList();
    }

    public async Task DismissAsync(Guid userId, string merchantKey, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(
            """
            UPDATE DismissedRecurringSeries SET DismissedAt = @now
            WHERE UserId = @userId AND MerchantKey = @merchantKey;

            IF @@ROWCOUNT = 0
            INSERT INTO DismissedRecurringSeries (UserId, MerchantKey, DismissedAt)
            VALUES (@userId, @merchantKey, @now);
            """,
            new { userId, merchantKey, now = DateTime.UtcNow });
    }

    public async Task UndismissAsync(Guid userId, string merchantKey, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(
            "DELETE FROM DismissedRecurringSeries WHERE UserId = @userId AND MerchantKey = @merchantKey",
            new { userId, merchantKey });
    }
}

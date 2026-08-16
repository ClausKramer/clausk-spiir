using Dapper;
using Spiir.Api.Domain.Entities;

namespace Spiir.Api.Data.Repositories;

public class BankAccountRepository(IDbConnectionFactory connectionFactory)
{
    public async Task<IReadOnlyList<BankAccount>> GetAllForUserAsync(Guid userId, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        var rows = await conn.QueryAsync<BankAccount>(
            """
            SELECT Id, UserId, GoCardlessAccountId, Iban, Name, Currency, LastSyncedAt, CreatedAt
            FROM BankAccounts
            WHERE UserId = @userId
            """,
            new { userId });
        return rows.AsList();
    }

    public async Task<bool> ExistsByGoCardlessIdAsync(Guid userId, string goCardlessAccountId, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        return await conn.ExecuteScalarAsync<bool>(
            """
            SELECT CASE WHEN EXISTS (
                SELECT 1 FROM BankAccounts WHERE UserId = @userId AND GoCardlessAccountId = @goCardlessAccountId
            ) THEN 1 ELSE 0 END
            """,
            new { userId, goCardlessAccountId });
    }

    public async Task InsertAsync(BankAccount account, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(
            """
            INSERT INTO BankAccounts (Id, UserId, GoCardlessAccountId, Iban, Name, Currency, LastSyncedAt, CreatedAt)
            VALUES (@Id, @UserId, @GoCardlessAccountId, @Iban, @Name, @Currency, @LastSyncedAt, @CreatedAt)
            """,
            account);
    }

    public async Task<bool> DeleteAsync(Guid userId, Guid id, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        var rowsAffected = await conn.ExecuteAsync(
            "DELETE FROM BankAccounts WHERE UserId = @userId AND Id = @id",
            new { userId, id });
        return rowsAffected > 0;
    }

    public async Task UpdateLastSyncedAtAsync(Guid userId, Guid id, DateTime syncedAt, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(
            "UPDATE BankAccounts SET LastSyncedAt = @syncedAt WHERE UserId = @userId AND Id = @id",
            new { userId, id, syncedAt });
    }
}

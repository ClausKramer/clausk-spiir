using Dapper;
using Spiir.Api.Domain.Entities;

namespace Spiir.Api.Data.Repositories;

public class BankAccountRepository(IDbConnectionFactory connectionFactory)
{
    // Listed once rather than per query so a column added to the entity can't be left out of one
    // of the two reads — which is how an account would come back with its balance silently null.
    private const string Columns = """
        Id, UserId, ExternalAccountId, Iban, Name, Currency, LastSyncedAt, CreatedAt,
        Balance, BalanceCurrency, BalanceType, BalanceReferenceDate, BalanceFetchedAt
        """;

    public async Task<IReadOnlyList<BankAccount>> GetAllForUserAsync(Guid userId, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        var rows = await conn.QueryAsync<BankAccount>(
            $"""
            SELECT {Columns}
            FROM BankAccounts
            WHERE UserId = @userId
            """,
            new { userId });
        return rows.AsList();
    }

    public async Task<BankAccount?> GetByIdAsync(Guid userId, Guid id, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        return await conn.QuerySingleOrDefaultAsync<BankAccount>(
            $"""
            SELECT {Columns}
            FROM BankAccounts
            WHERE UserId = @userId AND Id = @id
            """,
            new { userId, id });
    }

    public async Task<bool> ExistsByExternalIdAsync(Guid userId, string externalAccountId, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        return await conn.ExecuteScalarAsync<bool>(
            """
            SELECT CASE WHEN EXISTS (
                SELECT 1 FROM BankAccounts WHERE UserId = @userId AND ExternalAccountId = @externalAccountId
            ) THEN 1 ELSE 0 END
            """,
            new { userId, externalAccountId });
    }

    public async Task InsertAsync(BankAccount account, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(
            """
            INSERT INTO BankAccounts (Id, UserId, ExternalAccountId, Iban, Name, Currency, LastSyncedAt, CreatedAt)
            VALUES (@Id, @UserId, @ExternalAccountId, @Iban, @Name, @Currency, @LastSyncedAt, @CreatedAt)
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

    /// <summary>
    /// Records the balance the bank reported, with both the date it describes and the moment it
    /// was read. Scoped by userId like every other tenant-touching method here — there is no
    /// global filter catching a missed one.
    /// </summary>
    public async Task UpdateBalanceAsync(
        Guid userId,
        Guid id,
        decimal amount,
        string currency,
        string? balanceType,
        DateOnly? referenceDate,
        DateTime fetchedAt,
        CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(
            """
            UPDATE BankAccounts
            SET Balance = @amount,
                BalanceCurrency = @currency,
                BalanceType = @balanceType,
                BalanceReferenceDate = @referenceDate,
                BalanceFetchedAt = @fetchedAt
            WHERE UserId = @userId AND Id = @id
            """,
            new { userId, id, amount, currency, balanceType, referenceDate, fetchedAt });
    }

    public async Task<bool> RenameAsync(Guid userId, Guid id, string name, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        var rowsAffected = await conn.ExecuteAsync(
            "UPDATE BankAccounts SET Name = @name WHERE UserId = @userId AND Id = @id",
            new { userId, id, name });
        return rowsAffected > 0;
    }
}

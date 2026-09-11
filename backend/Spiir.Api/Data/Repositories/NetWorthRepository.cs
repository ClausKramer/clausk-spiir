using Dapper;
using Spiir.Api.Domain.Entities;

namespace Spiir.Api.Data.Repositories;

/// <summary>One month's recorded value, joined to the account it belongs to.</summary>
public record NetWorthPoint(
    Guid NetWorthAccountId,
    string AccountName,
    string Kind,
    bool IsLiability,
    int PeriodYear,
    int PeriodMonth,
    decimal Value);

public class NetWorthRepository(IDbConnectionFactory connectionFactory)
{
    // Every method takes userId and bakes WHERE UserId = @userId into the SQL: there is no
    // global filter in this app, so an omission here is a cross-tenant leak with nothing to
    // catch it.

    public async Task<IReadOnlyList<NetWorthAccount>> GetAccountsAsync(
        Guid userId, bool includeArchived = false, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        var archivedFilter = includeArchived ? "" : "AND IsArchived = 0";
        return (await conn.QueryAsync<NetWorthAccount>(
            $"""
            SELECT Id, UserId, Name, Kind, IsLiability, Currency, BankAccountId, IsArchived, SortOrder, CreatedAt
            FROM NetWorthAccounts
            WHERE UserId = @userId {archivedFilter}
            ORDER BY IsLiability, SortOrder, Name
            """,
            new { userId })).AsList();
    }

    public async Task<NetWorthAccount?> GetAccountAsync(Guid userId, Guid id, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        return await conn.QuerySingleOrDefaultAsync<NetWorthAccount>(
            """
            SELECT Id, UserId, Name, Kind, IsLiability, Currency, BankAccountId, IsArchived, SortOrder, CreatedAt
            FROM NetWorthAccounts WHERE UserId = @userId AND Id = @id
            """,
            new { userId, id });
    }

    public async Task InsertAccountAsync(NetWorthAccount account, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(
            """
            INSERT INTO NetWorthAccounts
                (Id, UserId, Name, Kind, IsLiability, Currency, BankAccountId, IsArchived, SortOrder, CreatedAt)
            VALUES
                (@Id, @UserId, @Name, @Kind, @IsLiability, @Currency, @BankAccountId, @IsArchived, @SortOrder, @CreatedAt)
            """,
            account);
    }

    public async Task<bool> UpdateAccountAsync(
        Guid userId, Guid id, string name, string kind, bool isLiability,
        Guid? bankAccountId, bool isArchived, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        var rows = await conn.ExecuteAsync(
            """
            UPDATE NetWorthAccounts
            SET Name = @name, Kind = @kind, IsLiability = @isLiability,
                BankAccountId = @bankAccountId, IsArchived = @isArchived
            WHERE UserId = @userId AND Id = @id
            """,
            new { userId, id, name, kind, isLiability, bankAccountId, isArchived });
        return rows > 0;
    }

    /// <summary>
    /// Removes an account and everything recorded for it. Archiving is the normal path — this
    /// rewrites history, which is why the endpoint asks before calling it.
    /// </summary>
    public async Task<bool> DeleteAccountAsync(Guid userId, Guid id, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        // Snapshots first: the FK is NO ACTION (two cascade paths from Users), so the rows have
        // to go explicitly rather than being swept up by the delete.
        await conn.ExecuteAsync(
            "DELETE FROM NetWorthSnapshots WHERE UserId = @userId AND NetWorthAccountId = @id",
            new { userId, id });
        var rows = await conn.ExecuteAsync(
            "DELETE FROM NetWorthAccounts WHERE UserId = @userId AND Id = @id", new { userId, id });
        return rows > 0;
    }

    /// <summary>
    /// Records one account's value for one month, replacing any figure already there. Correcting
    /// a month must overwrite rather than append, or the month would count twice.
    /// </summary>
    public async Task UpsertSnapshotAsync(
        Guid userId, Guid accountId, int year, int month, decimal value, string? note,
        CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(
            """
            UPDATE NetWorthSnapshots
            SET Value = @value, Note = @note, RecordedAt = @now
            WHERE UserId = @userId AND NetWorthAccountId = @accountId
              AND PeriodYear = @year AND PeriodMonth = @month;

            IF @@ROWCOUNT = 0
            INSERT INTO NetWorthSnapshots
                (Id, UserId, NetWorthAccountId, PeriodYear, PeriodMonth, Value, Note, RecordedAt)
            VALUES
                (NEWID(), @userId, @accountId, @year, @month, @value, @note, @now);
            """,
            new { userId, accountId, year, month, value, note, now = DateTime.UtcNow });
    }

    public async Task<bool> DeleteSnapshotAsync(
        Guid userId, Guid accountId, int year, int month, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        var rows = await conn.ExecuteAsync(
            """
            DELETE FROM NetWorthSnapshots
            WHERE UserId = @userId AND NetWorthAccountId = @accountId
              AND PeriodYear = @year AND PeriodMonth = @month
            """,
            new { userId, accountId, year, month });
        return rows > 0;
    }

    /// <summary>
    /// Every recorded point, optionally limited to one year. Archived accounts are included:
    /// dropping them would rewrite the months in which they were still real.
    /// </summary>
    public async Task<IReadOnlyList<NetWorthPoint>> GetPointsAsync(
        Guid userId, int? year = null, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        var yearFilter = year.HasValue ? "AND s.PeriodYear = @year" : "";
        return (await conn.QueryAsync<NetWorthPoint>(
            $"""
            SELECT s.NetWorthAccountId, a.Name AS AccountName, a.Kind, a.IsLiability,
                   s.PeriodYear, s.PeriodMonth, s.Value
            FROM NetWorthSnapshots s
            JOIN NetWorthAccounts a ON a.Id = s.NetWorthAccountId AND a.UserId = s.UserId
            WHERE s.UserId = @userId {yearFilter}
            ORDER BY s.PeriodYear, s.PeriodMonth, a.IsLiability, a.Name
            """,
            new { userId, year })).AsList();
    }

    /// <summary>Years that hold at least one recorded value, for the period picker.</summary>
    public async Task<IReadOnlyList<int>> GetRecordedYearsAsync(Guid userId, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        return (await conn.QueryAsync<int>(
            "SELECT DISTINCT PeriodYear FROM NetWorthSnapshots WHERE UserId = @userId ORDER BY PeriodYear DESC",
            new { userId })).AsList();
    }

    /// <summary>
    /// The most recent value recorded for each account, whenever that was. Used to prefill the
    /// entry form: last month's figure is a far better starting point than an empty box, and for
    /// something like a property it is usually still the right answer.
    /// </summary>
    public async Task<IReadOnlyDictionary<Guid, decimal>> GetLatestValuesAsync(
        Guid userId, int beforeYear, int beforeMonth, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        var rows = await conn.QueryAsync<(Guid AccountId, decimal Value)>(
            """
            SELECT s.NetWorthAccountId, s.Value
            FROM NetWorthSnapshots s
            JOIN (
                SELECT NetWorthAccountId, MAX(PeriodYear * 100 + PeriodMonth) AS Period
                FROM NetWorthSnapshots
                WHERE UserId = @userId AND (PeriodYear * 100 + PeriodMonth) < @before
                GROUP BY NetWorthAccountId
            ) latest
              ON latest.NetWorthAccountId = s.NetWorthAccountId
             AND latest.Period = s.PeriodYear * 100 + s.PeriodMonth
            WHERE s.UserId = @userId
            """,
            new { userId, before = beforeYear * 100 + beforeMonth });
        return rows.ToDictionary(r => r.AccountId, r => r.Value);
    }

    /// <summary>Which accounts already have a figure for a given month.</summary>
    public async Task<IReadOnlyList<Guid>> GetRecordedAccountIdsAsync(
        Guid userId, int year, int month, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        return (await conn.QueryAsync<Guid>(
            """
            SELECT NetWorthAccountId FROM NetWorthSnapshots
            WHERE UserId = @userId AND PeriodYear = @year AND PeriodMonth = @month
            """,
            new { userId, year, month })).AsList();
    }

    /// <summary>Clears the link when the underlying bank account is disconnected.</summary>
    public async Task ClearBankAccountLinkAsync(Guid userId, Guid bankAccountId, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(
            "UPDATE NetWorthAccounts SET BankAccountId = NULL WHERE UserId = @userId AND BankAccountId = @bankAccountId",
            new { userId, bankAccountId });
    }
}

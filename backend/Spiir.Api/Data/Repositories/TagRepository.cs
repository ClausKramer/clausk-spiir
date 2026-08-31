using Dapper;
using Spiir.Api.Domain.Entities;

namespace Spiir.Api.Data.Repositories;

public record TagWithUsage(Guid Id, string Name, int TransactionCount, decimal Total);
public record TransactionTagLink(Guid TransactionId, Guid TagId, string Name);

public class TagRepository(IDbConnectionFactory connectionFactory)
{
    public async Task<IReadOnlyList<TagWithUsage>> GetAllForUserAsync(Guid userId, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        // Totals exclude the rows every other figure excludes, so a tag's total means the same
        // thing as the numbers next to it on the dashboard.
        var rows = await conn.QueryAsync<TagWithUsage>(
            """
            SELECT tg.Id, tg.Name,
                   COUNT(t.Id) AS TransactionCount,
                   ISNULL(SUM(CASE WHEN t.Amount < 0 THEN -t.Amount ELSE 0 END), 0) AS Total
            FROM Tags tg
            LEFT JOIN TransactionTags tt ON tt.TagId = tg.Id
            LEFT JOIN Transactions t ON t.Id = tt.TransactionId AND t.IsDuplicate = 0
            WHERE tg.UserId = @userId
            GROUP BY tg.Id, tg.Name
            ORDER BY Total DESC, tg.Name
            """,
            new { userId });
        return rows.AsList();
    }

    /// <summary>
    /// Returns the tag with this name, creating it if it's new. Case-insensitive, so typing
    /// "padel" when "Padel" exists reuses it rather than splitting the total across two tags.
    /// </summary>
    public async Task<Tag> GetOrCreateAsync(Guid userId, string name, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);

        var existing = await conn.QuerySingleOrDefaultAsync<Tag>(
            "SELECT Id, UserId, Name, CreatedAt FROM Tags WHERE UserId = @userId AND Name = @name",
            new { userId, name });
        if (existing is not null) return existing;

        var tag = new Tag { Id = Guid.NewGuid(), UserId = userId, Name = name, CreatedAt = DateTime.UtcNow };
        await conn.ExecuteAsync(
            "INSERT INTO Tags (Id, UserId, Name, CreatedAt) VALUES (@Id, @UserId, @Name, @CreatedAt)",
            tag);
        return tag;
    }

    // Idempotent: tagging something already tagged is a no-op rather than a primary key violation.
    public async Task AddToTransactionAsync(Guid userId, Guid transactionId, Guid tagId, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(
            """
            IF EXISTS (SELECT 1 FROM Transactions WHERE Id = @transactionId AND UserId = @userId)
               AND EXISTS (SELECT 1 FROM Tags WHERE Id = @tagId AND UserId = @userId)
               AND NOT EXISTS (SELECT 1 FROM TransactionTags WHERE TransactionId = @transactionId AND TagId = @tagId)
                INSERT INTO TransactionTags (TransactionId, TagId) VALUES (@transactionId, @tagId);
            """,
            new { userId, transactionId, tagId });
    }

    public async Task<int> RemoveFromTransactionAsync(Guid userId, Guid transactionId, Guid tagId, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        return await conn.ExecuteAsync(
            """
            DELETE tt FROM TransactionTags tt
            JOIN Transactions t ON t.Id = tt.TransactionId
            WHERE t.UserId = @userId AND tt.TransactionId = @transactionId AND tt.TagId = @tagId
            """,
            new { userId, transactionId, tagId });
    }

    // Links are removed explicitly because TransactionTags -> Tags is NO ACTION: cascading it
    // would give SQL Server two cascade paths into that table (see Schema/0006).
    public async Task<bool> DeleteAsync(Guid userId, Guid tagId, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(
            "DELETE FROM TransactionTags WHERE TagId IN (SELECT Id FROM Tags WHERE Id = @tagId AND UserId = @userId)",
            new { userId, tagId });
        var rows = await conn.ExecuteAsync(
            "DELETE FROM Tags WHERE Id = @tagId AND UserId = @userId",
            new { userId, tagId });
        return rows > 0;
    }

    /// <summary>Tags for a set of transactions, for attaching to rows without an N+1 per row.</summary>
    public async Task<ILookup<Guid, TransactionTagLink>> GetForTransactionsAsync(
        Guid userId, IReadOnlyList<Guid> transactionIds, CancellationToken ct = default)
    {
        if (transactionIds.Count == 0)
            return Array.Empty<TransactionTagLink>().ToLookup(x => x.TransactionId);

        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        var rows = await conn.QueryAsync<TransactionTagLink>(
            """
            SELECT tt.TransactionId, tg.Id AS TagId, tg.Name
            FROM TransactionTags tt
            JOIN Tags tg ON tg.Id = tt.TagId
            WHERE tg.UserId = @userId AND tt.TransactionId IN @transactionIds
            ORDER BY tg.Name
            """,
            new { userId, transactionIds });
        return rows.ToLookup(r => r.TransactionId);
    }
}

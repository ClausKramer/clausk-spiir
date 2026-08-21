using Dapper;
using Spiir.Api.Domain.Entities;

namespace Spiir.Api.Data.Repositories;

public class RequisitionRepository(IDbConnectionFactory connectionFactory)
{
    public async Task InsertAsync(Requisition requisition, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(
            """
            INSERT INTO Requisitions
                (Id, UserId, Reference, AspspName, AspspCountry, Status, CreatedAt, UpdatedAt)
            VALUES
                (@Id, @UserId, @Reference, @AspspName, @AspspCountry, @Status, @CreatedAt, @UpdatedAt)
            """,
            requisition);
    }

    public async Task<Requisition?> GetPendingByReferenceAsync(Guid userId, string reference, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        return await conn.QuerySingleOrDefaultAsync<Requisition>(
            """
            SELECT Id, UserId, Reference, AspspName, AspspCountry, Status, CreatedAt, UpdatedAt
            FROM Requisitions
            WHERE UserId = @userId AND Reference = @reference AND Status = @pending
            """,
            new { userId, reference, pending = (int)RequisitionStatus.Pending });
    }

    public async Task UpdateStatusAsync(Guid id, RequisitionStatus status, DateTime updatedAt, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(
            "UPDATE Requisitions SET Status = @status, UpdatedAt = @updatedAt WHERE Id = @id",
            new { id, status = (int)status, updatedAt });
    }
}

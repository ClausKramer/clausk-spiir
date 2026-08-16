using System.Data;

namespace Spiir.Api.Data;

public interface IDbConnectionFactory
{
    Task<IDbConnection> CreateOpenConnectionAsync(CancellationToken ct = default);
}

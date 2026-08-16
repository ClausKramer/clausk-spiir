using System.Data;
using Microsoft.Data.SqlClient;

namespace Spiir.Api.Data;

public class SqlConnectionFactory(IConfiguration configuration) : IDbConnectionFactory
{
    public async Task<IDbConnection> CreateOpenConnectionAsync(CancellationToken ct = default)
    {
        var connectionString = configuration.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException("ConnectionStrings:DefaultConnection is not configured.");

        var connection = new SqlConnection(connectionString);
        await connection.OpenAsync(ct);
        return connection;
    }
}

using System.Data;
using Microsoft.Data.SqlClient;

namespace Spiir.Api.Data;

public class SqlConnectionFactory(IConfiguration configuration) : IDbConnectionFactory
{
    // The database is serverless and pauses when idle. The first login after a pause is refused
    // straight away ("Database ... is not currently available", error 40613) while Azure resumes
    // it, which takes anywhere from a few seconds to a minute — so a longer connect timeout alone
    // never helps, because the login isn't slow, it is rejected. Opening has to be retried.
    // Without this the first request after idle returned a 500, and at startup the migration threw
    // and crashed the container into a restart loop until the database happened to be awake.
    //
    // -2 is a client-side connect timeout, kept in the list because a resume that is merely slow
    // (rather than refused) surfaces that way. The rest are Azure SQL's documented transient
    // errors: 4060 and 40613 (database unavailable), 40197/40501 (service busy or reconfiguring),
    // 10928/10929 (resource limits), 49918-49920 (too many operations in progress).
    private static readonly SqlRetryLogicBaseProvider RetryProvider =
        SqlConfigurableRetryFactory.CreateExponentialRetryProvider(new SqlRetryLogicOption
        {
            NumberOfTries = 6,
            DeltaTime = TimeSpan.FromSeconds(2),
            MaxTimeInterval = TimeSpan.FromSeconds(15),
            TransientErrors = [-2, 4060, 10928, 10929, 40197, 40501, 40613, 49918, 49919, 49920],
        });

    public async Task<IDbConnection> CreateOpenConnectionAsync(CancellationToken ct = default)
    {
        var connectionString = configuration.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException("ConnectionStrings:DefaultConnection is not configured.");

        var connection = new SqlConnection(connectionString) { RetryLogicProvider = RetryProvider };
        await connection.OpenAsync(ct);
        return connection;
    }
}

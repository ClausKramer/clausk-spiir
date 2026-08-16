using System.Reflection;
using Dapper;

namespace Spiir.Api.Data;

public static class DatabaseMigrator
{
    // Runs versioned scripts from Schema/*.sql (embedded resources) against the configured
    // SQL Server database. Replaces EF Core's Migrations/ — see docs/architecture.md.
    //
    // Not DbUp: DbUp's own internal connection handling crashed the process (native SIGSEGV,
    // exit 139) when run against Azure SQL with Entra managed-identity auth in Azure Container
    // Apps' sandboxed environment — reproducible regardless of sync/async calling context.
    // Plain SqlConnection + Dapper via IDbConnectionFactory (the same path every repository
    // already uses successfully) does not exhibit this crash, so migrations run through that
    // instead, with a minimal SchemaVersions journal table standing in for DbUp's.
    public static async Task MigrateAsync(IDbConnectionFactory connectionFactory, CancellationToken ct = default)
    {
        using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);

        await conn.ExecuteAsync(
            """
            IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'SchemaVersions')
                CREATE TABLE SchemaVersions
                (
                    ScriptName NVARCHAR(255) NOT NULL PRIMARY KEY,
                    AppliedAt  DATETIME2     NOT NULL
                );
            """);

        var applied = (await conn.QueryAsync<string>("SELECT ScriptName FROM SchemaVersions")).ToHashSet();

        var assembly = typeof(DatabaseMigrator).Assembly;
        var scriptNames = assembly.GetManifestResourceNames()
            .Where(n => n.Contains(".Schema.") && n.EndsWith(".sql"))
            .OrderBy(n => n, StringComparer.Ordinal);

        foreach (var resourceName in scriptNames)
        {
            if (applied.Contains(resourceName)) continue;

            await using var stream = assembly.GetManifestResourceStream(resourceName)
                ?? throw new InvalidOperationException($"Embedded schema script not found: {resourceName}");
            using var reader = new StreamReader(stream);
            var sql = await reader.ReadToEndAsync(ct);

            await conn.ExecuteAsync(sql);
            await conn.ExecuteAsync(
                "INSERT INTO SchemaVersions (ScriptName, AppliedAt) VALUES (@resourceName, @now)",
                new { resourceName, now = DateTime.UtcNow });
        }
    }
}

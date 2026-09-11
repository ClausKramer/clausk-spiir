using System.Text.Json;
using Spiir.Api.Data.Repositories;
using Spiir.Api.Domain.Entities;

namespace Spiir.Api.Data;

/// <summary>
/// A one-off import of a net worth history that shipped with the build.
///
/// This exists for a single migration: moving years of hand-kept spreadsheet history into the
/// app when the export file can't reach the browser that owns the session. It is deliberately
/// temporary — once the data has landed, both this class and <c>Data/NetWorthSeed.json</c> come
/// out, and the intermediate image is deleted from the registry.
///
/// It writes exactly what <c>POST /networth/import</c> writes: accounts matched by name, values
/// upserted and stored signed. Running twice therefore lands the same data rather than doubling
/// it, which matters because it runs on every startup until it is removed.
/// </summary>
public class NetWorthSeedImporter(
    NetWorthRepository netWorth,
    UserRepository users,
    ILogger<NetWorthSeedImporter> logger)
{
    private const string SeedPath = "Data/NetWorthSeed.json";

    private record SeedAccount(string Name, string Kind);
    private record SeedSnapshot(string Account, int Year, int Month, decimal Value);
    private record Seed(SeedAccount[] Accounts, SeedSnapshot[] Snapshots);

    /// <summary>Imports the bundled history for one user, if both the file and the user exist.</summary>
    public async Task<bool> ImportAsync(string email, CancellationToken ct = default)
    {
        var path = Path.Combine(AppContext.BaseDirectory, SeedPath);
        if (!File.Exists(path)) return false;

        var user = await users.GetByEmailAsync(email, ct);
        if (user is null)
        {
            logger.LogWarning("Net worth seed present but no user {Email} to import it for.", email);
            return false;
        }

        var seed = JsonSerializer.Deserialize<Seed>(
            await File.ReadAllTextAsync(path, ct),
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        if (seed is null) return false;

        var existing = (await netWorth.GetAccountsAsync(user.Id, includeArchived: true, ct))
            .ToDictionary(a => a.Name, a => a, StringComparer.OrdinalIgnoreCase);

        // Already imported: the accounts are all there and so are their values. Returning early
        // keeps startup fast rather than rewriting the same two and a half thousand rows on
        // every restart until the next deploy removes this.
        var alreadyPresent = seed.Accounts.All(a => existing.ContainsKey(a.Name.Trim()));
        if (alreadyPresent && existing.Count > 0)
        {
            logger.LogInformation("Net worth seed already imported for {Email}; nothing to do.", email);
            return false;
        }

        var created = 0;
        foreach (var incoming in seed.Accounts)
        {
            var name = incoming.Name.Trim();
            if (name.Length == 0 || existing.ContainsKey(name)) continue;

            var account = new NetWorthAccount
            {
                Id = Guid.NewGuid(),
                UserId = user.Id,
                Name = name,
                Kind = incoming.Kind,
                // Derived from the kind, never taken from the payload.
                IsLiability = NetWorthKind.IsLiabilityKind(incoming.Kind),
                SortOrder = existing.Count + created,
                CreatedAt = DateTime.UtcNow,
            };
            await netWorth.InsertAccountAsync(account, ct);
            existing[name] = account;
            created++;
        }

        var values = seed.Snapshots
            .Where(s => s.Month is >= 1 and <= 12 && existing.ContainsKey(s.Account.Trim()))
            .Select(s => new NetWorthRepository.SnapshotValue(
                existing[s.Account.Trim()].Id, s.Year, s.Month, s.Value))
            .ToList();

        var written = await netWorth.UpsertSnapshotsAsync(user.Id, values, ct);

        logger.LogInformation(
            "Net worth seed imported for {Email}: {Created} account(s) created, {Written} value(s) written.",
            email, created, written);
        return true;
    }
}

using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Spiir.Api.Data;

namespace Spiir.Api.Features.Categorization;

public class RuleBasedCategorizationEngine(
    AppDbContext db,
    ClaudeCategorizationFallback claudeFallback) : ICategorizationEngine
{
    public async Task<Guid?> CategorizeAsync(string description, Guid userId, CancellationToken ct = default)
    {
        var rules = await db.CategorizationRules
            .OrderByDescending(r => r.Priority)
            .ThenBy(r => r.Id)
            .ToListAsync(ct);

        foreach (var rule in rules)
        {
            bool matched = rule.IsRegex
                ? Regex.IsMatch(description, rule.Pattern, RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)
                : description.Contains(rule.Pattern, StringComparison.OrdinalIgnoreCase);

            if (matched)
                return rule.CategoryId;
        }

        return await claudeFallback.CategorizeAsync(description, userId, ct);
    }
}

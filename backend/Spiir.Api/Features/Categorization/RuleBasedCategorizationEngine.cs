using System.Text.RegularExpressions;
using Spiir.Api.Data.Repositories;

namespace Spiir.Api.Features.Categorization;

public class RuleBasedCategorizationEngine(
    CategorizationRuleRepository rules,
    ClaudeCategorizationFallback claudeFallback) : ICategorizationEngine
{
    public async Task<Guid?> CategorizeAsync(string description, Guid userId, CancellationToken ct = default)
    {
        var userRules = await rules.GetAllForUserOrderedAsync(userId, ct);

        foreach (var rule in userRules)
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

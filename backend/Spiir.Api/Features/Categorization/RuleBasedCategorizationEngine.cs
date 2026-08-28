using System.Text.RegularExpressions;
using Spiir.Api.Data.Repositories;
using Spiir.Api.Domain.Entities;

namespace Spiir.Api.Features.Categorization;

public class RuleBasedCategorizationEngine(
    CategorizationRuleRepository rules,
    ClaudeCategorizationFallback claudeFallback) : ICategorizationEngine
{
    public async Task<Guid?> CategorizeAsync(string description, Guid userId, CancellationToken ct = default)
    {
        var userRules = await rules.GetAllForUserOrderedAsync(userId, ct);

        var matched = MatchRules(description, userRules);
        if (matched is not null) return matched;

        var fallback = await claudeFallback.CategorizeManyAsync([description], userId, ct);
        return fallback.TryGetValue(description, out var categoryId) ? categoryId : null;
    }

    public async Task<IReadOnlyDictionary<string, Guid>> CategorizeManyAsync(
        IReadOnlyList<string> descriptions, Guid userId, CancellationToken ct = default)
    {
        var result = new Dictionary<string, Guid>();
        if (descriptions.Count == 0) return result;

        var userRules = await rules.GetAllForUserOrderedAsync(userId, ct);

        // Distinct descriptions only — a month of groceries is often the same handful of merchants
        // repeated, and there's no reason to match (or ask Claude about) each occurrence.
        var distinct = descriptions.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        var unmatched = new List<string>();

        foreach (var description in distinct)
        {
            var matched = MatchRules(description, userRules);
            if (matched is not null) result[description] = matched.Value;
            else unmatched.Add(description);
        }

        if (unmatched.Count > 0)
        {
            var fallback = await claudeFallback.CategorizeManyAsync(unmatched, userId, ct);
            foreach (var (description, categoryId) in fallback)
                result[description] = categoryId;
        }

        return result;
    }

    // Rules are matched against both the raw description and its normalized merchant name: raw so
    // patterns keyed on bank-specific text still work, normalized so a rule learned from (or
    // seeded for) a plain merchant name still matches text buried in per-transaction noise like
    // "NETTO 1234 KØBENHAVN K DK 04.11".
    private static Guid? MatchRules(string description, IReadOnlyList<CategorizationRule> userRules)
    {
        var normalized = MerchantNormalizer.Normalize(description);

        foreach (var rule in userRules)
        {
            bool matched = rule.IsRegex
                ? Regex.IsMatch(description, rule.Pattern, RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)
                  || Regex.IsMatch(normalized, rule.Pattern, RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)
                : description.Contains(rule.Pattern, StringComparison.OrdinalIgnoreCase)
                  || normalized.Contains(rule.Pattern, StringComparison.OrdinalIgnoreCase);

            if (matched) return rule.CategoryId;
        }

        return null;
    }
}

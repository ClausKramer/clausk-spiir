namespace Spiir.Api.Features.Categorization;

public interface ICategorizationEngine
{
    /// <summary>
    /// Returns the best-matching CategoryId for the given transaction description,
    /// or null if no rule matches and the Claude fallback is not configured.
    /// </summary>
    Task<Guid?> CategorizeAsync(string description, Guid userId, CancellationToken ct = default);

    /// <summary>
    /// Categorizes many descriptions at once, returning a map of description → CategoryId for
    /// those that could be categorized. Prefer this when categorizing a batch (sync, CSV import):
    /// rule matching is done once per distinct merchant, and anything left over goes to the Claude
    /// fallback in a single request rather than one call per transaction.
    /// </summary>
    Task<IReadOnlyDictionary<string, Guid>> CategorizeManyAsync(
        IReadOnlyList<string> descriptions, Guid userId, CancellationToken ct = default);
}

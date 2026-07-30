namespace Spiir.Api.Features.Categorization;

public interface ICategorizationEngine
{
    /// <summary>
    /// Returns the best-matching CategoryId for the given transaction description,
    /// or null if no rule matches and the Claude fallback is not configured.
    /// </summary>
    Task<Guid?> CategorizeAsync(string description, Guid userId, CancellationToken ct = default);
}

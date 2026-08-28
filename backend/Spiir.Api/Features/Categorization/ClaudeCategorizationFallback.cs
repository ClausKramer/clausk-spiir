using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;
using Spiir.Api.Data.Repositories;
using Spiir.Api.Options;

namespace Spiir.Api.Features.Categorization;

public class ClaudeCategorizationFallback(
    IHttpClientFactory httpClientFactory,
    IOptions<AnthropicOptions> options,
    CategoryRepository categoryRepository,
    ILogger<ClaudeCategorizationFallback> logger)
{
    // Enough to keep a single request comfortably small and its response well within MaxTokens;
    // larger batches are split across calls rather than risking a truncated reply.
    private const int BatchSize = 40;

    public async Task<IReadOnlyDictionary<string, Guid>> CategorizeManyAsync(
        IReadOnlyList<string> descriptions, Guid userId, CancellationToken ct = default)
    {
        var result = new Dictionary<string, Guid>();

        if (string.IsNullOrEmpty(options.Value.ApiKey) || options.Value.ApiKey == "not-configured")
        {
            logger.LogDebug("Anthropic:ApiKey not configured — skipping Claude fallback.");
            return result;
        }
        if (descriptions.Count == 0) return result;

        var categories = await categoryRepository.GetAllForUserAsync(userId, ct);
        if (categories.Count == 0) return result;

        var validCategoryIds = categories.Select(c => c.Id).ToHashSet();
        var categoryList = string.Join("\n", categories.Select(c => $"- {c.Id}: {c.Emoji} {c.Name}"));

        foreach (var batch in descriptions.Chunk(BatchSize))
        {
            ct.ThrowIfCancellationRequested();
            await CategorizeBatchAsync(batch, categoryList, validCategoryIds, result, ct);
        }

        return result;
    }

    private async Task CategorizeBatchAsync(
        string[] batch,
        string categoryList,
        HashSet<Guid> validCategoryIds,
        Dictionary<string, Guid> result,
        CancellationToken ct)
    {
        // Numbered lines in, numbered lines out — keyed by index rather than by echoing the
        // description back, so a merchant name containing a delimiter can't corrupt the mapping.
        var numbered = string.Join("\n", batch.Select((d, i) => $"{i + 1}. {MerchantNormalizer.Normalize(d)}"));

        var prompt = $"""
            You are categorizing Danish bank transactions.

            Available categories (ID: name):
            {categoryList}

            Transactions:
            {numbered}

            For each numbered transaction, reply with one line in the form:
            <number>: <category UUID>

            Use the word "null" instead of a UUID if no category fits. Output only these lines,
            one per transaction, with no other text.
            """;

        var request = new AnthropicRequest
        {
            Model = options.Value.Model,
            MaxTokens = 32 + batch.Length * 24,
            Messages = [new AnthropicMessage { Role = "user", Content = prompt }],
        };

        try
        {
            var http = httpClientFactory.CreateClient("Anthropic");
            var response = await http.PostAsJsonAsync("/v1/messages", request, ct);

            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning("Anthropic API returned {Status} for a batch of {Count}.", response.StatusCode, batch.Length);
                return;
            }

            var apiResult = await response.Content.ReadFromJsonAsync<AnthropicResponse>(ct);
            var text = apiResult?.Content?.FirstOrDefault()?.Text;
            if (string.IsNullOrWhiteSpace(text)) return;

            foreach (var line in text.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            {
                var separator = line.IndexOf(':');
                if (separator <= 0) continue;

                if (!int.TryParse(line[..separator].Trim(' ', '.', '-'), out var index)) continue;
                if (index < 1 || index > batch.Length) continue;

                var value = line[(separator + 1)..].Trim();
                if (!Guid.TryParse(value, out var categoryId)) continue; // covers "null" and any stray prose
                if (!validCategoryIds.Contains(categoryId))
                {
                    logger.LogWarning("Claude returned unknown category ID {Id}.", categoryId);
                    continue;
                }

                result[batch[index - 1]] = categoryId;
            }
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Claude categorization failed for a batch of {Count}.", batch.Length);
        }
    }

    private sealed record AnthropicRequest
    {
        [JsonPropertyName("model")] public string Model { get; init; } = "";
        [JsonPropertyName("max_tokens")] public int MaxTokens { get; init; }
        [JsonPropertyName("messages")] public AnthropicMessage[] Messages { get; init; } = [];
    }

    private sealed record AnthropicMessage
    {
        [JsonPropertyName("role")] public string Role { get; init; } = "";
        [JsonPropertyName("content")] public string Content { get; init; } = "";
    }

    private sealed record AnthropicResponse
    {
        [JsonPropertyName("content")] public AnthropicContent[]? Content { get; init; }
    }

    private sealed record AnthropicContent
    {
        [JsonPropertyName("text")] public string? Text { get; init; }
    }
}

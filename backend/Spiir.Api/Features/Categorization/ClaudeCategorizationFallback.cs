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
    public async Task<Guid?> CategorizeAsync(string description, Guid userId, CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(options.Value.ApiKey))
        {
            logger.LogDebug("Anthropic:ApiKey not configured — skipping Claude fallback.");
            return null;
        }

        var categories = await categoryRepository.GetAllForUserAsync(userId, ct);

        if (categories.Count == 0) return null;

        var categoryList = string.Join("\n", categories.Select(c => $"- {c.Id}: {c.Emoji} {c.Name}"));
        var prompt = $"""
            You are categorizing a Danish bank transaction.

            Transaction description: "{description}"

            Available categories (ID: name):
            {categoryList}

            Reply with ONLY the UUID of the best-matching category, or the word "null" if none fit.
            Do not include any other text.
            """;

        var request = new AnthropicRequest
        {
            Model = options.Value.Model,
            MaxTokens = 64,
            Messages = [new AnthropicMessage { Role = "user", Content = prompt }],
        };

        try
        {
            var http = httpClientFactory.CreateClient("Anthropic");
            var response = await http.PostAsJsonAsync("/v1/messages", request, ct);

            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning("Anthropic API returned {Status} for '{Description}'.", response.StatusCode, description);
                return null;
            }

            var result = await response.Content.ReadFromJsonAsync<AnthropicResponse>(ct);
            var text = result?.Content?.FirstOrDefault()?.Text?.Trim();

            if (string.IsNullOrEmpty(text) || text.Equals("null", StringComparison.OrdinalIgnoreCase))
                return null;

            if (!Guid.TryParse(text, out var categoryId))
            {
                logger.LogWarning("Claude returned non-UUID '{Text}' for '{Description}'.", text, description);
                return null;
            }

            if (!categories.Any(c => c.Id == categoryId))
            {
                logger.LogWarning("Claude returned unknown category ID {Id} for '{Description}'.", categoryId, description);
                return null;
            }

            logger.LogDebug("Claude categorized '{Description}' → {CategoryId}.", description, categoryId);
            return categoryId;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Claude categorization failed for '{Description}'.", description);
            return null;
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

using System.Net.Http.Json;
using Microsoft.Extensions.Options;

namespace Spiir.Api.Infrastructure.GoCardless;

public class GoCardlessTokenService(
    IHttpClientFactory httpClientFactory,
    IOptions<GoCardlessOptions> options,
    ILogger<GoCardlessTokenService> logger) : IGoCardlessTokenService
{
    private readonly SemaphoreSlim _lock = new(1, 1);
    private string? _accessToken;
    private DateTimeOffset _expiresAt;

    public async Task<string> GetAccessTokenAsync(CancellationToken ct = default)
    {
        if (_accessToken is not null && DateTimeOffset.UtcNow < _expiresAt.AddMinutes(-5))
            return _accessToken;

        await _lock.WaitAsync(ct);
        try
        {
            if (_accessToken is not null && DateTimeOffset.UtcNow < _expiresAt.AddMinutes(-5))
                return _accessToken;

            logger.LogInformation("Refreshing GoCardless access token");
            var http = httpClientFactory.CreateClient("GoCardless");
            var resp = await http.PostAsJsonAsync("/api/v2/token/new/", new
            {
                secret_id = options.Value.SecretId,
                secret_key = options.Value.SecretKey,
                grant_type = "client_credentials",
            }, ct);
            resp.EnsureSuccessStatusCode();
            var token = await resp.Content.ReadFromJsonAsync<TokenResponse>(ct)
                        ?? throw new InvalidOperationException("Empty token response from GoCardless.");

            _accessToken = token.Access;
            _expiresAt = DateTimeOffset.UtcNow.AddSeconds(token.AccessExpires);
            logger.LogInformation("GoCardless token acquired, expires in {Seconds}s", token.AccessExpires);
            return _accessToken;
        }
        finally
        {
            _lock.Release();
        }
    }
}

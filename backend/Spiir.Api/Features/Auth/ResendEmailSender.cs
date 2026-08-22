using System.Net.Http.Json;
using Microsoft.Extensions.Options;

namespace Spiir.Api.Features.Auth;

public class ResendEmailSender(
    IHttpClientFactory httpClientFactory,
    IOptions<ResendOptions> options,
    ILogger<ResendEmailSender> logger) : IEmailSender
{
    public async Task SendMagicLinkAsync(string toEmail, string magicLinkUrl, CancellationToken ct = default)
    {
        var http = httpClientFactory.CreateClient("Resend");
        var resp = await http.PostAsJsonAsync("/emails", new
        {
            from = options.Value.FromAddress,
            to = new[] { toEmail },
            subject = "Sign in to Spiir",
            html = $"""
                <p>Click the link below to sign in to Spiir:</p>
                <p><a href="{magicLinkUrl}">{magicLinkUrl}</a></p>
                <p>This link expires in 15 minutes and can only be used once.</p>
                """,
        }, ct);

        if (!resp.IsSuccessStatusCode)
        {
            var body = await resp.Content.ReadAsStringAsync(ct);
            logger.LogError("Resend API error {Status}: {Body}", resp.StatusCode, body);
            resp.EnsureSuccessStatusCode();
        }
    }
}

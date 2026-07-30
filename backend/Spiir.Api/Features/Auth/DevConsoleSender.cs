namespace Spiir.Api.Features.Auth;

public class DevConsoleSender(ILogger<DevConsoleSender> logger, IWebHostEnvironment env) : IEmailSender
{
    // Last-sent URL is written here so automated tests can pick it up without real email.
    public static readonly string LastLinkFile =
        Path.Combine(Path.GetTempPath(), "spiir-last-magic-link.txt");

    public Task SendMagicLinkAsync(string toEmail, string magicLinkUrl, CancellationToken ct = default)
    {
        logger.LogWarning(
            "📧 [DEV] Magic link for {Email}: {Url}",
            toEmail, magicLinkUrl);
        Console.WriteLine($"\n📧 [DEV] Magic link for {toEmail}:\n  {magicLinkUrl}\n");

        if (env.IsDevelopment())
            File.WriteAllText(LastLinkFile, magicLinkUrl);

        return Task.CompletedTask;
    }
}

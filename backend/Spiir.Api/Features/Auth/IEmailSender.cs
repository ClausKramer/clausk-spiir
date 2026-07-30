namespace Spiir.Api.Features.Auth;

public interface IEmailSender
{
    Task SendMagicLinkAsync(string toEmail, string magicLinkUrl, CancellationToken ct = default);
}

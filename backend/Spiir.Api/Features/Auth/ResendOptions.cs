namespace Spiir.Api.Features.Auth;

public class ResendOptions
{
    public string ApiKey { get; set; } = "";

    // Resend requires the from-address's domain to be verified in your Resend account (except
    // their shared onboarding@resend.dev test domain, which only reaches the account owner's
    // own inbox) — see https://resend.com/domains.
    public string FromAddress { get; set; } = "Spiir <onboarding@resend.dev>";
}

namespace Spiir.Api.Infrastructure.EnableBanking;

public class EnableBankingOptions
{
    public string ApplicationId { get; set; } = "";

    // RSA private key downloaded when the application was registered in the Enable Banking
    // control panel. Accepts either raw PEM (local dev, via user-secrets) or base64-encoded PEM
    // (Azure Key Vault / env var, to sidestep newline handling in .env-style config) — see
    // EnableBankingTokenService.NormalizePem.
    public string PrivateKey { get; set; } = "";

    public string BaseUrl { get; set; } = "https://api.enablebanking.com";
    public string RedirectUrl { get; set; } = "http://localhost:5173/accounts/connected";
}

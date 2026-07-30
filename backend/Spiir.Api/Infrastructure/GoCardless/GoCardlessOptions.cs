namespace Spiir.Api.Infrastructure.GoCardless;

public class GoCardlessOptions
{
    public string SecretId { get; set; } = "";
    public string SecretKey { get; set; } = "";
    public string BaseUrl { get; set; } = "https://bankaccountdata.gocardless.com";
    public string RedirectUrl { get; set; } = "http://localhost:5173/accounts/connected";
}

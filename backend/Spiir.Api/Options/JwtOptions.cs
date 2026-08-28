namespace Spiir.Api.Options;

public class JwtOptions
{
    public string Key { get; set; } = "";
    public string Issuer { get; set; } = "spiir";
    public string Audience { get; set; } = "spiir";
    public int AccessTokenMinutes { get; set; } = 15;
    public int RefreshTokenDays { get; set; } = 180;
}

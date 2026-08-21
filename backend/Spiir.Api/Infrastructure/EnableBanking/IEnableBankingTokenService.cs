namespace Spiir.Api.Infrastructure.EnableBanking;

public interface IEnableBankingTokenService
{
    // Returns a signed RS256 JWT to send as the API's Authorization: Bearer header. Cached and
    // re-signed only once it's close to expiry — no network call involved (unlike GoCardless's
    // token endpoint), since Enable Banking JWTs are self-issued from the application's private key.
    string GetJwt();
}

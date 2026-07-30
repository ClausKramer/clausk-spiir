namespace Spiir.Api.Infrastructure.GoCardless;

public interface IGoCardlessTokenService
{
    Task<string> GetAccessTokenAsync(CancellationToken ct = default);
}

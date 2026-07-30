using Spiir.Api.Domain.Entities;

namespace Spiir.Api.Features.Auth;

public interface IPasswordlessAuthenticator
{
    Task RequestMagicLinkAsync(string email, string baseUrl, CancellationToken ct = default);
    Task<AuthResult> VerifyMagicLinkAsync(string token, CancellationToken ct = default);
    Task<AuthResult> RefreshAsync(string refreshToken, CancellationToken ct = default);
    Task RevokeRefreshTokenAsync(string refreshToken, CancellationToken ct = default);
}

public record AuthResult(string AccessToken, string RefreshToken, UserDto User);
public record UserDto(Guid Id, string Email);

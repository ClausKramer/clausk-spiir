using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using Spiir.Api.Data;
using Spiir.Api.Data.Repositories;
using Spiir.Api.Domain.Entities;
using Spiir.Api.Options;

namespace Spiir.Api.Features.Auth;

public class PasswordlessAuthenticator(
    UserRepository users,
    MagicLinkTokenRepository magicLinkTokens,
    RefreshTokenRepository refreshTokens,
    IEmailSender emailSender,
    DefaultDataSeeder seeder,
    IOptions<JwtOptions> jwtOptions) : IPasswordlessAuthenticator
{
    public async Task RequestMagicLinkAsync(string email, string baseUrl, CancellationToken ct = default)
    {
        email = email.Trim().ToLowerInvariant();

        var user = await users.GetByEmailAsync(email, ct);
        bool isNew = user is null;

        if (isNew)
        {
            user = new User { Id = Guid.NewGuid(), Email = email, CreatedAt = DateTime.UtcNow };
            await users.InsertAsync(user, ct);
        }

        var now = DateTime.UtcNow;

        // Expire any existing unused tokens for this user
        await magicLinkTokens.ExpireActiveTokensAsync(user!.Id, now, ct);

        var rawToken = GenerateToken();
        var hash = HashToken(rawToken);

        await magicLinkTokens.InsertAsync(new MagicLinkToken
        {
            Id = Guid.NewGuid(),
            UserId = user.Id,
            TokenHash = hash,
            CreatedAt = now,
            ExpiresAt = now.AddMinutes(15),
        }, ct);

        if (isNew)
            await seeder.SeedForUserAsync(user, ct);

        var url = $"{baseUrl.TrimEnd('/')}/auth/verify?token={Uri.EscapeDataString(rawToken)}";
        await emailSender.SendMagicLinkAsync(email, url, ct);
    }

    public async Task<AuthResult> VerifyMagicLinkAsync(string rawToken, CancellationToken ct = default)
    {
        var hash = HashToken(rawToken);
        var now = DateTime.UtcNow;

        var found = await magicLinkTokens.GetValidWithUserByHashAsync(hash, now, ct)
            ?? throw new InvalidOperationException("Token is invalid or expired.");

        await magicLinkTokens.MarkConsumedAsync(found.Token.Id, now, ct);

        return await IssueTokensAsync(found.User, ct);
    }

    public async Task<AuthResult> RefreshAsync(string rawRefreshToken, CancellationToken ct = default)
    {
        var hash = HashToken(rawRefreshToken);
        var now = DateTime.UtcNow;

        var found = await refreshTokens.GetValidWithUserByHashAsync(hash, now, ct)
            ?? throw new InvalidOperationException("Refresh token is invalid or expired.");

        // Rotate: revoke old, issue new
        await refreshTokens.RevokeAsync(found.Token.Id, now, ct);

        return await IssueTokensAsync(found.User, ct);
    }

    public async Task RevokeRefreshTokenAsync(string rawRefreshToken, CancellationToken ct = default)
    {
        var hash = HashToken(rawRefreshToken);
        await refreshTokens.RevokeByHashAsync(hash, DateTime.UtcNow, ct);
    }

    private async Task<AuthResult> IssueTokensAsync(User user, CancellationToken ct)
    {
        var accessToken = GenerateAccessToken(user);

        var rawRefresh = GenerateToken();
        await refreshTokens.InsertAsync(new RefreshToken
        {
            Id = Guid.NewGuid(),
            UserId = user.Id,
            TokenHash = HashToken(rawRefresh),
            CreatedAt = DateTime.UtcNow,
            ExpiresAt = DateTime.UtcNow.AddDays(jwtOptions.Value.RefreshTokenDays),
        }, ct);

        return new AuthResult(accessToken, rawRefresh, new UserDto(user.Id, user.Email));
    }

    private string GenerateAccessToken(User user)
    {
        var opts = jwtOptions.Value;
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(opts.Key));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var token = new JwtSecurityToken(
            issuer: opts.Issuer,
            audience: opts.Audience,
            claims:
            [
                new Claim(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
                new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
                new Claim(JwtRegisteredClaimNames.Email, user.Email),
                new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
            ],
            expires: DateTime.UtcNow.AddMinutes(opts.AccessTokenMinutes),
            signingCredentials: creds);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    private static string GenerateToken() =>
        Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
            .Replace("+", "-").Replace("/", "_").TrimEnd('=');

    private static string HashToken(string token)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(token));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }
}

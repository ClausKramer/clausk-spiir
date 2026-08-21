using System.IdentityModel.Tokens.Jwt;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace Spiir.Api.Infrastructure.EnableBanking;

public class EnableBankingTokenService(IOptions<EnableBankingOptions> options) : IEnableBankingTokenService
{
    private readonly object _lock = new();
    private string? _cachedJwt;
    private DateTimeOffset _expiresAt;

    public string GetJwt()
    {
        lock (_lock)
        {
            if (_cachedJwt is not null && DateTimeOffset.UtcNow < _expiresAt)
                return _cachedJwt;

            var opts = options.Value;
            using var rsa = RSA.Create();
            rsa.ImportFromPem(NormalizePem(opts.PrivateKey));

            var now = DateTimeOffset.UtcNow;
            var expires = now.AddMinutes(55); // Enable Banking JWTs are valid for up to 1 hour.

            var credentials = new SigningCredentials(
                new RsaSecurityKey(rsa) { KeyId = opts.ApplicationId },
                SecurityAlgorithms.RsaSha256);
            var header = new JwtHeader(credentials)
            {
                ["kid"] = opts.ApplicationId,
            };
            var payload = new JwtPayload(
                issuer: "enablebanking.com",
                audience: "api.enablebanking.com",
                claims: null,
                notBefore: now.UtcDateTime,
                expires: expires.UtcDateTime,
                issuedAt: now.UtcDateTime);

            _cachedJwt = new JwtSecurityTokenHandler().WriteToken(new JwtSecurityToken(header, payload));
            _expiresAt = expires.AddMinutes(-5);
            return _cachedJwt;
        }
    }

    // Locally the PEM (with real newlines) is stored directly in user-secrets. In Azure, Key
    // Vault secrets end up round-tripped through an env var, where embedded newlines are fragile
    // to preserve — so the deployed value is base64-encoded PEM instead. Accept both.
    private static string NormalizePem(string raw)
    {
        if (raw.Contains("-----BEGIN", StringComparison.Ordinal))
            return raw;

        return Encoding.UTF8.GetString(Convert.FromBase64String(raw));
    }
}

using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Spiir.Api.Options;

namespace Spiir.Api.Features.Auth;

public static class AuthEndpoints
{
    private const string CookieName = "refresh_token";

    public static IEndpointRouteBuilder MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/auth").WithTags("Auth");

        group.MapPost("/request-link", RequestLink);
        group.MapGet("/verify", VerifyGet);
        group.MapPost("/verify", VerifyPost);
        group.MapPost("/refresh", Refresh);
        group.MapPost("/logout", Logout);

        return app;
    }

    private static async Task<IResult> RequestLink(
        [FromBody] RequestLinkRequest req,
        IPasswordlessAuthenticator auth,
        IConfiguration config,
        HttpContext ctx,
        ILoggerFactory loggerFactory,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.Email))
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                ["email"] = ["Email is required."]
            });

        // The magic link must point at the frontend (which owns the /auth/verify *page* that
        // POSTs the token to this API), not at this API's own host — ctx.Request.Host is this
        // API's host regardless of environment (even in dev, Vite's proxy has changeOrigin: true,
        // so it rewrites the Host header to the backend's). CorsOrigin is already configured with
        // the frontend's origin for exactly this reason (see Program.cs CORS policy / infra Bicep).
        var baseUrl = config["CorsOrigin"] ?? $"{ctx.Request.Scheme}://{ctx.Request.Host}";
        loggerFactory.CreateLogger("Auth").LogInformation("Magic link base URL resolved to {BaseUrl}", baseUrl);
        await auth.RequestMagicLinkAsync(req.Email, baseUrl, ct);
        return TypedResults.Ok(new { message = "Check your email for the magic link." });
    }

    private static Task<IResult> VerifyGet(
        string? token,
        IPasswordlessAuthenticator auth,
        HttpContext ctx,
        IOptions<JwtOptions> jwtOptions,
        CancellationToken ct) =>
        DoVerify(token, auth, ctx, jwtOptions, ct);

    private static Task<IResult> VerifyPost(
        [FromBody] VerifyRequest body,
        IPasswordlessAuthenticator auth,
        HttpContext ctx,
        IOptions<JwtOptions> jwtOptions,
        CancellationToken ct) =>
        DoVerify(body.Token, auth, ctx, jwtOptions, ct);

    private static async Task<IResult> DoVerify(
        string? rawToken,
        IPasswordlessAuthenticator auth,
        HttpContext ctx,
        IOptions<JwtOptions> jwtOptions,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(rawToken))
            return TypedResults.BadRequest(new { error = "Token is required." });

        try
        {
            var result = await auth.VerifyMagicLinkAsync(rawToken, ct);
            SetRefreshCookie(ctx, result.RefreshToken, jwtOptions);
            return TypedResults.Ok(new { accessToken = result.AccessToken, user = result.User });
        }
        catch (InvalidOperationException ex)
        {
            return TypedResults.BadRequest(new { error = ex.Message });
        }
    }

    private static async Task<IResult> Refresh(
        IPasswordlessAuthenticator auth,
        HttpContext ctx,
        IOptions<JwtOptions> jwtOptions,
        ILoggerFactory loggerFactory,
        CancellationToken ct)
    {
        var log = loggerFactory.CreateLogger("Auth");
        var userAgent = ctx.Request.Headers.UserAgent.ToString();

        // Logged because the frontend and this API are on different sites, so whether the refresh
        // cookie comes back at all is up to the browser — Safari and some privacy settings drop
        // third-party cookies outright. "Never sent" and "sent but rejected" are different
        // problems with different fixes, and nothing else records which one a sign-in hit.
        var rawToken = ctx.Request.Cookies[CookieName];
        if (string.IsNullOrWhiteSpace(rawToken))
        {
            log.LogInformation("Refresh rejected: the request carried no refresh_token cookie. UserAgent={UserAgent}", userAgent);
            return TypedResults.Unauthorized();
        }

        try
        {
            var result = await auth.RefreshAsync(rawToken, ct);
            SetRefreshCookie(ctx, result.RefreshToken, jwtOptions);
            log.LogInformation("Refresh ok. UserAgent={UserAgent}", userAgent);
            return TypedResults.Ok(new { accessToken = result.AccessToken, user = result.User });
        }
        catch (InvalidOperationException)
        {
            // The cookie is deliberately left alone. Two tabs refreshing at once present the same
            // token; one wins and is handed a fresh cookie, and the other is rejected — if that
            // rejection cleared the cookie it would delete the winner's, signing both out. A
            // rejected token is harmless to keep: it just expires, or is replaced at next sign-in.
            log.LogInformation("Refresh rejected: the refresh_token was unknown, revoked or expired. UserAgent={UserAgent}", userAgent);
            return TypedResults.Unauthorized();
        }
    }

    private static async Task<IResult> Logout(
        IPasswordlessAuthenticator auth,
        HttpContext ctx,
        CancellationToken ct)
    {
        var rawToken = ctx.Request.Cookies[CookieName];
        if (!string.IsNullOrWhiteSpace(rawToken))
            await auth.RevokeRefreshTokenAsync(rawToken, ct);

        ClearRefreshCookie(ctx);
        return TypedResults.Ok(new { message = "Logged out." });
    }

    private static void SetRefreshCookie(HttpContext ctx, string token, IOptions<JwtOptions> jwtOptions)
    {
        var options = BaseCookieOptions(ctx);
        options.Expires = DateTimeOffset.UtcNow.AddDays(jwtOptions.Value.RefreshTokenDays);
        ctx.Response.Cookies.Append(CookieName, token, options);
    }

    private static void ClearRefreshCookie(HttpContext ctx) =>
        ctx.Response.Cookies.Delete(CookieName, BaseCookieOptions(ctx));

    // The frontend (Static Web App) and this API (Container Apps) are on entirely different
    // domains, not just different origins on the same site — SameSite=Strict (or even Lax) blocks
    // the browser from ever sending this cookie on the frontend's cross-site refresh call, so
    // /auth/refresh silently 401s on every attempt and users get force-logged-out the moment their
    // access token expires. SameSite=None (+ Secure, which it requires) is the only setting that
    // works for this cross-site architecture. Locally, frontend and backend are same-origin
    // through Vite's dev proxy, and None+Secure would be dropped anyway since dev runs over plain
    // HTTP — Strict is both sufficient and correct there.
    private static CookieOptions BaseCookieOptions(HttpContext ctx)
    {
        var isDev = ctx.RequestServices.GetRequiredService<IWebHostEnvironment>().IsDevelopment();
        return new CookieOptions
        {
            HttpOnly = true,
            Secure = !isDev,
            SameSite = isDev ? SameSiteMode.Strict : SameSiteMode.None,
            Path = "/auth",
        };
    }
}

public record RequestLinkRequest(string Email);
public record VerifyRequest(string Token);

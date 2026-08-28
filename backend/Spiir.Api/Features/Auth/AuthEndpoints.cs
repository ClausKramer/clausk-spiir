using Microsoft.AspNetCore.Mvc;

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
        CancellationToken ct) =>
        DoVerify(token, auth, ctx, ct);

    private static Task<IResult> VerifyPost(
        [FromBody] VerifyRequest body,
        IPasswordlessAuthenticator auth,
        HttpContext ctx,
        CancellationToken ct) =>
        DoVerify(body.Token, auth, ctx, ct);

    private static async Task<IResult> DoVerify(
        string? rawToken,
        IPasswordlessAuthenticator auth,
        HttpContext ctx,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(rawToken))
            return TypedResults.BadRequest(new { error = "Token is required." });

        try
        {
            var result = await auth.VerifyMagicLinkAsync(rawToken, ct);
            SetRefreshCookie(ctx, result.RefreshToken);
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
        CancellationToken ct)
    {
        var rawToken = ctx.Request.Cookies[CookieName];
        if (string.IsNullOrWhiteSpace(rawToken))
            return TypedResults.Unauthorized();

        try
        {
            var result = await auth.RefreshAsync(rawToken, ct);
            SetRefreshCookie(ctx, result.RefreshToken);
            return TypedResults.Ok(new { accessToken = result.AccessToken, user = result.User });
        }
        catch (InvalidOperationException)
        {
            ClearRefreshCookie(ctx);
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

    private static void SetRefreshCookie(HttpContext ctx, string token)
    {
        ctx.Response.Cookies.Append(CookieName, token, new CookieOptions
        {
            HttpOnly = true,
            Secure = !ctx.RequestServices.GetRequiredService<IWebHostEnvironment>().IsDevelopment(),
            SameSite = SameSiteMode.Strict,
            Expires = DateTimeOffset.UtcNow.AddDays(30),
            Path = "/auth",
        });
    }

    private static void ClearRefreshCookie(HttpContext ctx) =>
        ctx.Response.Cookies.Delete(CookieName, new CookieOptions { Path = "/auth" });
}

public record RequestLinkRequest(string Email);
public record VerifyRequest(string Token);

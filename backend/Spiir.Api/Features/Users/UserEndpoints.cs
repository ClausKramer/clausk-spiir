using Spiir.Api.Data.Repositories;
using Spiir.Api.Services;

namespace Spiir.Api.Features.Users;

public static class UserEndpoints
{
    public static IEndpointRouteBuilder MapUserEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/me").WithTags("Users").RequireAuthorization();

        group.MapGet("/", GetMe);

        return app;
    }

    private static async Task<IResult> GetMe(
        ICurrentUser currentUser,
        UserRepository users,
        CancellationToken ct)
    {
        var userId = currentUser.GetRequiredUserId();
        var user = await users.GetByIdAsync(userId, ct);
        return user is null
            ? TypedResults.NotFound()
            : TypedResults.Ok(new { user.Id, user.Email, user.CreatedAt });
    }
}

using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using Spiir.Api.Data;
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
        AppDbContext db,
        CancellationToken ct)
    {
        var userId = currentUser.GetRequiredUserId();
        var user = await db.Users.FindAsync([userId], ct);
        return user is null
            ? TypedResults.NotFound()
            : TypedResults.Ok(new { user.Id, user.Email, user.CreatedAt });
    }
}

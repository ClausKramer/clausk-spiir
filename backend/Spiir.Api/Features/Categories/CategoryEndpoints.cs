using Spiir.Api.Data.Repositories;
using Spiir.Api.Services;

namespace Spiir.Api.Features.Categories;

public static class CategoryEndpoints
{
    public static IEndpointRouteBuilder MapCategoryEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/categories").WithTags("Categories").RequireAuthorization();

        group.MapGet("/", GetCategories);

        return app;
    }

    private static async Task<IResult> GetCategories(
        CategoryRepository categories,
        ICurrentUser currentUser,
        CancellationToken ct = default)
    {
        var userId = currentUser.GetRequiredUserId();
        var result = await categories.GetAllForUserAsync(userId, ct);

        return TypedResults.Ok(result.Select(c => new { c.Id, c.Name, c.Emoji }));
    }
}

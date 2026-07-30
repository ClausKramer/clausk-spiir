using Microsoft.EntityFrameworkCore;
using Spiir.Api.Data;
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
        AppDbContext db,
        ICurrentUser currentUser,
        CancellationToken ct = default)
    {
        var categories = await db.Categories
            .OrderBy(c => c.Name)
            .Select(c => new { c.Id, c.Name, c.Emoji })
            .ToListAsync(ct);

        return TypedResults.Ok(categories);
    }
}

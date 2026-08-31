using Spiir.Api.Data;
using Spiir.Api.Data.Repositories;
using Spiir.Api.Services;

namespace Spiir.Api.Features.Categories;

public static class CategoryEndpoints
{
    public static IEndpointRouteBuilder MapCategoryEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/categories").WithTags("Categories").RequireAuthorization();

        group.MapGet("/", GetCategories);
        group.MapPost("/sync-defaults", SyncDefaults);
        group.MapDelete("/learned-rules", DeleteLearnedRules);

        return app;
    }

    // Learned rules come from a heuristic merchant key, so a bad one can quietly mis-file
    // everything it matches. This clears them all so categorization falls back to the seeded
    // defaults; existing transaction categories are left alone.
    private static async Task<IResult> DeleteLearnedRules(
        CategorizationRuleRepository rules,
        ICurrentUser currentUser,
        CancellationToken ct = default)
    {
        var userId = currentUser.GetRequiredUserId();
        var deleted = await rules.DeleteLearnedRulesAsync(userId, minPriority: 100, ct);

        return TypedResults.Ok(new
        {
            deleted,
            message = deleted == 0 ? "No learned rules to clear." : $"Cleared {deleted} learned rule(s).",
        });
    }

    // Adds default categories/rules introduced after this account was created — accounts only get
    // the defaults that existed at registration, so new ones (notably Income and Transfer) would
    // otherwise never reach existing users. Additive and idempotent.
    private static async Task<IResult> SyncDefaults(
        DefaultDataSeeder seeder,
        ICurrentUser currentUser,
        CancellationToken ct = default)
    {
        var userId = currentUser.GetRequiredUserId();
        var (addedCategories, addedRules, removedRules) = await seeder.SeedMissingForUserAsync(userId, ct);

        var parts = new List<string>();
        if (addedCategories > 0) parts.Add($"{addedCategories} categor{(addedCategories == 1 ? "y" : "ies")}");
        if (addedRules > 0) parts.Add($"{addedRules} rule(s)");

        var message = parts.Count == 0 && removedRules == 0
            ? "Already up to date."
            : string.Join(" ", new[]
            {
                parts.Count > 0 ? $"Added {string.Join(" and ", parts)}." : null,
                removedRules > 0 ? $"Removed {removedRules} outdated rule(s)." : null,
            }.Where(p => p is not null));

        return TypedResults.Ok(new { addedCategories, addedRules, removedRules, message });
    }

    private static async Task<IResult> GetCategories(
        CategoryRepository categories,
        ICurrentUser currentUser,
        CancellationToken ct = default)
    {
        var userId = currentUser.GetRequiredUserId();
        var result = await categories.GetAllForUserAsync(userId, ct);

        return TypedResults.Ok(result.Select(c => new { c.Id, c.Name, c.Emoji, c.ParentCategoryId, c.Kind }));
    }
}

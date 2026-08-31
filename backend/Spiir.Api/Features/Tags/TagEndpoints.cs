using Spiir.Api.Data.Repositories;
using Spiir.Api.Services;

namespace Spiir.Api.Features.Tags;

public static class TagEndpoints
{
    public static IEndpointRouteBuilder MapTagEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/tags").WithTags("Tags").RequireAuthorization();

        group.MapGet("/", GetTags);
        group.MapPost("/attach", AttachTag);
        group.MapPost("/detach", DetachTag);
        group.MapDelete("/{id:guid}", DeleteTag);

        return app;
    }

    private static async Task<IResult> GetTags(
        TagRepository tags,
        ICurrentUser currentUser,
        CancellationToken ct = default)
    {
        var userId = currentUser.GetRequiredUserId();
        return TypedResults.Ok(await tags.GetAllForUserAsync(userId, ct));
    }

    private record AttachTagRequest(Guid TransactionId, string Name);

    // Takes a name rather than an id so the client doesn't need a create-then-attach round trip:
    // typing a new tag and picking an existing one are the same action from the user's side.
    private static async Task<IResult> AttachTag(
        AttachTagRequest body,
        TagRepository tags,
        ICurrentUser currentUser,
        CancellationToken ct = default)
    {
        var name = body.Name?.Trim();
        if (string.IsNullOrWhiteSpace(name))
            return TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["name"] = ["Name is required."] });
        if (name.Length > 60)
            return TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["name"] = ["Name is too long (max 60)."] });

        var userId = currentUser.GetRequiredUserId();
        var tag = await tags.GetOrCreateAsync(userId, name, ct);
        await tags.AddToTransactionAsync(userId, body.TransactionId, tag.Id, ct);

        return TypedResults.Ok(new { tag.Id, tag.Name });
    }

    private record DetachTagRequest(Guid TransactionId, Guid TagId);

    private static async Task<IResult> DetachTag(
        DetachTagRequest body,
        TagRepository tags,
        ICurrentUser currentUser,
        CancellationToken ct = default)
    {
        var userId = currentUser.GetRequiredUserId();
        var removed = await tags.RemoveFromTransactionAsync(userId, body.TransactionId, body.TagId, ct);
        return removed > 0 ? TypedResults.NoContent() : TypedResults.NotFound();
    }

    // Removes the tag everywhere, not just from one transaction — for cleaning up a typo or a tag
    // that stopped being useful.
    private static async Task<IResult> DeleteTag(
        Guid id,
        TagRepository tags,
        ICurrentUser currentUser,
        CancellationToken ct = default)
    {
        var userId = currentUser.GetRequiredUserId();
        var deleted = await tags.DeleteAsync(userId, id, ct);
        return deleted ? TypedResults.NoContent() : TypedResults.NotFound();
    }
}

namespace Spiir.Api.Domain.Entities;

/// <summary>
/// A free-form label across transactions, independent of the category tree. A transaction has one
/// category — where it belongs in the budget — and any number of tags, which answer questions the
/// budget can't: what a child costs, what a hobby costs, what a holiday cost in total. Those spans
/// deliberately cross categories, which is exactly why they aren't categories.
/// </summary>
public class Tag
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public User User { get; set; } = null!;
    public string Name { get; set; } = "";
    public DateTime CreatedAt { get; set; }
}

namespace Spiir.Api.Domain.Entities;

public class Category
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public User User { get; set; } = null!;
    public string Name { get; set; } = "";
    public string? Emoji { get; set; }
    /// <summary>Null for a top-level group; set for a leaf that transactions and rules attach to.</summary>
    public Guid? ParentCategoryId { get; set; }
    public string Kind { get; set; } = CategoryKind.Variable;
    public DateTime CreatedAt { get; set; }

    public ICollection<CategorizationRule> CategorizationRules { get; set; } = [];
}

/// <summary>
/// What a category means for a budget, as opposed to what it's called. The split that matters is
/// committed versus discretionary spending — "what can I actually change?" — plus the movements
/// that aren't spending at all and would otherwise read as overspending in a month you saved more
/// or repaid extra. Stored as a string rather than an int so the database stays readable and
/// adding a kind doesn't renumber the existing ones.
/// </summary>
public static class CategoryKind
{
    public const string Income = "Income";
    public const string Fixed = "Fixed";
    public const string Variable = "Variable";
    public const string Savings = "Savings";
    public const string Debt = "Debt";
    public const string Transfer = "Transfer";

    // Saving and repaying debt are choices about where money goes, not consumption; transfers move
    // it without spending it. Excluding all three keeps "spending" answering the question people
    // actually ask of it.
    public static bool IsSpending(string kind) => kind is Fixed or Variable;
}

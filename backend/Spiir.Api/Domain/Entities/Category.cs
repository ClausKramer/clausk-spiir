namespace Spiir.Api.Domain.Entities;

public class Category
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public User User { get; set; } = null!;
    public string Name { get; set; } = "";
    public string? Emoji { get; set; }
    public DateTime CreatedAt { get; set; }

    public ICollection<CategorizationRule> CategorizationRules { get; set; } = [];
}

namespace Spiir.Api.Domain.Entities;

public class CategorizationRule
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public User User { get; set; } = null!;
    public string Pattern { get; set; } = "";
    public bool IsRegex { get; set; }
    public Guid CategoryId { get; set; }
    public Category Category { get; set; } = null!;
    public int Priority { get; set; }
    public DateTime CreatedAt { get; set; }
}

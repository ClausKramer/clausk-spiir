namespace Spiir.Api.Domain.Entities;

public class BankAccount
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public User User { get; set; } = null!;
    public string ExternalAccountId { get; set; } = "";
    public string? Iban { get; set; }
    public string Name { get; set; } = "";
    public string Currency { get; set; } = "DKK";
    public DateTime? LastSyncedAt { get; set; }
    public DateTime CreatedAt { get; set; }

    public ICollection<Transaction> Transactions { get; set; } = [];
}

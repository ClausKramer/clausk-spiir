namespace Spiir.Api.Domain.Entities;

public class Transaction
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public User User { get; set; } = null!;
    public Guid BankAccountId { get; set; }
    public BankAccount BankAccount { get; set; } = null!;
    public string ExternalTransactionId { get; set; } = "";
    public DateOnly BookingDate { get; set; }
    public decimal Amount { get; set; }
    public string Currency { get; set; } = "DKK";
    public string Description { get; set; } = "";
    public Guid? CategoryId { get; set; }
    public Category? Category { get; set; }
    public bool IsCategoryManual { get; set; }
    public DateTime CreatedAt { get; set; }
}

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

    /// <summary>
    /// The balance as the bank last reported it, signed (negative when overdrawn), or null if it
    /// has never been read. This is the account's actual balance, as opposed to the running sum of
    /// the transactions this app happens to hold — the two differ by however much history the bank
    /// declined to serve.
    /// </summary>
    public decimal? Balance { get; set; }

    /// <summary>The balance's own currency, which need not match <see cref="Currency"/>.</summary>
    public string? BalanceCurrency { get; set; }

    /// <summary>
    /// The ISO 20022 balance type the bank sent, kept verbatim (CLBD, ITBD, ITAV, XPCD, ...). A
    /// booked balance and an available one are different figures, so the UI names which it holds.
    /// </summary>
    public string? BalanceType { get; set; }

    /// <summary>The date the bank says the balance describes.</summary>
    public DateOnly? BalanceReferenceDate { get; set; }

    /// <summary>
    /// When the balance was read. Separate from <see cref="BalanceReferenceDate"/> so a figure
    /// fetched today that describes yesterday can't be presented as current.
    /// </summary>
    public DateTime? BalanceFetchedAt { get; set; }

    public ICollection<Transaction> Transactions { get; set; } = [];
}

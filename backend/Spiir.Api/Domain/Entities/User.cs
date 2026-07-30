namespace Spiir.Api.Domain.Entities;

public class User
{
    public Guid Id { get; set; }
    public string Email { get; set; } = "";
    public DateTime CreatedAt { get; set; }

    public ICollection<BankAccount> BankAccounts { get; set; } = [];
    public ICollection<Transaction> Transactions { get; set; } = [];
    public ICollection<Category> Categories { get; set; } = [];
    public ICollection<CategorizationRule> CategorizationRules { get; set; } = [];
    public ICollection<MagicLinkToken> MagicLinkTokens { get; set; } = [];
    public ICollection<RefreshToken> RefreshTokens { get; set; } = [];
}

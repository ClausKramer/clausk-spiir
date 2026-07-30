using Microsoft.EntityFrameworkCore;
using Spiir.Api.Domain.Entities;
using Spiir.Api.Services;

namespace Spiir.Api.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options, ICurrentUser currentUser)
    : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<BankAccount> BankAccounts => Set<BankAccount>();
    public DbSet<Transaction> Transactions => Set<Transaction>();
    public DbSet<Category> Categories => Set<Category>();
    public DbSet<CategorizationRule> CategorizationRules => Set<CategorizationRule>();
    public DbSet<Requisition> Requisitions => Set<Requisition>();
    public DbSet<MagicLinkToken> MagicLinkTokens => Set<MagicLinkToken>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // Tenant isolation: only return data belonging to the authenticated user.
        // currentUser.UserId is null during migrations / design-time — the != null guard
        // keeps those code paths from filtering out everything.
        modelBuilder.Entity<BankAccount>()
            .HasQueryFilter(e => currentUser.UserId != null && e.UserId == currentUser.UserId);
        modelBuilder.Entity<Transaction>()
            .HasQueryFilter(e => currentUser.UserId != null && e.UserId == currentUser.UserId);
        modelBuilder.Entity<Category>()
            .HasQueryFilter(e => currentUser.UserId != null && e.UserId == currentUser.UserId);
        modelBuilder.Entity<CategorizationRule>()
            .HasQueryFilter(e => currentUser.UserId != null && e.UserId == currentUser.UserId);
        modelBuilder.Entity<Requisition>()
            .HasQueryFilter(e => currentUser.UserId != null && e.UserId == currentUser.UserId);

        modelBuilder.Entity<User>()
            .HasIndex(u => u.Email).IsUnique();

        modelBuilder.Entity<MagicLinkToken>()
            .HasIndex(t => t.TokenHash).IsUnique();

        // Dedup incoming GoCardless transactions per user
        modelBuilder.Entity<Transaction>()
            .HasIndex(t => new { t.UserId, t.GoCardlessTransactionId }).IsUnique();
    }
}

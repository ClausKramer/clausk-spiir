using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Spiir.Api.Services;

namespace Spiir.Api.Data;

// Used by EF Core tooling (dotnet ef migrations add ...) at design time.
public class AppDbContextFactory : IDesignTimeDbContextFactory<AppDbContext>
{
    public AppDbContext CreateDbContext(string[] args)
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlite("Data Source=spiir.db")
            .Options;
        return new AppDbContext(options, new AnonymousCurrentUser());
    }
}

file sealed class AnonymousCurrentUser : ICurrentUser
{
    public Guid? UserId => null;
    public bool IsAuthenticated => false;
    public Guid GetRequiredUserId() => throw new InvalidOperationException("No user in design-time context.");
}

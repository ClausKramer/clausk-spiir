using System.Security.Claims;

namespace Spiir.Api.Services;

public class CurrentUserService(IHttpContextAccessor httpContextAccessor) : ICurrentUser
{
    private Guid? _userId;

    public Guid? UserId
    {
        get
        {
            if (_userId.HasValue) return _userId;
            var sub = httpContextAccessor.HttpContext?.User.FindFirstValue(ClaimTypes.NameIdentifier)
                   ?? httpContextAccessor.HttpContext?.User.FindFirstValue("sub");
            if (sub is not null && Guid.TryParse(sub, out var id))
                _userId = id;
            return _userId;
        }
    }

    public bool IsAuthenticated => UserId.HasValue;

    public Guid GetRequiredUserId() =>
        UserId ?? throw new InvalidOperationException("No authenticated user in context.");
}

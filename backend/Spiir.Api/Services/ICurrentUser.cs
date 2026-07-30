namespace Spiir.Api.Services;

public interface ICurrentUser
{
    Guid? UserId { get; }
    bool IsAuthenticated { get; }
    Guid GetRequiredUserId();
}

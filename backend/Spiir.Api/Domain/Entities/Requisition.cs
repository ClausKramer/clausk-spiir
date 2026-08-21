namespace Spiir.Api.Domain.Entities;

public class Requisition
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public User User { get; set; } = null!;
    public string Reference { get; set; } = "";
    public string AspspName { get; set; } = "";
    public string AspspCountry { get; set; } = "";
    public RequisitionStatus Status { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public enum RequisitionStatus
{
    Pending,
    Linked,
    Expired,
    Failed,
}

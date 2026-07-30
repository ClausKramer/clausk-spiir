namespace Spiir.Api.Infrastructure.GoCardless;

public interface IGoCardlessClient
{
    Task<IReadOnlyList<InstitutionDto>> GetInstitutionsAsync(string countryCode, CancellationToken ct = default);
    Task<RequisitionDto> CreateRequisitionAsync(string institutionId, string reference, CancellationToken ct = default);
    Task<RequisitionDto> GetRequisitionAsync(string requisitionId, CancellationToken ct = default);
    Task<IReadOnlyList<GoCardlessAccount>> GetAccountsAsync(string requisitionId, CancellationToken ct = default);
    Task<IReadOnlyList<GoCardlessTransaction>> GetTransactionsAsync(string accountId, DateOnly? dateFrom = null, CancellationToken ct = default);
}

public record GoCardlessAccount(string Id, string? Iban, string? Name, string Currency);
public record GoCardlessTransaction(string TransactionId, DateOnly BookingDate, decimal Amount, string Currency, string Description);

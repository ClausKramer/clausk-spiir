namespace Spiir.Api.Infrastructure.EnableBanking;

public interface IEnableBankingClient
{
    Task<IReadOnlyList<AspspDto>> GetAspspsAsync(string countryCode, CancellationToken ct = default);

    // Starts a PSD2 authorization with the given bank and returns the URL the end user must be
    // redirected to in order to complete consent at their bank.
    Task<string> StartAuthorizationAsync(string aspspName, string aspspCountry, string state, CancellationToken ct = default);

    // Exchanges the `code` returned on the redirect callback for a session and the accounts it grants access to.
    Task<EnableBankingSession> CreateSessionAsync(string code, CancellationToken ct = default);

    Task<IReadOnlyList<EnableBankingTransaction>> GetTransactionsAsync(string accountUid, DateOnly? dateFrom = null, CancellationToken ct = default);
}

public record EnableBankingSession(string SessionId, IReadOnlyList<EnableBankingAccount> Accounts);
public record EnableBankingAccount(string Uid, string? Iban, string? Name, string Currency);
public record EnableBankingTransaction(string TransactionId, DateOnly BookingDate, decimal Amount, string Currency, string Description);

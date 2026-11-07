namespace Spiir.Api.Infrastructure.EnableBanking;

public interface IEnableBankingClient
{
    Task<IReadOnlyList<AspspDto>> GetAspspsAsync(string countryCode, CancellationToken ct = default);

    // Starts a PSD2 authorization with the given bank and returns the URL the end user must be
    // redirected to in order to complete consent at their bank.
    Task<string> StartAuthorizationAsync(string aspspName, string aspspCountry, string state, CancellationToken ct = default);

    // Exchanges the `code` returned on the redirect callback for a session and the accounts it grants access to.
    Task<EnableBankingSession> CreateSessionAsync(string code, CancellationToken ct = default);

    /// <summary>
    /// Fetches transactions for an account, following continuation keys to the end.
    /// </summary>
    /// <param name="longestHistory">
    /// Uses Enable Banking's <c>strategy=longest</c>, which starts from the earliest transaction
    /// the bank still exposes rather than a fixed window, treating <paramref name="dateFrom"/> as
    /// a hint. Intended for an account's first sync: banks generally offer full history only
    /// shortly after consent is granted, and fall back to ~90 days once that window passes.
    /// </param>
    Task<IReadOnlyList<EnableBankingTransaction>> GetTransactionsAsync(
        string accountUid, DateOnly? dateFrom = null, bool longestHistory = false, CancellationToken ct = default);

    /// <summary>
    /// Reads the account's balance from the bank: the figure a statement shows, as opposed to the
    /// running sum of whatever transaction history this app managed to fetch.
    /// </summary>
    /// <remarks>
    /// An account reports several balances at once. This returns the one that best matches how
    /// transactions are imported — booked, so the balance and the stored history describe the same
    /// settled universe — falling back to an available balance when the bank reports no booked
    /// one. Returns null when the bank reports no balance we can read, which is not an error:
    /// PSD2 makes nearly every field optional.
    ///
    /// This spends one AISP access against the PSD2 cap, the same as a transaction fetch. See the
    /// callers in SyncEndpoints and AccountEndpoints for how that budget is kept.
    /// </remarks>
    Task<EnableBankingBalance?> GetBalanceAsync(string accountUid, CancellationToken ct = default);
}

public record EnableBankingSession(string SessionId, IReadOnlyList<EnableBankingAccount> Accounts);
public record EnableBankingAccount(string Uid, string? Iban, string? Name, string Currency);
public record EnableBankingTransaction(string TransactionId, DateOnly BookingDate, decimal Amount, string Currency, string Description);

/// <param name="Amount">Signed as the bank reports it — negative when the account is overdrawn.</param>
/// <param name="BalanceType">The ISO 20022 code the bank sent, kept so the UI can name which balance this is.</param>
/// <param name="IsBooked">Whether <paramref name="BalanceType"/> is a settled (booked) figure rather than an available one.</param>
/// <param name="ReferenceDate">The date the bank says the figure describes, when it says.</param>
public record EnableBankingBalance(
    decimal Amount,
    string Currency,
    string? BalanceType,
    bool IsBooked,
    DateOnly? ReferenceDate);

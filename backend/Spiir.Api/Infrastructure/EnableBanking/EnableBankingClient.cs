using System.Globalization;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.Extensions.Options;

namespace Spiir.Api.Infrastructure.EnableBanking;

public class EnableBankingClient(
    IHttpClientFactory httpClientFactory,
    IEnableBankingTokenService tokenService,
    IOptions<EnableBankingOptions> options) : IEnableBankingClient
{
    private HttpClient AuthenticatedClient()
    {
        var http = httpClientFactory.CreateClient("EnableBanking");
        http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokenService.GetJwt());
        return http;
    }

    public async Task<IReadOnlyList<AspspDto>> GetAspspsAsync(string countryCode, CancellationToken ct = default)
    {
        var http = AuthenticatedClient();
        var resp = await http.GetFromJsonAsync<AspspsResponse>($"/aspsps?country={countryCode}", ct);
        return resp?.Aspsps ?? [];
    }

    public async Task<string> StartAuthorizationAsync(string aspspName, string aspspCountry, string state, CancellationToken ct = default)
    {
        var http = AuthenticatedClient();
        var validUntil = DateTimeOffset.UtcNow.AddDays(90).ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture);
        var body = new StartAuthRequest(
            new AccessDto(validUntil),
            new AspspRefDto(aspspName, aspspCountry),
            state,
            options.Value.RedirectUrl,
            "personal");

        var resp = await http.PostAsJsonAsync("/auth", body, ct);
        resp.EnsureSuccessStatusCode();
        var result = await resp.Content.ReadFromJsonAsync<StartAuthResponse>(ct)
                     ?? throw new InvalidOperationException("Empty authorization response.");
        return result.Url;
    }

    public async Task<EnableBankingSession> CreateSessionAsync(string code, CancellationToken ct = default)
    {
        var http = AuthenticatedClient();
        var resp = await http.PostAsJsonAsync("/sessions", new CreateSessionRequest(code), ct);
        resp.EnsureSuccessStatusCode();
        var session = await resp.Content.ReadFromJsonAsync<SessionResponse>(ct)
                      ?? throw new InvalidOperationException("Empty session response.");

        var accounts = session.Accounts
            .Select(a => new EnableBankingAccount(a.Uid, a.AccountId?.Iban, a.Name, a.Currency ?? "DKK"))
            .ToList();
        return new EnableBankingSession(session.SessionId, accounts);
    }

    public async Task<IReadOnlyList<EnableBankingTransaction>> GetTransactionsAsync(
        string accountUid, DateOnly? dateFrom = null, CancellationToken ct = default)
    {
        var http = AuthenticatedClient();
        var url = $"/accounts/{accountUid}/transactions";
        if (dateFrom.HasValue)
            url += $"?date_from={dateFrom.Value:yyyy-MM-dd}";

        var response = await http.GetFromJsonAsync<TransactionsResponse>(url, ct);
        return response?.Transactions.Select(ToTransaction).ToList() ?? [];
    }

    private static EnableBankingTransaction ToTransaction(TransactionDto t)
    {
        var description = t.RemittanceInformation is { Count: > 0 }
            ? string.Join(" ", t.RemittanceInformation)
            : t.Creditor?.Name ?? t.Debtor?.Name ?? "Transaction";

        var amount = decimal.Parse(t.TransactionAmount.Amount, CultureInfo.InvariantCulture);
        amount = t.CreditDebitIndicator == "DBIT" ? -Math.Abs(amount) : Math.Abs(amount);

        // Not every ASPSP returns transaction_id (PSD2 leaves it optional); fall back to
        // entry_reference, and as a last resort a composite key so dedup still has something stable.
        var id = t.TransactionId ?? t.EntryReference ?? $"{t.BookingDate}:{t.TransactionAmount.Amount}:{description}";

        return new EnableBankingTransaction(id, DateOnly.Parse(t.BookingDate), amount, t.TransactionAmount.Currency, description);
    }
}

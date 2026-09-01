using System.Globalization;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.Extensions.Options;

namespace Spiir.Api.Infrastructure.EnableBanking;

public class EnableBankingClient(
    IHttpClientFactory httpClientFactory,
    IEnableBankingTokenService tokenService,
    IOptions<EnableBankingOptions> options,
    ILogger<EnableBankingClient> logger) : IEnableBankingClient
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
        string accountUid, DateOnly? dateFrom = null, bool longestHistory = false, CancellationToken ct = default)
    {
        var http = AuthenticatedClient();
        var all = new List<EnableBankingTransaction>();
        var skippedUnsettled = 0;

        // Enable Banking pages transactions: a response carries at most one page plus a
        // continuation_key to fetch the next. Reading only the first page silently truncates
        // history — follow the keys until the API stops handing one back.
        string? continuationKey = null;
        do
        {
            var query = new List<string>();
            if (dateFrom.HasValue) query.Add($"date_from={dateFrom.Value:yyyy-MM-dd}");
            // With this strategy the API can legitimately return an empty page alongside a
            // continuation key, so the loop below must keep following keys rather than stopping
            // at the first empty result.
            if (longestHistory) query.Add("strategy=longest");
            if (continuationKey is not null) query.Add($"continuation_key={Uri.EscapeDataString(continuationKey)}");

            var url = $"/accounts/{accountUid}/transactions";
            if (query.Count > 0) url += "?" + string.Join("&", query);

            var response = await http.GetFromJsonAsync<TransactionsResponse>(url, ct);
            if (response is null) break;

            // Only settled entries are imported. A pending entry is provisional: the bank
            // re-issues it as a booked entry once it settles, typically under a different
            // transaction id, so importing both leaves two rows for one statement line —
            // which is exactly what the account holder's own statement doesn't show. Entries
            // the bank never carried out (rejected, cancelled) are dropped for the same reason.
            var booked = response.Transactions.Where(IsBooked).ToList();
            skippedUnsettled += response.Transactions.Count - booked.Count;

            all.AddRange(booked.Select(ToTransaction));
            continuationKey = string.IsNullOrWhiteSpace(response.ContinuationKey) ? null : response.ContinuationKey;

            // Defensive stop: a bank echoing the same key back would otherwise loop forever.
            if (all.Count > 10_000) break;
        } while (continuationKey is not null);

        if (skippedUnsettled > 0)
            logger.LogInformation(
                "Skipped {Count} unsettled entries (pending/rejected) for account {Account}.",
                skippedUnsettled, accountUid);

        return all;
    }

    // Treated as booked when the bank says so, and also when it says nothing at all: a missing
    // status means the ASPSP doesn't report one, and dropping every entry from such a bank would
    // be far worse than the duplicate this guards against.
    private static bool IsBooked(TransactionDto t) =>
        string.IsNullOrWhiteSpace(t.Status)
        || t.Status.Equals("BOOK", StringComparison.OrdinalIgnoreCase);

    private static EnableBankingTransaction ToTransaction(TransactionDto t)
    {
        var description = t.RemittanceInformation is { Count: > 0 }
            ? string.Join(" ", t.RemittanceInformation)
            : t.Creditor?.Name ?? t.Debtor?.Name ?? "Transaction";

        var amount = decimal.Parse(t.TransactionAmount.Amount, CultureInfo.InvariantCulture);
        amount = t.CreditDebitIndicator == "DBIT" ? -Math.Abs(amount) : Math.Abs(amount);

        // booking_date is the settlement date and the one a statement is ordered by. Not every
        // entry carries it, so fall back rather than throwing mid-sync and losing the batch.
        var rawDate = t.BookingDate ?? t.ValueDate ?? t.TransactionDate;
        var date = DateOnly.TryParse(rawDate, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : DateOnly.FromDateTime(DateTime.UtcNow);

        // Not every ASPSP returns transaction_id (PSD2 leaves it optional); fall back to
        // entry_reference, and as a last resort a composite key so dedup still has something
        // stable. The composite is built from the resolved date, not the raw field, so an entry
        // that switches which date field it carries doesn't come back as a second transaction.
        var id = t.TransactionId
                 ?? t.EntryReference
                 ?? $"{date:yyyy-MM-dd}:{t.TransactionAmount.Amount}:{description}";

        return new EnableBankingTransaction(id, date, amount, t.TransactionAmount.Currency, description);
    }
}

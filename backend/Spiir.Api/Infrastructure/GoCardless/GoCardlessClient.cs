using System.Globalization;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.Extensions.Options;

namespace Spiir.Api.Infrastructure.GoCardless;

public class GoCardlessClient(
    IHttpClientFactory httpClientFactory,
    IGoCardlessTokenService tokenService,
    IOptions<GoCardlessOptions> options) : IGoCardlessClient
{
    private async Task<HttpClient> AuthenticatedClientAsync(CancellationToken ct)
    {
        var http = httpClientFactory.CreateClient("GoCardless");
        var token = await tokenService.GetAccessTokenAsync(ct);
        http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return http;
    }

    public async Task<IReadOnlyList<InstitutionDto>> GetInstitutionsAsync(string countryCode, CancellationToken ct = default)
    {
        var http = await AuthenticatedClientAsync(ct);
        return await http.GetFromJsonAsync<List<InstitutionDto>>($"/api/v2/institutions/?country={countryCode}", ct) ?? [];
    }

    public async Task<RequisitionDto> CreateRequisitionAsync(string institutionId, string reference, CancellationToken ct = default)
    {
        var http = await AuthenticatedClientAsync(ct);
        var redirectUrl = options.Value.RedirectUrl;
        var resp = await http.PostAsJsonAsync("/api/v2/requisitions/", new CreateRequisitionRequest(
            redirectUrl, institutionId, reference), ct);
        resp.EnsureSuccessStatusCode();
        return await resp.Content.ReadFromJsonAsync<RequisitionDto>(ct)
               ?? throw new InvalidOperationException("Empty requisition response.");
    }

    public async Task<RequisitionDto> GetRequisitionAsync(string requisitionId, CancellationToken ct = default)
    {
        var http = await AuthenticatedClientAsync(ct);
        return await http.GetFromJsonAsync<RequisitionDto>($"/api/v2/requisitions/{requisitionId}/", ct)
               ?? throw new InvalidOperationException("Requisition not found.");
    }

    public async Task<IReadOnlyList<GoCardlessAccount>> GetAccountsAsync(string requisitionId, CancellationToken ct = default)
    {
        var req = await GetRequisitionAsync(requisitionId, ct);
        if (req.Accounts is null or { Count: 0 })
            return [];

        var accounts = new List<GoCardlessAccount>();
        foreach (var accountId in req.Accounts)
        {
            try
            {
                var http = await AuthenticatedClientAsync(ct);
                var details = await http.GetFromJsonAsync<AccountDetailsResponse>(
                    $"/api/v2/accounts/{accountId}/details/", ct);
                accounts.Add(new GoCardlessAccount(
                    accountId,
                    details?.Account.Iban,
                    details?.Account.Name,
                    details?.Account.Currency ?? "DKK"));
            }
            catch (Exception)
            {
                accounts.Add(new GoCardlessAccount(accountId, null, null, "DKK"));
            }
        }
        return accounts;
    }

    public async Task<IReadOnlyList<GoCardlessTransaction>> GetTransactionsAsync(
        string accountId, DateOnly? dateFrom = null, CancellationToken ct = default)
    {
        var http = await AuthenticatedClientAsync(ct);
        var url = $"/api/v2/accounts/{accountId}/transactions/";
        if (dateFrom.HasValue)
            url += $"?date_from={dateFrom.Value:yyyy-MM-dd}";

        var response = await http.GetFromJsonAsync<TransactionsResponse>(url, ct);
        return response?.Transactions.Booked
               .Select(t => new GoCardlessTransaction(
                   t.TransactionId,
                   DateOnly.Parse(t.BookingDate),
                   decimal.Parse(t.TransactionAmount.Amount, CultureInfo.InvariantCulture),
                   t.TransactionAmount.Currency,
                   t.RemittanceInformationUnstructured ?? t.CreditorName ?? t.DebtorName ?? t.TransactionId))
               .ToList() ?? [];
    }
}

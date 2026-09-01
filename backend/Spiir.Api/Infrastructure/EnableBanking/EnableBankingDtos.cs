using System.Text.Json.Serialization;

namespace Spiir.Api.Infrastructure.EnableBanking;

// ASPSPs (banks)
public record AspspsResponse(
    [property: JsonPropertyName("aspsps")] List<AspspDto> Aspsps);

public record AspspDto(
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("country")] string Country,
    [property: JsonPropertyName("bic")] string? Bic,
    [property: JsonPropertyName("logo")] string? Logo);

// Authorization
public record StartAuthRequest(
    [property: JsonPropertyName("access")] AccessDto Access,
    [property: JsonPropertyName("aspsp")] AspspRefDto Aspsp,
    [property: JsonPropertyName("state")] string State,
    [property: JsonPropertyName("redirect_url")] string RedirectUrl,
    [property: JsonPropertyName("psu_type")] string PsuType);

public record AccessDto(
    [property: JsonPropertyName("valid_until")] string ValidUntil);

public record AspspRefDto(
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("country")] string Country);

public record StartAuthResponse(
    [property: JsonPropertyName("url")] string Url);

// Sessions
public record CreateSessionRequest(
    [property: JsonPropertyName("code")] string Code);

public record SessionResponse(
    [property: JsonPropertyName("session_id")] string SessionId,
    [property: JsonPropertyName("accounts")] List<SessionAccountDto> Accounts);

public record SessionAccountDto(
    [property: JsonPropertyName("uid")] string Uid,
    [property: JsonPropertyName("account_id")] AccountIdDto? AccountId,
    [property: JsonPropertyName("name")] string? Name,
    [property: JsonPropertyName("currency")] string? Currency);

public record AccountIdDto(
    [property: JsonPropertyName("iban")] string? Iban);

// Transactions
public record TransactionsResponse(
    [property: JsonPropertyName("transactions")] List<TransactionDto> Transactions,
    [property: JsonPropertyName("continuation_key")] string? ContinuationKey);

public record TransactionDto(
    [property: JsonPropertyName("transaction_id")] string? TransactionId,
    [property: JsonPropertyName("entry_reference")] string? EntryReference,
    // ISO 20022 entry status: BOOK (settled), PDNG (pending), RJCT/CANC (never happened).
    // Enable Banking's own sync guidance is to work from BOOK entries only: their amount,
    // direction and booking date are stable, whereas a pending entry is re-issued when it
    // settles, often under a different id. Importing both is how one statement line becomes two.
    [property: JsonPropertyName("status")] string? Status,
    // Absent on some entries (notably pending ones, which may carry only a value date), so
    // nullable with a fallback rather than a parse that throws mid-sync.
    [property: JsonPropertyName("booking_date")] string? BookingDate,
    [property: JsonPropertyName("value_date")] string? ValueDate,
    [property: JsonPropertyName("transaction_date")] string? TransactionDate,
    [property: JsonPropertyName("transaction_amount")] AmountDto TransactionAmount,
    [property: JsonPropertyName("credit_debit_indicator")] string? CreditDebitIndicator,
    [property: JsonPropertyName("remittance_information")] List<string>? RemittanceInformation,
    [property: JsonPropertyName("creditor")] PartyDto? Creditor,
    [property: JsonPropertyName("debtor")] PartyDto? Debtor);

public record PartyDto(
    [property: JsonPropertyName("name")] string? Name);

public record AmountDto(
    [property: JsonPropertyName("amount")] string Amount,
    [property: JsonPropertyName("currency")] string Currency);

using System.Text.Json.Serialization;

namespace Spiir.Api.Infrastructure.GoCardless;

// Token
public record TokenResponse(
    [property: JsonPropertyName("access")] string Access,
    [property: JsonPropertyName("access_expires")] int AccessExpires,
    [property: JsonPropertyName("refresh")] string Refresh,
    [property: JsonPropertyName("refresh_expires")] int RefreshExpires);

// Institutions
public record InstitutionDto(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("bic")] string? Bic,
    [property: JsonPropertyName("logo")] string? Logo,
    [property: JsonPropertyName("countries")] List<string>? Countries);

// Requisitions
public record CreateRequisitionRequest(
    [property: JsonPropertyName("redirect")] string Redirect,
    [property: JsonPropertyName("institution_id")] string InstitutionId,
    [property: JsonPropertyName("reference")] string Reference);

public record RequisitionDto(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("link")] string? Link,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("accounts")] List<string>? Accounts,
    [property: JsonPropertyName("reference")] string? Reference);

// Accounts
public record AccountDto(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("iban")] string? Iban,
    [property: JsonPropertyName("institution_id")] string? InstitutionId,
    [property: JsonPropertyName("status")] string? Status);

public record AccountDetailsResponse(
    [property: JsonPropertyName("account")] AccountDetailDto Account);

public record AccountDetailDto(
    [property: JsonPropertyName("iban")] string? Iban,
    [property: JsonPropertyName("currency")] string? Currency,
    [property: JsonPropertyName("name")] string? Name,
    [property: JsonPropertyName("product")] string? Product);

// Transactions
public record TransactionsResponse(
    [property: JsonPropertyName("transactions")] TransactionBuckets Transactions);

public record TransactionBuckets(
    [property: JsonPropertyName("booked")] List<TransactionDto> Booked,
    [property: JsonPropertyName("pending")] List<TransactionDto>? Pending);

public record TransactionDto(
    [property: JsonPropertyName("transactionId")] string TransactionId,
    [property: JsonPropertyName("bookingDate")] string BookingDate,
    [property: JsonPropertyName("transactionAmount")] AmountDto TransactionAmount,
    [property: JsonPropertyName("remittanceInformationUnstructured")] string? RemittanceInformationUnstructured,
    [property: JsonPropertyName("creditorName")] string? CreditorName,
    [property: JsonPropertyName("debtorName")] string? DebtorName);

public record AmountDto(
    [property: JsonPropertyName("amount")] string Amount,
    [property: JsonPropertyName("currency")] string Currency);

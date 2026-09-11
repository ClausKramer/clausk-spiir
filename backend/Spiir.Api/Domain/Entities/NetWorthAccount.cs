namespace Spiir.Api.Domain.Entities;

public class NetWorthAccount
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public string Name { get; set; } = "";
    public string Kind { get; set; } = NetWorthKind.Savings;
    public bool IsLiability { get; set; }
    public string Currency { get; set; } = "DKK";
    /// <summary>Optional link to a synced account, used only to suggest a figure when recording.</summary>
    public Guid? BankAccountId { get; set; }
    public bool IsArchived { get; set; }
    public int SortOrder { get; set; }
    public DateTime CreatedAt { get; set; }
}

// What kind of thing the account is. This is the "category" the progress view groups by: it is
// what makes "are the loans going down and the investments up" answerable, which a single net
// figure never is — net worth can rise while debt also rises, and that is worth seeing.
public static class NetWorthKind
{
    // Owned
    public const string Cash = "Cash";
    public const string Savings = "Savings";
    public const string Investment = "Investment";
    public const string Pension = "Pension";
    public const string Property = "Property";
    public const string OtherAsset = "OtherAsset";

    // Owed
    public const string Mortgage = "Mortgage";
    public const string Loan = "Loan";
    public const string Credit = "Credit";

    public static readonly string[] Assets = [Cash, Savings, Investment, Pension, Property, OtherAsset];
    public static readonly string[] Liabilities = [Mortgage, Loan, Credit];
    public static readonly string[] All = [.. Assets, .. Liabilities];

    public static bool IsKnown(string kind) => All.Contains(kind, StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// Whether this kind is normally a debt. Grouping and presentation only — it does not
    /// decide the sign of anything. Net worth is the plain sum of the recorded values.
    /// </summary>
    public static bool IsLiabilityKind(string kind) =>
        Liabilities.Contains(kind, StringComparer.OrdinalIgnoreCase);
}

public class NetWorthSnapshot
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public Guid NetWorthAccountId { get; set; }
    public int PeriodYear { get; set; }
    public int PeriodMonth { get; set; }
    /// <summary>
    /// The balance as it stands, signed, whatever kind of account it is: positive for money
    /// held, negative for money owed. Never normalised — an account is not permanently one side
    /// of the balance, and forcing a sign would stop the data expressing the cases the
    /// classification didn't anticipate (an overdrawn current account, an overpaid loan, a
    /// prioritetskonto sitting in credit).
    /// </summary>
    public decimal Value { get; set; }
    public string? Note { get; set; }
    public DateTime RecordedAt { get; set; }
}

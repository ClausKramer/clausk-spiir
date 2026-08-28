using System.Text.RegularExpressions;

namespace Spiir.Api.Features.Categorization;

// Raw bank descriptions carry a lot of per-transaction noise around the merchant name —
// "NETTO 1234 KØBENHAVN K DK 04.11" is the same merchant as "NETTO 5678 AARHUS C DK 12.03".
// Reducing both to "NETTO" makes rules match more reliably, lets learned rules generalize across
// stores/dates, and gives the Claude fallback a much cleaner signal (plus a cache key that
// actually repeats). Deliberately conservative: it strips patterns that are clearly not part of a
// name, and leaves anything ambiguous alone.
public static partial class MerchantNormalizer
{
    public static string Normalize(string description)
    {
        if (string.IsNullOrWhiteSpace(description)) return "";

        var s = description.Trim();

        // Danske Bank card entries pack merchant and location into backslash-delimited fields
        // ("MCDVIBYMEGASYD\ \VIBYJ\", "NYX*WeArePadelOdderApS\ \Od..."), where only the first
        // field is the merchant. Keep that and drop the rest.
        var firstBackslash = s.IndexOf('\\');
        if (firstBackslash > 0) s = s[..firstBackslash];

        // Danish bank prefixes for the payment mechanism, not the merchant:
        // "Bs" = Betalingsservice (direct debit), "Dankort-nota", "Visa/Dankort", "Køb" = purchase.
        s = LeadingPaymentPrefix().Replace(s, "");

        s = MaskedCardNumber().Replace(s, " ");   // 1234******5678, xxxx1234
        s = DateLike().Replace(s, " ");           // 04.11, 04-11-2026, 2026-11-04
        s = LongDigitRun().Replace(s, " ");       // store/terminal/reference ids (4+ digits)
        s = TrailingCountryCode().Replace(s, ""); // " DK", " SE" at the end
        s = Whitespace().Replace(s, " ").Trim(' ', '-', ',', '.', '*', '/');

        // Everything was noise (e.g. a bare reference number) — the original is more useful to a
        // human, and to Claude, than an empty string.
        return s.Length == 0 ? description.Trim() : s;
    }

    // The pattern to store when learning a rule from a manual correction. Normalization alone
    // isn't enough to generalize: "NETTO 1234 KØBENHAVN K" and "NETTO 5678 AARHUS C" normalize to
    // different strings (the city survives), so a rule learned at one store would miss the same
    // chain elsewhere. The leading token is almost always the brand, and since rules match by
    // substring, keying on it makes one correction cover every branch.
    //
    // Two cases keep a second token instead: a very short leading token is usually an abbreviation
    // that needs its neighbour to mean anything ("H&M ...", "7-ELEVEN ..."), and a generic
    // category word is not a brand at all — keying "Cafe Nord" on "Cafe" would swallow every
    // unrelated café. Beyond those, the tradeoff favours generalizing: an over-broad learned rule
    // is visible and fixable by recategorizing again, while an over-specific one silently never
    // fires.
    public static string MerchantKey(string description)
    {
        var normalized = Normalize(description);
        var tokens = normalized.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (tokens.Length <= 1) return normalized;

        var takeTwo = tokens[0].Length < 4 || GenericLeadingWords.Contains(tokens[0]);
        return takeTwo ? $"{tokens[0]} {tokens[1]}" : tokens[0];
    }

    private static readonly HashSet<string> GenericLeadingWords = new(StringComparer.OrdinalIgnoreCase)
    {
        "cafe", "café", "restaurant", "hotel", "kiosk", "butik", "shop", "store", "bar", "pub",
        "apotek", "bageri", "pizzeria", "grill", "salon", "klinik", "unknown", "diverse",
    };

    [GeneratedRegex(@"^\s*(bs|betalingsservice|dankort-?nota|visa/?dankort|visa|dankort|køb|kob|overførsel|ovf\.?)\s+",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex LeadingPaymentPrefix();

    [GeneratedRegex(@"\b[\dxX*]{4,}[*x]{2,}[\dxX*]*\b|\b[xX*]{2,}\d{2,4}\b", RegexOptions.CultureInvariant)]
    private static partial Regex MaskedCardNumber();

    [GeneratedRegex(@"\b\d{1,2}[./-]\d{1,2}([./-]\d{2,4})?\b|\b\d{4}-\d{2}-\d{2}\b", RegexOptions.CultureInvariant)]
    private static partial Regex DateLike();

    [GeneratedRegex(@"\b\d{4,}\b", RegexOptions.CultureInvariant)]
    private static partial Regex LongDigitRun();

    [GeneratedRegex(@"\s+(DK|SE|NO|DE|GB|US|NL|FI)\s*$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex TrailingCountryCode();

    [GeneratedRegex(@"\s{2,}", RegexOptions.CultureInvariant)]
    private static partial Regex Whitespace();
}

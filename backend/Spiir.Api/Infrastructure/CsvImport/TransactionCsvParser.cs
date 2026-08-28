using System.Globalization;
using System.Text;

namespace Spiir.Api.Infrastructure.CsvImport;

public record ParsedCsvRow(DateOnly BookingDate, decimal Amount, string Description, string? CategoryName);
public record CsvParseResult(List<ParsedCsvRow> Rows, List<string> Errors);

// Bank CSV exports vary a lot (delimiter, decimal separator, date format, column names). Rather
// than trying to auto-detect a specific bank's format, this expects a header row naming Date/
// Description/Amount columns (with common Danish/English aliases) and is forgiving about
// delimiter, decimal separator, and date format within that.
public static class TransactionCsvParser
{
    private static readonly string[] DateColumnNames = ["date", "dato", "bookingdate", "posting date", "value date"];
    private static readonly string[] DescriptionColumnNames = ["description", "tekst", "text", "beskrivelse", "besked", "message"];
    private static readonly string[] AmountColumnNames = ["amount", "beløb", "belob", "value"];
    private static readonly string[] CategoryColumnNames = ["category", "kategori"];

    private static readonly string[] DateFormats =
        ["yyyy-MM-dd", "dd-MM-yyyy", "dd.MM.yyyy", "dd/MM/yyyy", "MM/dd/yyyy", "yyyy/MM/dd"];

    public static CsvParseResult Parse(string content)
    {
        var errors = new List<string>();
        var rows = new List<ParsedCsvRow>();

        var lines = content.Split('\n').Select(l => l.TrimEnd('\r')).Where(l => l.Length > 0).ToList();
        if (lines.Count == 0)
        {
            errors.Add("File is empty.");
            return new CsvParseResult(rows, errors);
        }

        // Danish bank exports commonly use ';' since ',' is the decimal separator there.
        var delimiter = lines[0].Count(c => c == ';') > lines[0].Count(c => c == ',') ? ';' : ',';
        var header = SplitLine(lines[0], delimiter).Select(h => h.Trim().ToLowerInvariant()).ToList();

        var dateIdx = FindColumn(header, DateColumnNames);
        var descIdx = FindColumn(header, DescriptionColumnNames);
        var amountIdx = FindColumn(header, AmountColumnNames);
        var categoryIdx = FindColumn(header, CategoryColumnNames);

        if (dateIdx < 0 || descIdx < 0 || amountIdx < 0)
        {
            errors.Add("Could not find Date, Description, and Amount columns in the header row. " +
                       "Expected a first row with columns named e.g. 'Date, Description, Amount'.");
            return new CsvParseResult(rows, errors);
        }

        for (var i = 1; i < lines.Count; i++)
        {
            var lineNo = i + 1;
            var fields = SplitLine(lines[i], delimiter);
            var maxIdx = Math.Max(dateIdx, Math.Max(descIdx, amountIdx));
            if (fields.Count <= maxIdx)
            {
                errors.Add($"Line {lineNo}: not enough columns, skipped.");
                continue;
            }

            if (!TryParseDate(fields[dateIdx].Trim(), out var date))
            {
                errors.Add($"Line {lineNo}: could not parse date '{fields[dateIdx]}', skipped.");
                continue;
            }

            if (!TryParseAmount(fields[amountIdx].Trim(), out var amount))
            {
                errors.Add($"Line {lineNo}: could not parse amount '{fields[amountIdx]}', skipped.");
                continue;
            }

            var description = fields[descIdx].Trim();
            if (description.Length == 0) description = "Imported transaction";

            var category = categoryIdx >= 0 && categoryIdx < fields.Count ? fields[categoryIdx].Trim() : null;

            rows.Add(new ParsedCsvRow(date, amount, description, string.IsNullOrWhiteSpace(category) ? null : category));
        }

        return new CsvParseResult(rows, errors);
    }

    private static int FindColumn(List<string> header, string[] candidates) =>
        header.FindIndex(h => candidates.Contains(h, StringComparer.OrdinalIgnoreCase));

    private static List<string> SplitLine(string line, char delimiter)
    {
        var fields = new List<string>();
        var sb = new StringBuilder();
        var inQuotes = false;

        for (var i = 0; i < line.Length; i++)
        {
            var c = line[i];
            if (inQuotes)
            {
                if (c == '"')
                {
                    if (i + 1 < line.Length && line[i + 1] == '"') { sb.Append('"'); i++; }
                    else inQuotes = false;
                }
                else sb.Append(c);
            }
            else if (c == '"')
            {
                inQuotes = true;
            }
            else if (c == delimiter)
            {
                fields.Add(sb.ToString());
                sb.Clear();
            }
            else
            {
                sb.Append(c);
            }
        }
        fields.Add(sb.ToString());
        return fields;
    }

    private static bool TryParseDate(string raw, out DateOnly date)
    {
        foreach (var format in DateFormats)
        {
            if (DateOnly.TryParseExact(raw, format, CultureInfo.InvariantCulture, DateTimeStyles.None, out date))
                return true;
        }
        return DateOnly.TryParse(raw, CultureInfo.InvariantCulture, DateTimeStyles.None, out date)
            || DateOnly.TryParse(raw, CultureInfo.CurrentCulture, DateTimeStyles.None, out date);
    }

    private static bool TryParseAmount(string raw, out decimal amount)
    {
        amount = 0;
        if (string.IsNullOrWhiteSpace(raw)) return false;

        raw = raw.Replace(" ", "")
            .Replace("kr", "", StringComparison.OrdinalIgnoreCase)
            .Replace("dkk", "", StringComparison.OrdinalIgnoreCase)
            .Trim();

        // Whichever of ',' or '.' appears last is the decimal separator; the other, if present
        // earlier, is a thousands separator to strip (handles both "1.234,56" and "1,234.56").
        var lastComma = raw.LastIndexOf(',');
        var lastDot = raw.LastIndexOf('.');

        var normalized = lastComma > lastDot
            ? raw.Replace(".", "").Replace(",", ".")
            : raw.Replace(",", "");

        return decimal.TryParse(normalized, NumberStyles.Number | NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out amount);
    }
}

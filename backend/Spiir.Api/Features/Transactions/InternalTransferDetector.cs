using Spiir.Api.Data.Repositories;

namespace Spiir.Api.Features.Transactions;

// Identifies transactions that are two legs of the same movement between the user's own accounts.
// Enable Banking gives no link between them — each account's feed is independent — so they're
// matched heuristically: equal and opposite amounts, different accounts, within a few days (banks
// don't always settle both legs same-day).
//
// Pairing is one-to-one. An earlier version asked only "does any opposite-amount transaction
// exist?", which over-excluded badly on repeating amounts: three −100 payments and a single +100
// counterpart made all three vanish from income and expense. Only a genuinely matched pair nets
// to zero, so only a matched pair should drop out of the totals.
public static class InternalTransferDetector
{
    private const int MaxSettlementDays = 3;

    /// <summary>
    /// Returns the ids of transactions that pair off against another transaction in the same set.
    /// Callers pass exactly the transactions in view — a transfer only nets to zero when both legs
    /// are included, so with one account selected its counterpart is real income or spending.
    /// </summary>
    public static HashSet<Guid> FindPairedIds(IReadOnlyList<TransactionListItem> transactions)
    {
        var paired = new HashSet<Guid>();

        // Only equal-and-opposite amounts can pair, so bucket by magnitude first — this keeps the
        // comparison local instead of quadratic over everything.
        foreach (var group in transactions.GroupBy(t => Math.Abs(t.Amount)))
        {
            if (group.Key == 0) continue;

            var outgoing = group.Where(t => t.Amount < 0).OrderBy(t => t.BookingDate).ToList();
            var incoming = group.Where(t => t.Amount > 0).OrderBy(t => t.BookingDate).ToList();
            if (outgoing.Count == 0 || incoming.Count == 0) continue;

            var takenIncoming = new bool[incoming.Count];

            foreach (var sent in outgoing)
            {
                for (var i = 0; i < incoming.Count; i++)
                {
                    if (takenIncoming[i]) continue;

                    var received = incoming[i];
                    if (received.BankAccountId == sent.BankAccountId) continue;
                    if (Math.Abs(received.BookingDate.DayNumber - sent.BookingDate.DayNumber) > MaxSettlementDays) continue;

                    takenIncoming[i] = true;
                    paired.Add(sent.Id);
                    paired.Add(received.Id);
                    break;
                }
            }
        }

        return paired;
    }
}

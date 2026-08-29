import { useQuery } from '@tanstack/react-query'
import { getTransactionsByCategory, type Period } from '../api/transactions'
import { CategoryPicker } from './CategoryPicker'

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

interface Props {
  categoryId: string | null
  categoryLabel: string
  accountIds: string[]
  period: Period
  accountNameById: Map<string, string>
  onClose: () => void
}

const dkk = (n: number) => n.toLocaleString('da-DK', { style: 'currency', currency: 'DKK' })

// Drill-down behind one bar of the dashboard's category breakdown. Takes the dashboard's own
// account filter and period so the rows shown reconcile with the total that was clicked.
export function CategoryTransactionsDialog({
  categoryId,
  categoryLabel,
  accountIds,
  period,
  accountNameById,
  onClose,
}: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['by-category', categoryId, accountIds, period],
    queryFn: () => getTransactionsByCategory(categoryId, accountIds, period),
  })

  const periodLabel = period.month === null
    ? String(period.year)
    : `${MONTH_NAMES[period.month - 1]} ${period.year}`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-3xl max-h-[85vh] flex flex-col rounded-xl border border-[#232b3b] bg-[#1a1f2e] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[#232b3b] px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">{categoryLabel}</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {data
                ? `${data.items.length} transaction${data.items.length === 1 ? '' : 's'} · ${dkk(data.total)} · ${periodLabel}`
                : 'Loading…'}
            </p>
          </div>
          <button onClick={onClose} className="shrink-0 text-slate-600 hover:text-slate-300" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-2">
          {isLoading ? (
            <div className="flex justify-center py-10">
              <div className="h-6 w-6 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
            </div>
          ) : !data || data.items.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-600">No transactions in this category.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[0.68rem] uppercase tracking-wider text-slate-600 border-b border-[#232b3b]">
                  <th className="py-2 pr-3 font-medium">Date</th>
                  <th className="py-2 pr-3 font-medium">Description</th>
                  <th className="py-2 pr-3 font-medium">Account</th>
                  <th className="py-2 pr-3 font-medium">Category</th>
                  <th className="py-2 pl-3 font-medium text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((tx) => (
                  <tr key={tx.id} className="border-b border-[#1e2535] last:border-none hover:bg-white/[0.02]">
                    <td className="py-2 pr-3 whitespace-nowrap text-slate-500">{tx.bookingDate}</td>
                    <td className="py-2 pr-3 text-slate-300">{tx.description}</td>
                    <td className="py-2 pr-3 whitespace-nowrap text-slate-500">
                      {accountNameById.get(tx.bankAccountId) ?? '—'}
                    </td>
                    <td className="py-2 pr-3">
                      <CategoryPicker
                        dark
                        transactionId={tx.id}
                        categoryId={tx.categoryId}
                        categoryName={tx.categoryName}
                        categoryEmoji={tx.categoryEmoji}
                      />
                    </td>
                    <td className="py-2 pl-3 text-right font-semibold tabular-nums text-red-400">
                      {tx.amount.toLocaleString('da-DK', { style: 'currency', currency: tx.currency })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

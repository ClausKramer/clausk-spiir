import { useQuery } from '@tanstack/react-query'
import { getMonthlySummary } from '../api/transactions'

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const BAR_COLORS = [
  'bg-indigo-500', 'bg-violet-500', 'bg-sky-500', 'bg-emerald-500',
  'bg-amber-500', 'bg-rose-500', 'bg-teal-500', 'bg-orange-500',
]

export function SpendingChart() {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1

  const { data, isLoading } = useQuery({
    queryKey: ['transactions', 'summary', year, month],
    queryFn: () => getMonthlySummary(year, month),
  })

  const rows = data?.categories.filter((r) => r.total > 0).slice(0, 8) ?? []
  const max = rows.length > 0 ? Math.max(...rows.map((r) => r.total)) : 1
  const totalSpend = rows.reduce((s, r) => s + r.total, 0)

  return (
    <div className="rounded-xl bg-white shadow-sm border border-slate-100">
      <div className="border-b border-slate-100 px-6 py-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-800">
          Spending — {MONTH_NAMES[month - 1]} {year}
        </h2>
        {totalSpend > 0 && (
          <span className="text-sm text-slate-500">
            {totalSpend.toLocaleString('da-DK', { style: 'currency', currency: 'DKK' })} total
          </span>
        )}
      </div>

      <div className="px-6 py-5">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-center text-sm text-slate-400 py-8">No spending data for this month.</p>
        ) : (
          <div className="space-y-3">
            {rows.map((row, i) => (
              <div key={row.categoryId ?? 'uncategorized'}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-slate-700">
                    {row.categoryEmoji && <span className="mr-1.5">{row.categoryEmoji}</span>}
                    {row.categoryName ?? 'Uncategorized'}
                  </span>
                  <span className="text-sm font-medium text-slate-700 tabular-nums">
                    {row.total.toLocaleString('da-DK', { style: 'currency', currency: 'DKK' })}
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-slate-100">
                  <div
                    className={`h-2 rounded-full ${BAR_COLORS[i % BAR_COLORS.length]} transition-all duration-500`}
                    style={{ width: `${(row.total / max) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

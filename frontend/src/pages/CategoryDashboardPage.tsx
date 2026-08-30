import { useQuery } from '@tanstack/react-query'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { getTransactionsByCategory, type Period } from '../api/transactions'
import { getBankAccounts } from '../api/accounts'
import { getCategories } from '../api/categories'
import { CategoryPicker } from '../components/CategoryPicker'

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Single series, so no legend and no categorical palette — the bars encode magnitude by length,
// and one hue carries it. This is the same expense red used across the app, at the darker step
// validated for this dark surface.
const SPEND = '#dc2626'

const kr = (n: number) =>
  n.toLocaleString('da-DK', { style: 'currency', currency: 'DKK', maximumFractionDigits: 0 })

// The route encodes "no category" as a word rather than an empty segment, so the URL stays
// readable and the uncategorized case is a first-class destination.
export const UNCATEGORIZED = 'uncategorized'

export function CategoryDashboardPage() {
  const { categoryId: routeId } = useParams<{ categoryId: string }>()
  const [search] = useSearchParams()

  const categoryId = routeId === UNCATEGORIZED ? null : (routeId ?? null)
  const accountIds = search.getAll('accountIds')
  const period: Period = {
    year: Number(search.get('year')) || new Date().getFullYear(),
    month: search.get('month') ? Number(search.get('month')) : null,
  }
  const periodLabel = period.month === null ? String(period.year) : `${MONTH_NAMES[period.month - 1]} ${period.year}`

  const { data: accounts = [] } = useQuery({ queryKey: ['accounts'], queryFn: getBankAccounts })
  const { data: categories = [] } = useQuery({ queryKey: ['categories'], queryFn: getCategories })
  const accountNameById = new Map(accounts.map((a) => [a.id, a.name]))

  const { data, isLoading } = useQuery({
    queryKey: ['by-category', categoryId, accountIds, period],
    queryFn: () => getTransactionsByCategory(categoryId, accountIds, period),
  })

  const category = categories.find((c) => c.id === categoryId)
  const title = categoryId === null ? '— Uncategorized' : `${category?.emoji ?? ''} ${category?.name ?? 'Category'}`.trim()

  // Preserve the dashboard's filters when going back, so the user returns to the view they left.
  const backTo = `/dashboard`

  const maxMonth = Math.max(...(data?.monthlyTotals.map((m) => m.total) ?? [0]), 1)
  const maxMerchant = Math.max(...(data?.merchants.map((m) => m.total) ?? [0]), 1)
  const recurringShare = data && data.total > 0 ? data.stats.recurringTotal / data.total : 0

  return (
    <div className="min-h-screen bg-[#0f1117] px-4 py-6 text-slate-200 md:px-8 md:py-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link to={backTo} className="text-xs text-slate-500 hover:text-slate-300">← Dashboard</Link>
            <h1 className="mt-1 text-xl font-bold text-slate-50">{title}</h1>
            <p className="mt-0.5 text-xs text-slate-500">
              {periodLabel}
              {accountIds.length > 0 && <> &nbsp;·&nbsp; {accountIds.length} of {accounts.length} accounts</>}
            </p>
          </div>
          {data && <div className="text-right text-2xl font-bold tabular-nums text-red-400">{kr(data.total)}</div>}
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
          </div>
        ) : !data || data.stats.transactionCount === 0 ? (
          <div className="rounded-xl border border-[#232b3b] bg-[#1a1f2e] py-16 text-center">
            <div className="mb-2 text-3xl">🗂️</div>
            <p className="text-slate-400">Nothing spent in this category for {periodLabel}.</p>
          </div>
        ) : (
          <>
            <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Kpi label="Per month" value={kr(data.stats.averagePerMonth)} sub={`over ${data.stats.monthsWithData} month${data.stats.monthsWithData === 1 ? '' : 's'} with activity`} />
              <Kpi label="Share of all spending" value={`${(data.stats.shareOfSpending * 100).toFixed(1)}%`} />
              <Kpi label="Transactions" value={String(data.stats.transactionCount)} sub={`${kr(data.stats.averageTransaction)} average`} />
              <Kpi label="Largest single" value={kr(data.stats.largest)} />
            </div>

            {/* Recurring vs one-off: the most actionable split in a category — standing costs are
                what you can renegotiate or cancel, one-offs mostly aren't. */}
            {recurringShare > 0 && (
              <Panel title="🔁 Recurring vs one-off">
                {/* Segments are rendered only when they have width. At 100% recurring, a
                    flex-1 sibling would still claim a sliver and imply a one-off share that
                    isn't there. */}
                <div className="flex h-6 overflow-hidden rounded">
                  {recurringShare > 0 && (
                    <div
                      className="flex items-center justify-center bg-[#dc2626] text-[0.65rem] font-semibold text-white/90"
                      style={{ width: `${recurringShare * 100}%` }}
                    >
                      {recurringShare > 0.12 && `${Math.round(recurringShare * 100)}%`}
                    </div>
                  )}
                  {recurringShare > 0 && recurringShare < 1 && <div className="w-0.5 shrink-0 bg-[#1a1f2e]" />}
                  {recurringShare < 1 && (
                    <div
                      className="flex items-center justify-center bg-[#7c2d12] text-[0.65rem] font-semibold text-white/90"
                      style={{ width: `${(1 - recurringShare) * 100}%` }}
                    >
                      {1 - recurringShare > 0.12 && `${Math.round((1 - recurringShare) * 100)}%`}
                    </div>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap justify-center gap-4 text-xs text-slate-400">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm bg-[#dc2626]" />
                    Recurring {kr(data.stats.recurringTotal)}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm bg-[#7c2d12]" />
                    One-off {kr(data.total - data.stats.recurringTotal)}
                  </span>
                </div>
                <p className="mt-2 text-center text-[0.68rem] text-slate-600">
                  Recurring = seen in most months of this period. Useful for spotting standing costs.
                </p>
              </Panel>
            )}

            {data.monthlyTotals.length > 1 && (
              <Panel title={`📅 Spend per month — ${periodLabel}`}>
                {/* Plot area and labels are separate rows sharing the same flex layout. The plot
                    row carries a definite height so the bars' percentage heights have something
                    to resolve against — nesting them under an items-end container sizes each
                    column to its content instead, and the percentages silently collapse. */}
                <div className="flex items-stretch gap-1.5" style={{ height: 132 }}>
                  {data.monthlyTotals.map((m) => (
                    <div
                      key={`${m.year}-${m.month}`}
                      className="group relative flex h-full flex-1 flex-col justify-end"
                      title={`${MONTH_NAMES[m.month - 1]}: ${kr(m.total)}`}
                    >
                      <span className="absolute inset-x-0 -top-1 text-center text-[0.6rem] tabular-nums text-slate-400 opacity-0 transition-opacity group-hover:opacity-100">
                        {m.total > 0 ? Math.round(m.total).toLocaleString('da-DK') : ''}
                      </span>
                      <div
                        className="w-full rounded-t"
                        style={{
                          height: `${(m.total / maxMonth) * 100}%`,
                          minHeight: m.total > 0 ? 2 : 0,
                          background: SPEND,
                        }}
                      />
                    </div>
                  ))}
                </div>
                <div className="mt-1.5 flex gap-1.5">
                  {data.monthlyTotals.map((m) => (
                    <div key={`l-${m.year}-${m.month}`} className="flex-1 text-center text-[0.6rem] text-slate-600">
                      {MONTH_NAMES[m.month - 1]}
                    </div>
                  ))}
                </div>
              </Panel>
            )}

            <Panel title="🏬 Where it goes">
              <div className="space-y-1.5">
                {data.merchants.slice(0, 12).map((m) => (
                  <div key={m.merchant} className="flex items-center gap-2.5">
                    <div className="w-40 shrink-0 truncate text-right text-xs text-slate-400" title={m.merchant}>
                      {m.merchant}
                      {m.isRecurring && <span className="ml-1 text-[0.6rem] text-amber-500" title="Appears in most months of this period">🔁</span>}
                    </div>
                    <div className="h-[22px] flex-1 overflow-hidden rounded bg-[#1e2535]">
                      <div className="flex h-full items-center rounded px-2.5" style={{ width: `${Math.max((m.total / maxMerchant) * 100, 10)}%`, background: SPEND }}>
                        <span className="whitespace-nowrap text-[0.7rem] font-semibold text-white/90">{kr(m.total)}</span>
                      </div>
                    </div>
                    <div className="w-28 shrink-0 text-right text-[0.7rem] tabular-nums text-slate-500">
                      {m.count}× · {kr(m.average)}
                    </div>
                  </div>
                ))}
                {data.merchants.length > 12 && (
                  <p className="pt-1 text-center text-xs text-slate-600">…and {data.merchants.length - 12} more</p>
                )}
              </div>
            </Panel>

            {data.byAccount.length > 1 && (
              <Panel title="🏦 By account">
                <div className="flex flex-wrap gap-2">
                  {data.byAccount.map((a) => (
                    <div key={a.bankAccountId} className="rounded-lg border border-[#1e2535] bg-[#111620] px-3 py-2">
                      <div className="text-[0.68rem] text-slate-500">{accountNameById.get(a.bankAccountId) ?? 'Unknown account'}</div>
                      <div className="mt-0.5 text-sm font-semibold tabular-nums text-slate-200">{kr(a.total)}</div>
                      <div className="text-[0.62rem] text-slate-600">{a.count} transactions</div>
                    </div>
                  ))}
                </div>
              </Panel>
            )}

            <Panel title="📋 Transactions">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#232b3b] text-left text-[0.68rem] uppercase tracking-wider text-slate-600">
                      <th className="py-2 pr-3 font-medium">Date</th>
                      <th className="py-2 pr-3 font-medium">Description</th>
                      <th className="py-2 pr-3 font-medium">Account</th>
                      <th className="py-2 pr-3 font-medium">Category</th>
                      <th className="py-2 pl-3 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((tx) => (
                      <tr key={tx.id} className="border-b border-[#1e2535] last:border-none hover:bg-white/[0.02]">
                        <td className="py-2 pr-3 whitespace-nowrap text-slate-500">{tx.bookingDate}</td>
                        <td className="py-2 pr-3 text-slate-300">{tx.description}</td>
                        <td className="py-2 pr-3 whitespace-nowrap text-slate-500">{accountNameById.get(tx.bankAccountId) ?? '—'}</td>
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
              </div>
            </Panel>
          </>
        )}
      </div>
    </div>
  )
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-[#232b3b] bg-[#1a1f2e] px-4 py-3.5">
      <div className="mb-1.5 text-[0.68rem] uppercase tracking-wider text-slate-600">{label}</div>
      <div className="text-xl font-bold tabular-nums text-slate-100">{value}</div>
      {sub && <div className="mt-1 text-[0.68rem] text-slate-600">{sub}</div>}
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5 rounded-xl border border-[#232b3b] bg-[#1a1f2e] p-4 md:p-5">
      <div className="mb-4 text-[0.7rem] font-bold uppercase tracking-wider text-slate-600">{title}</div>
      {children}
    </div>
  )
}

import { useQuery } from '@tanstack/react-query'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { getFlowBreakdown, type FlowDirection, type Period, type TransactionQuery } from '../api/transactions'
import { getBankAccounts } from '../api/accounts'
import { CategoryPicker } from '../components/CategoryPicker'
import { TagEditor } from '../components/TagEditor'
import { MONTH_NAMES, periodLabel, readPeriod, currentMonth } from '../lib/period'
import { drillTo, dashboardLink } from '../lib/drill'

// Same steps the cash flow chart uses, and validated with it against this surface. Income and
// expenses never appear together on this page — it is one direction at a time — so the accent
// carries which side you're looking at without any risk of the pair being compared.
const INCOME = '#059669'
const EXPENSE = '#dc2626'

const kr = (n: number) =>
  n.toLocaleString('da-DK', { style: 'currency', currency: 'DKK', maximumFractionDigits: 0 })

export function FlowDashboardPage() {
  const { direction: routeDirection } = useParams<{ direction: string }>()
  const [search] = useSearchParams()

  const direction: FlowDirection = routeDirection === 'income' ? 'income' : 'expense'
  const isIncome = direction === 'income'
  const accent = isIncome ? INCOME : EXPENSE

  const accountIds = search.getAll('accountIds')
  const period: Period = readPeriod(search) ?? currentMonth()
  const label = periodLabel(period)

  const { data: accounts = [] } = useQuery({ queryKey: ['accounts'], queryFn: getBankAccounts })
  const accountNameById = new Map(accounts.map((a) => [a.id, a.name]))

  const { data, isLoading } = useQuery({
    queryKey: ['by-flow', direction, accountIds, period],
    queryFn: () => getFlowBreakdown(direction, accountIds, period),
  })

  // Every figure here keeps the page's own direction, so a merchant or tag total means "of this
  // month's income" (or spending) — the same thing the number on screen counts.
  const drill = (text: string, query: TransactionQuery, accountOverride?: string[]) =>
    drillTo(text, { ...query, direction }, accountOverride ?? accountIds, period, {
      measure: isIncome ? 'inflow' : 'outflow',
    })

  const maxCategory = Math.max(...(data?.byCategory.map((c) => c.total) ?? [0]), 1)
  const maxSource = Math.max(...(data?.bySource.map((s) => s.total) ?? [0]), 1)
  const maxMonth = Math.max(...(data?.monthlyTotals.map((m) => m.total) ?? [0]), 1)

  // How this period compares to a typical one. Null when there's only a single month on record,
  // where there is no "typical" yet.
  const average = data?.stats.periodAverage ?? null
  const vsAverage = average && average > 0 && data ? data.total / average - 1 : null

  return (
    <div className="min-h-screen bg-[#0f1117] px-4 py-6 text-slate-200 md:px-8 md:py-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link to={dashboardLink(accountIds, period)} className="text-xs text-slate-500 hover:text-slate-300">
              ← Dashboard
            </Link>
            <h1 className="mt-1 flex items-center gap-2 text-xl font-bold text-slate-50">
              <span className="h-3 w-3 rounded-sm" style={{ background: accent }} />
              {isIncome ? 'Income' : 'Expenses'}
            </h1>
            <p className="mt-0.5 text-xs text-slate-500">
              {label}
              {accountIds.length > 0 && ` · ${accountIds.length} of ${accounts.length} accounts`}
            </p>
          </div>
          {data && (
            <div className="text-right">
              <div className="text-2xl font-bold tabular-nums" style={{ color: accent }}>
                {kr(data.total)}
              </div>
              {vsAverage !== null && Math.abs(vsAverage) >= 0.005 && (
                <div className="text-[0.7rem] text-slate-500">
                  {vsAverage > 0 ? '▲' : '▼'} {Math.abs(vsAverage * 100).toFixed(0)}% vs. the{' '}
                  {kr(average!)} monthly average
                </div>
              )}
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="flex justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
          </div>
        ) : !data || data.items.length === 0 ? (
          <Panel title="Nothing here">
            <p className="py-6 text-center text-sm text-slate-500">
              No {isIncome ? 'money in' : 'money out'} for {label}.
            </p>
          </Panel>
        ) : (
          <>
            <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Kpi label="Total" value={kr(data.total)} accent={accent} />
              <Kpi label="Transactions" value={String(data.stats.transactionCount)} />
              <Kpi label="Average each" value={kr(data.stats.average)} />
              <Kpi label="Largest single" value={kr(data.stats.largest)} />
            </div>

            {data.monthlyTotals.length > 1 && (
              <Panel title={`📅 ${isIncome ? 'Income' : 'Spending'} per month`}>
                <div className="flex h-40 items-end gap-1.5">
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
                          minHeight: m.total !== 0 ? 2 : 0,
                          background: accent,
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

            <Panel title={`🗂️ By category`}>
              <div className="space-y-1.5">
                {data.byCategory.map((c) => {
                  const row = (
                    <>
                      <div className="w-40 shrink-0 truncate text-right text-xs text-slate-400">
                        {c.emoji && <span className="mr-1">{c.emoji}</span>}
                        {c.name ?? 'Uncategorized'}
                      </div>
                      <div className="h-[22px] flex-1 overflow-hidden rounded bg-[#1e2535]">
                        <div
                          className="flex h-full items-center rounded px-2.5"
                          style={{ width: `${Math.max((c.total / maxCategory) * 100, 10)}%`, background: accent }}
                        >
                          <span className="whitespace-nowrap text-[0.7rem] font-semibold text-white/90">
                            {kr(c.total)}
                          </span>
                        </div>
                      </div>
                      <div className="w-12 shrink-0 text-right text-[0.7rem] tabular-nums text-slate-500">
                        {c.count}×
                      </div>
                    </>
                  )
                  // Uncategorized has no page to open — there's no category behind it.
                  return c.categoryId ? (
                    <Link
                      key={c.categoryId}
                      to={`/spending/${c.categoryId}?${search.toString()}`}
                      className="flex items-center gap-2.5 rounded hover:bg-white/[0.03]"
                      title={`Open the ${c.name} breakdown`}
                    >
                      {row}
                    </Link>
                  ) : (
                    <div key="none" className="flex items-center gap-2.5">
                      {row}
                    </div>
                  )
                })}
              </div>
            </Panel>

            <Panel title={isIncome ? '💼 Where it comes from' : '🏬 Where it goes'}>
              <div className="space-y-1.5">
                {data.bySource.slice(0, 12).map((s) => (
                  <Link
                    key={s.merchant}
                    to={drill(s.merchant, { merchant: s.merchant })}
                    className="-mx-1 flex items-center gap-2.5 rounded px-1 hover:bg-white/[0.03]"
                    title={`Show the ${s.merchant} transactions`}
                  >
                    <div className="w-40 shrink-0 truncate text-right text-xs text-slate-400">
                      {s.merchant}
                    </div>
                    <div className="h-[22px] flex-1 overflow-hidden rounded bg-[#1e2535]">
                      <div
                        className="flex h-full items-center rounded px-2.5"
                        style={{ width: `${Math.max((s.total / maxSource) * 100, 10)}%`, background: accent }}
                      >
                        <span className="whitespace-nowrap text-[0.7rem] font-semibold text-white/90">
                          {kr(s.total)}
                        </span>
                      </div>
                    </div>
                    <div className="w-24 shrink-0 text-right text-[0.7rem] tabular-nums text-slate-500">
                      {s.count}× · {kr(s.average)}
                    </div>
                  </Link>
                ))}
                {data.bySource.length > 12 && (
                  <p className="pt-1 text-center text-xs text-slate-600">
                    …and {data.bySource.length - 12} more
                  </p>
                )}
              </div>
            </Panel>

            {data.byAccount.length > 1 && (
              <Panel title="🏦 By account">
                <div className="flex flex-wrap gap-2">
                  {data.byAccount.map((a) => (
                    <Link
                      key={a.bankAccountId}
                      to={drill(accountNameById.get(a.bankAccountId) ?? 'Account', {}, [a.bankAccountId])}
                      className="rounded-lg border border-[#1e2535] bg-[#111620] px-3 py-2 hover:border-slate-600"
                    >
                      <div className="text-[0.68rem] text-slate-500">
                        {accountNameById.get(a.bankAccountId) ?? 'Unknown account'}
                      </div>
                      <div className="mt-0.5 text-sm font-semibold tabular-nums text-slate-200">{kr(a.total)}</div>
                      <div className="text-[0.62rem] text-slate-600">{a.count} transactions</div>
                    </Link>
                  ))}
                </div>
              </Panel>
            )}

            {data.tagBreakdown.length > 0 && (
              <Panel title="🏷️ By tag">
                <p className="mb-2.5 text-xs text-slate-600">
                  One transaction can carry several tags, so these won't add up to {kr(data.total)}.
                </p>
                <div className="flex flex-wrap gap-2">
                  {data.tagBreakdown.map((tag) => (
                    <Link
                      key={tag.tagId}
                      to={drill(tag.name, { tagId: tag.tagId })}
                      className="rounded-lg border border-violet-500/25 bg-violet-500/10 px-3 py-2 hover:border-violet-400/50"
                    >
                      <div className="text-[0.68rem] font-medium text-violet-300">{tag.name}</div>
                      <div className="mt-0.5 text-sm font-semibold tabular-nums text-slate-200">
                        {kr(Math.abs(tag.total))}
                      </div>
                      <div className="text-[0.62rem] text-slate-500">{tag.count} transactions</div>
                    </Link>
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
                      <tr
                        key={tx.id}
                        className="group/row border-b border-[#1e2535] last:border-none hover:bg-white/[0.02]"
                      >
                        <td className="py-2 pr-3 whitespace-nowrap text-slate-500">{tx.bookingDate}</td>
                        <td className="py-2 pr-3 text-slate-300">
                          {tx.description}
                          <div className="mt-1">
                            <TagEditor dark transactionId={tx.id} tags={tx.tags} />
                          </div>
                        </td>
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
                        <td
                          className="py-2 pl-3 text-right font-semibold tabular-nums"
                          style={{ color: accent }}
                        >
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

function Kpi({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-[#232b3b] bg-[#1a1f2e] px-3.5 py-3">
      <div className="text-[0.62rem] uppercase tracking-wider text-slate-600">{label}</div>
      <div
        className="mt-1 text-lg font-bold tabular-nums"
        style={accent ? { color: accent } : undefined}
      >
        {value}
      </div>
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

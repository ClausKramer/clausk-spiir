import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useMe, useLogout } from '../hooks/useAuth'
import { getTransactions, getDashboard, markTransfer, type Period, type Transaction } from '../api/transactions'
import { MarkTransferDialog } from '../components/MarkTransferDialog'
import { getBankAccounts } from '../api/accounts'
import { CategoryPicker } from '../components/CategoryPicker'
import { TagEditor } from '../components/TagEditor'
import { CashFlowChart } from '../components/CashFlowChart'
import { PeriodNavigator } from '../components/PeriodNavigator'
import { periodLabel, MONTH_NAMES } from '../lib/period'

const CATEGORY_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#3b82f6', '#6366f1',
  '#8b5cf6', '#06b6d4', '#ec4899', '#22c55e', '#64748b',
]

// Validated as a categorical set against the #111620 panel surface (lightness band, chroma,
// CVD separation, normal-vision floor, contrast). Uncategorized is deliberately outside the
// set — it's absence of data, not a fifth kind, so it stays neutral gray.
const KIND_SLOTS = [
  { key: 'fixed', label: 'Fixed', color: '#4f46e5', hint: 'Committed costs — rent, insurance, subscriptions' },
  { key: 'variable', label: 'Variable', color: '#ea580c', hint: 'Discretionary spending you can flex month to month' },
  { key: 'savings', label: 'Savings', color: '#0d9488', hint: 'Money moved into savings and investments' },
  { key: 'debt', label: 'Debt', color: '#e11d48', hint: 'Loan and credit repayments' },
  { key: 'uncategorized', label: 'Unfiled', color: '#475569', hint: 'Spending not filed under any category yet' },
] as const

const dkk = (n: number) =>
  n.toLocaleString('da-DK', { style: 'currency', currency: 'DKK', maximumFractionDigits: 0 })

export function DashboardPage() {
  const qc = useQueryClient()
  const { data: user } = useMe()
  const { mutate: doLogout, isPending: loggingOut } = useLogout()

  const { data: accounts = [] } = useQuery({ queryKey: ['accounts'], queryFn: getBankAccounts })


  // null = every account included. Once the user toggles one off, we track an explicit set.
  const [selectedIds, setSelectedIds] = useState<string[] | null>(null)
  const effectiveSelected = selectedIds ?? accounts.map((a) => a.id)
  const noneSelected = accounts.length > 0 && effectiveSelected.length === 0
  const allSelected = selectedIds === null
  // Send [] (no filter) when every account is included — cheaper query, same result.
  const accountIdsParam = allSelected || effectiveSelected.length === accounts.length ? [] : effectiveSelected

  function toggleAccount(id: string) {
    setSelectedIds((prev) => {
      // Coming from "All" (prev === null), a click means "show me just this one", not "remove
      // this one from everything" — so the starting set is empty, not every account. From any
      // explicit selection onward, clicks toggle normally within that set.
      const current = prev ?? []
      return current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
    })
  }

  // Defaults to the whole current year, per the picker's own defaults.
  const [period, setPeriod] = useState<Period>({ year: new Date().getFullYear(), month: null })

  const { data: dashboard, isLoading: dashboardLoading } = useQuery({
    queryKey: ['dashboard', accountIdsParam, period],
    queryFn: () => getDashboard(accountIdsParam, period),
    enabled: !noneSelected,
    // Keeps the previous period's numbers on screen while the next load runs, so switching
    // month doesn't blank the whole dashboard.
    placeholderData: (prev) => prev,
  })

  const { data: txPage, isLoading: txLoading } = useQuery({
    queryKey: ['transactions', 1, accountIdsParam, period, 'settled'],
    // includeFuture: false — scheduled payments are excluded from every figure on this page, so
    // listing them here would only invite the question of why they don't add up. They stay
    // visible on the per-account list.
    queryFn: () => getTransactions(1, 50, accountIdsParam, period, false),
    enabled: !noneSelected,
    placeholderData: (prev) => prev,
  })

  const categoryRows = dashboard?.categoryBreakdown.filter((r) => r.total > 0) ?? []
  const maxCategory = categoryRows.length > 0 ? Math.max(...categoryRows.map((r) => r.total)) : 1
  const categoryColorByKey = new Map(categoryRows.map((r, i) => [r.categoryId ?? 'none', CATEGORY_COLORS[i % CATEGORY_COLORS.length]]))

  // Zero-value kinds are dropped rather than drawn as slivers — a 0% segment is a rendering
  // artefact, and the legend would claim a category that isn't there.
  const kindSlots = KIND_SLOTS
    .map((s) => ({ ...s, value: dashboard?.spendingByKind[s.key] ?? 0 }))
    .filter((s) => s.value > 0)
  const kindTotal = kindSlots.reduce((sum, s) => sum + s.value, 0)

  const tagRows = dashboard?.tagBreakdown.filter((t) => t.total > 0) ?? []
  const maxTag = tagRows.length > 0 ? Math.max(...tagRows.map((t) => t.total)) : 1

  const accountNameById = new Map(accounts.map((a) => [a.id, a.name]))

  // Chart by default for the shape of the year; the cards view doubles as this chart's table
  // view, so every plotted value stays readable as text.
  const [flowView, setFlowView] = useState<'chart' | 'cards'>('chart')

  const [markingTransfer, setMarkingTransfer] = useState<Transaction | null>(null)

  // Unmarking needs no dialog — there's nothing to choose, and it only ever affects the one row.
  const { mutate: unmarkTransfer } = useMutation({
    mutationFn: (id: string) => markTransfer([id], false),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })

  // Carries the dashboard's account filter and period into the category page, so its figures
  // describe the same slice the user clicked from rather than silently widening to everything.
  const categoryLinkParams = (() => {
    const p = new URLSearchParams()
    p.set('year', String(period.year))
    if (period.month !== null) p.set('month', String(period.month))
    accountIdsParam.forEach((id) => p.append('accountIds', id))
    return p.toString()
  })()

  // Years with data, from the server, plus the current year so "this year" is always selectable
  // even before any transaction lands in it.
  const yearOptions = [...new Set([...(dashboard?.availableYears ?? []), new Date().getFullYear(), period.year])]
    .sort((a, b) => b - a)

  const label = periodLabel(period)

  const kpis = dashboard?.kpis
  const netBalancePositive = (kpis?.netBalance ?? 0) >= 0
  const surplusPositive = (kpis?.avgMonthlySurplus ?? 0) >= 0

  return (
    <div className="min-h-screen bg-[#0f1117] text-slate-200 px-4 py-6 md:px-8 md:py-8">
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-50">🏦 Spiir</h1>
            <p className="mt-0.5 text-xs text-slate-500">
              {user?.email}
              {accounts.length > 0 && <> &nbsp;·&nbsp; {accounts.length} account{accounts.length === 1 ? '' : 's'}</>}
              {txPage && <> &nbsp;·&nbsp; {txPage.totalCount} transactions</>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Sync, recategorize, duplicate-finding and rule clearing all live on the Accounts
                page: they change the underlying data, whereas this page only reads it. */}
            <Link
              to="/accounts"
              className="rounded-lg border border-slate-700 bg-[#1a1f2e] px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-[#232b3b] transition-colors"
            >
              Accounts
            </Link>
            <button
              onClick={() => doLogout()}
              disabled={loggingOut}
              className="rounded-lg border border-slate-700 bg-[#1a1f2e] px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-[#232b3b] disabled:opacity-50 transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>

        {/* Period */}
        <div className="mb-4">
          {/* No "All years" here: every figure on this page is per-period, and an unbounded
              range would make the monthly averages meaningless. */}
          <PeriodNavigator
            dark
            period={period}
            onChange={(p) => p && setPeriod(p)}
            availableYears={yearOptions}
          />
        </div>

        {/* Account filter */}
        {accounts.length > 0 && (
          <div className="mb-6 flex flex-wrap items-center gap-2">
            <span className="text-[0.7rem] uppercase tracking-wider text-slate-500 mr-1">Accounts</span>
            <button
              onClick={() => setSelectedIds(null)}
              className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                allSelected
                  ? 'bg-indigo-500/20 border-indigo-500 text-indigo-300'
                  : 'border-slate-700 text-slate-400 hover:bg-[#1a1f2e]'
              }`}
            >
              All
            </button>
            {accounts.map((a) => {
              const active = effectiveSelected.includes(a.id)
              return (
                <button
                  key={a.id}
                  onClick={() => toggleAccount(a.id)}
                  className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                    active
                      ? 'bg-[#1a1f2e] border-slate-600 text-slate-200'
                      : 'border-slate-800 text-slate-600 hover:text-slate-400'
                  }`}
                >
                  {a.name}
                </button>
              )
            })}
          </div>
        )}

        {noneSelected ? (
          <div className="rounded-xl border border-slate-800 bg-[#1a1f2e] py-16 text-center">
            <p className="text-slate-400">No accounts selected.</p>
            <button onClick={() => setSelectedIds(null)} className="mt-2 text-sm text-indigo-400 hover:underline">
              Select all accounts
            </button>
          </div>
        ) : (
          <>
            {/* KPI cards */}
            <div className="mb-5 grid grid-cols-2 md:grid-cols-4 gap-3">
              <Kpi label="Avg. monthly income" value={dkk(kpis?.avgMonthlyIncome ?? 0)} valueClass="text-emerald-400" loading={dashboardLoading} />
              <Kpi label="Avg. monthly expenses" value={dkk(-(kpis?.avgMonthlyExpense ?? 0))} valueClass="text-red-400" loading={dashboardLoading} />
              <Kpi
                label="Avg. monthly surplus"
                value={dkk(kpis?.avgMonthlySurplus ?? 0)}
                valueClass={surplusPositive ? 'text-amber-400' : 'text-red-400'}
                loading={dashboardLoading}
              />
              <Kpi
                label="Net balance (tracked)"
                value={dkk(kpis?.netBalance ?? 0)}
                valueClass={netBalancePositive ? 'text-emerald-400' : 'text-red-400'}
                sub="Sum of synced transactions"
                loading={dashboardLoading}
              />
            </div>

            {/* Monthly flow */}
            <Section
              title={`📅 Monthly cash flow — ${label}`}
              action={
                <div className="flex rounded-lg border border-slate-700 p-0.5" role="group" aria-label="Cash flow view">
                  {(['chart', 'cards'] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setFlowView(v)}
                      aria-pressed={flowView === v}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                        flowView === v ? 'bg-[#232b3b] text-slate-200' : 'text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              }
            >
              {dashboardLoading ? (
                <Spinner />
              ) : flowView === 'chart' ? (
                <CashFlowChart data={dashboard?.monthlyFlow ?? []} />
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {dashboard?.monthlyFlow.map((m) => (
                    <div key={`${m.year}-${m.month}`} className="rounded-lg border border-[#1e2535] bg-[#111620] px-2.5 py-3 text-center">
                      <div className="text-[0.65rem] uppercase text-slate-600 mb-1.5">{MONTH_NAMES[m.month - 1]}</div>
                      <div className="text-xs font-semibold text-emerald-400">+{Math.round(m.income).toLocaleString('da-DK')}</div>
                      <div className="text-xs font-semibold text-red-400">−{Math.round(m.expense).toLocaleString('da-DK')}</div>
                      <div className={`mt-1 text-[0.7rem] font-semibold ${m.net >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {m.net >= 0 ? '+' : ''}
                        {Math.round(m.net).toLocaleString('da-DK')}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <div className="mb-5 grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Category breakdown */}
              <Section title={`📊 Spending by category — ${label}`}>
                {dashboardLoading ? (
                  <Spinner />
                ) : categoryRows.length === 0 ? (
                  <p className="text-center text-sm text-slate-600 py-8">No categorized spending yet.</p>
                ) : (
                  <div className="space-y-2">
                    {categoryRows.slice(0, 9).map((row) => {
                      return (
                        <Link
                          key={row.categoryId ?? 'none'}
                          to={`/spending/${row.categoryId ?? 'uncategorized'}?${categoryLinkParams}`}
                          className="flex w-full items-center gap-2.5 rounded text-left hover:bg-white/[0.03] focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                          title={`Open the ${row.categoryName ?? 'uncategorized'} breakdown`}
                        >
                          <div className="w-36 shrink-0 truncate text-right text-xs text-slate-400">
                            {row.categoryEmoji && <span className="mr-1">{row.categoryEmoji}</span>}
                            {row.categoryName ?? 'Uncategorized'}
                          </div>
                          <div className="h-[22px] flex-1 overflow-hidden rounded bg-[#1e2535]">
                            <div
                              className="flex h-full items-center rounded px-2.5 transition-all duration-500"
                              style={{
                                width: `${Math.max((row.total / maxCategory) * 100, 8)}%`,
                                background: categoryColorByKey.get(row.categoryId ?? 'none'),
                              }}
                            >
                              <span className="whitespace-nowrap text-[0.7rem] font-semibold text-white/90">{dkk(row.total)}</span>
                            </div>
                          </div>
                          <span className="shrink-0 pr-1 text-slate-600">›</span>
                        </Link>
                      )
                    })}
                  </div>
                )}
              </Section>

              {/* Structural balance */}
              <Section title="💰 Structural monthly balance">
                {dashboardLoading ? (
                  <Spinner />
                ) : (
                  <div className="rounded-lg border border-[#1e2535] bg-[#111620] px-3.5 py-3 text-sm">
                    <FlowRow label="Avg. income" value={dkk(kpis?.avgMonthlyIncome ?? 0)} valueClass="text-emerald-400" />
                    <FlowRow label="Avg. expenses" value={dkk(-(kpis?.avgMonthlyExpense ?? 0))} valueClass="text-red-400" />
                    <div className="mt-1.5 border-t border-slate-700 pt-1.5">
                      <FlowRow
                        label="Avg. surplus"
                        value={`${surplusPositive ? '+' : ''}${dkk(kpis?.avgMonthlySurplus ?? 0)}`}
                        valueClass={surplusPositive ? 'text-emerald-400' : 'text-red-400'}
                        bold
                      />
                    </div>
                  </div>
                )}
              </Section>
            </div>

            <div className="mb-5 grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Section title={`🧭 Committed vs. discretionary — ${label}`}>
                {dashboardLoading ? (
                  <Spinner />
                ) : kindTotal === 0 ? (
                  <p className="py-8 text-center text-sm text-slate-600">No spending in this period.</p>
                ) : (
                  <>
                    {/* One bar, one measure: the period's outgoings split by what kind of
                        commitment they are. 2px surface gaps keep the segments readable. */}
                    <div className="flex h-8 gap-0.5 overflow-hidden rounded">
                      {kindSlots.map((s) => (
                        <div
                          key={s.key}
                          className="flex items-center justify-center first:rounded-l last:rounded-r"
                          style={{ width: `${(s.value / kindTotal) * 100}%`, background: s.color }}
                          title={`${s.label}: ${dkk(s.value)}`}
                        >
                          {s.value / kindTotal > 0.11 && (
                            <span className="text-[0.68rem] font-semibold text-white/95">
                              {Math.round((s.value / kindTotal) * 100)}%
                            </span>
                          )}
                        </div>
                      ))}
                    </div>

                    <dl className="mt-3 space-y-1.5">
                      {kindSlots.map((s) => (
                        <div key={s.key} className="flex items-center gap-2 text-xs" title={s.hint}>
                          <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
                          <dt className="flex-1 text-slate-400">{s.label}</dt>
                          <dd className="tabular-nums font-semibold text-slate-200">{dkk(s.value)}</dd>
                          <dd className="w-10 text-right tabular-nums text-slate-600">
                            {Math.round((s.value / kindTotal) * 100)}%
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </>
                )}
              </Section>

              <Section title={`🏷️ Tags — ${label}`}>
                {dashboardLoading ? (
                  <Spinner />
                ) : tagRows.length === 0 ? (
                  <p className="px-1 py-8 text-center text-sm text-slate-600">
                    No tags yet. Hover a transaction and use <span className="text-slate-400">+ tag</span> to label it
                    — “Padel”, “Føtex”, “Clara” — and its total shows up here.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {tagRows.slice(0, 9).map((tag) => (
                      <div key={tag.tagId} className="flex items-center gap-2.5">
                        <div className="w-28 shrink-0 truncate text-right text-xs text-slate-400" title={tag.name}>
                          {tag.name}
                        </div>
                        <div className="h-[22px] flex-1 overflow-hidden rounded bg-[#1e2535]">
                          <div
                            className="flex h-full items-center rounded bg-[#7c3aed] px-2.5"
                            style={{ width: `${Math.max((tag.total / maxTag) * 100, 8)}%` }}
                          >
                            <span className="whitespace-nowrap text-[0.7rem] font-semibold text-white/90">
                              {dkk(tag.total)}
                            </span>
                          </div>
                        </div>
                        <span className="w-10 shrink-0 text-right text-[0.7rem] tabular-nums text-slate-600">
                          {tag.count}×
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </Section>
            </div>

            {/* Transactions */}
            <Section
              title={(() => {
                // Transfers stay listed but marked; scheduled payments aren't listed here at all,
                // so the wording distinguishes them rather than lumping both under "not counted".
                const notes = []
                if (dashboard?.excludedTransfers) notes.push(`${dashboard.excludedTransfers} transfer legs marked`)
                if (dashboard?.excludedFuture) notes.push(`${dashboard.excludedFuture} scheduled hidden`)
                return notes.length > 0 ? `📋 Transactions — ${notes.join(', ')}` : '📋 Transactions'
              })()}
            >
              {txLoading ? (
                <Spinner />
              ) : txPage && txPage.items.length > 0 ? (
                <div className="overflow-x-auto">
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
                      {txPage.items.map((tx) => (
                        <tr
                          key={tx.id}
                          className={`group/row border-b border-[#1e2535] last:border-none hover:bg-white/[0.02] ${tx.isFuture || tx.isTransfer ? 'opacity-60' : ''}`}
                        >
                          <td className="py-2 pr-3 whitespace-nowrap text-slate-500">{tx.bookingDate}</td>
                          <td className="py-2 pr-3 text-slate-300">
                            {tx.description}
                            {tx.isFuture && (
                              <span
                                className="ml-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 align-middle text-[0.62rem] font-medium uppercase tracking-wide text-amber-400"
                                title="Scheduled by the bank for a future date — not counted in any total"
                              >
                                Scheduled
                              </span>
                            )}
                            {tx.isTransfer && (
                              <button
                                onClick={() => tx.isManualTransfer && unmarkTransfer(tx.id)}
                                disabled={!tx.isManualTransfer}
                                className="ml-2 rounded-full border border-sky-500/40 bg-sky-500/10 px-1.5 py-0.5 align-middle text-[0.62rem] font-medium uppercase tracking-wide text-sky-400 enabled:hover:bg-sky-500/20"
                                title={
                                  tx.isManualTransfer
                                    ? 'Marked as a transfer by you — click to undo'
                                    : 'Matched against the opposite leg in another of your accounts — not counted as income or spending'
                                }
                              >
                                Transfer{tx.isManualTransfer ? ' ✕' : ''}
                              </button>
                            )}
                            {!tx.isTransfer && (
                              <button
                                onClick={() => setMarkingTransfer(tx)}
                                className="ml-2 align-middle text-[0.62rem] text-slate-700 opacity-0 transition-opacity hover:text-sky-400 group-hover/row:opacity-100"
                                title="Mark as an internal transfer, so it's left out of income and spending"
                              >
                                ⇄
                              </button>
                            )}
                            <div className="mt-1">
                              <TagEditor dark transactionId={tx.id} tags={tx.tags} />
                            </div>
                          </td>
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
                          <td className={`py-2 pl-3 text-right font-semibold tabular-nums ${tx.amount < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                            {tx.amount.toLocaleString('da-DK', { style: 'currency', currency: tx.currency })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-14 text-center">
                  <div className="text-3xl mb-2">🏦</div>
                  <p className="text-slate-400 font-medium">No transactions yet</p>
                  <p className="mt-1 text-sm text-slate-600">Connect a bank account to start syncing transactions.</p>
                </div>
              )}
            </Section>
          </>
        )}

        {markingTransfer && (
          <MarkTransferDialog
            transaction={markingTransfer}
            accountNameById={accountNameById}
            onClose={() => setMarkingTransfer(null)}
          />
        )}
      </div>
    </div>
  )
}

function Kpi({ label, value, valueClass, sub, loading }: { label: string; value: string; valueClass: string; sub?: string; loading?: boolean }) {
  return (
    <div className="rounded-xl border border-[#232b3b] bg-[#1a1f2e] px-4 py-3.5">
      <div className="text-[0.68rem] uppercase tracking-wider text-slate-600 mb-1.5">{label}</div>
      <div className={`text-xl font-bold tabular-nums ${valueClass}`}>{loading ? '—' : value}</div>
      {sub && <div className="mt-1 text-[0.68rem] text-slate-600">{sub}</div>}
    </div>
  )
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-5 rounded-xl border border-[#232b3b] bg-[#1a1f2e] p-4 md:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="text-[0.7rem] font-bold uppercase tracking-wider text-slate-600">{title}</div>
        {action}
      </div>
      {children}
    </div>
  )
}

function FlowRow({ label, value, valueClass, bold }: { label: string; value: string; valueClass: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between py-0.5 ${bold ? 'font-bold text-[0.9rem]' : 'text-slate-400'}`}>
      <span>{label}</span>
      <span className={valueClass}>{value}</span>
    </div>
  )
}

function Spinner() {
  return (
    <div className="flex justify-center py-8">
      <div className="h-6 w-6 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
    </div>
  )
}

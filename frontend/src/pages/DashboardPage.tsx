import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useMe, useLogout } from '../hooks/useAuth'
import { getTransactions, getDashboard, recategorize, type Period } from '../api/transactions'
import { getBankAccounts, syncAll } from '../api/accounts'
import { syncDefaultCategories, clearLearnedRules } from '../api/categories'
import { CategoryPicker } from '../components/CategoryPicker'
import { CategoryTransactionsDialog } from '../components/CategoryTransactionsDialog'

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const CATEGORY_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#3b82f6', '#6366f1',
  '#8b5cf6', '#06b6d4', '#ec4899', '#22c55e', '#64748b',
]

const dkk = (n: number) =>
  n.toLocaleString('da-DK', { style: 'currency', currency: 'DKK', maximumFractionDigits: 0 })

export function DashboardPage() {
  const qc = useQueryClient()
  const { data: user } = useMe()
  const { mutate: doLogout, isPending: loggingOut } = useLogout()

  const { data: accounts = [] } = useQuery({ queryKey: ['accounts'], queryFn: getBankAccounts })

  // One banner for both actions — they're mutually exclusive in practice and both just report
  // "here's what changed", so a shared slot avoids two competing status areas.
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  const { mutate: doSync, isPending: syncing } = useMutation({
    mutationFn: syncAll,
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['accounts'] })
      setStatusMessage(result.message)
    },
    onError: () => setStatusMessage('Sync failed. Please try again.'),
  })

  // Sync defaults first, then recategorize — new categories are useless to the engine until they
  // exist, so doing both in one click is the only order that actually helps.
  const { mutate: doRecategorize, isPending: recategorizing } = useMutation({
    mutationFn: async () => {
      const defaults = await syncDefaultCategories()
      const result = await recategorize(true)
      return { defaults, result }
    },
    onSuccess: ({ defaults, result }) => {
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['categories'] })
      const defaultsChanged = defaults.addedCategories > 0 || defaults.addedRules > 0 || defaults.removedRules > 0
      setStatusMessage(defaultsChanged ? `${defaults.message} ${result.message}` : result.message)
    },
    onError: () => setStatusMessage('Recategorize failed. Please try again.'),
  })

  const { mutate: doClearRules, isPending: clearingRules } = useMutation({
    mutationFn: clearLearnedRules,
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      setStatusMessage(`${result.message} Run Recategorize to re-apply the default rules.`)
    },
    onError: () => setStatusMessage('Could not clear learned rules. Please try again.'),
  })

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
    queryKey: ['transactions', 1, accountIdsParam, period],
    queryFn: () => getTransactions(1, 50, accountIdsParam, period),
    enabled: !noneSelected,
    placeholderData: (prev) => prev,
  })

  const categoryRows = dashboard?.categoryBreakdown.filter((r) => r.total > 0) ?? []
  const maxCategory = categoryRows.length > 0 ? Math.max(...categoryRows.map((r) => r.total)) : 1
  const categoryColorByKey = new Map(categoryRows.map((r, i) => [r.categoryId ?? 'none', CATEGORY_COLORS[i % CATEGORY_COLORS.length]]))

  const accountNameById = new Map(accounts.map((a) => [a.id, a.name]))

  // Which category bar the user drilled into. Held as an object rather than just the id because
  // the id is null for uncategorized, which wouldn't distinguish "closed" from "uncategorized".
  const [openCategory, setOpenCategory] = useState<{ id: string | null; label: string } | null>(null)

  // Years with data, from the server, plus the current year so "this year" is always selectable
  // even before any transaction lands in it.
  const yearOptions = [...new Set([...(dashboard?.availableYears ?? []), new Date().getFullYear(), period.year])]
    .sort((a, b) => b - a)

  const periodLabel = period.month === null ? String(period.year) : `${MONTH_NAMES[period.month - 1]} ${period.year}`

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
            <button
              onClick={() => doSync()}
              disabled={syncing || accounts.length === 0}
              className="rounded-lg border border-slate-700 bg-[#1a1f2e] px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-[#232b3b] disabled:opacity-40 transition-colors"
              title="Fetch new transactions from your banks"
            >
              {syncing ? 'Syncing…' : 'Sync'}
            </button>
            <button
              onClick={() => doRecategorize()}
              disabled={recategorizing || accounts.length === 0}
              className="rounded-lg border border-slate-700 bg-[#1a1f2e] px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-[#232b3b] disabled:opacity-40 transition-colors"
              title="Re-run categorization on transactions that are still uncategorized"
            >
              {recategorizing ? 'Categorizing…' : 'Recategorize'}
            </button>
            <button
              onClick={() => {
                if (confirm('Clear all rules learned from your corrections? Default rules and existing categories are kept.')) doClearRules()
              }}
              disabled={clearingRules}
              className="rounded-lg border border-slate-800 px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-[#1a1f2e] hover:text-slate-300 disabled:opacity-40 transition-colors"
              title="Remove rules learned from your corrections, e.g. if one turned out too broad"
            >
              {clearingRules ? 'Clearing…' : 'Clear learned rules'}
            </button>
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

        {statusMessage && (
          <div className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-slate-700 bg-[#1a1f2e] px-4 py-2.5 text-xs text-slate-300">
            <span>{statusMessage}</span>
            <button
              onClick={() => setStatusMessage(null)}
              className="shrink-0 text-slate-600 hover:text-slate-400"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        )}

        {/* Period */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="mr-1 text-[0.7rem] uppercase tracking-wider text-slate-500">Period</span>
          <select
            value={period.year}
            onChange={(e) => setPeriod((p) => ({ ...p, year: Number(e.target.value) }))}
            className="rounded-lg border border-slate-700 bg-[#1a1f2e] px-2.5 py-1 text-xs font-medium text-slate-200 outline-none focus:border-indigo-500"
            aria-label="Year"
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <select
            value={period.month ?? ''}
            onChange={(e) => setPeriod((p) => ({ ...p, month: e.target.value === '' ? null : Number(e.target.value) }))}
            className="rounded-lg border border-slate-700 bg-[#1a1f2e] px-2.5 py-1 text-xs font-medium text-slate-200 outline-none focus:border-indigo-500"
            aria-label="Month"
          >
            <option value="">All year</option>
            {MONTH_NAMES.map((name, i) => (
              <option key={name} value={i + 1}>{name}</option>
            ))}
          </select>
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
            <Section title={`📅 Monthly cash flow — ${periodLabel}`}>
              {dashboardLoading ? (
                <Spinner />
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
              <Section title={`📊 Spending by category — ${periodLabel}`}>
                {dashboardLoading ? (
                  <Spinner />
                ) : categoryRows.length === 0 ? (
                  <p className="text-center text-sm text-slate-600 py-8">No categorized spending yet.</p>
                ) : (
                  <div className="space-y-2">
                    {categoryRows.slice(0, 9).map((row) => {
                      const label = `${row.categoryEmoji ?? ''} ${row.categoryName ?? 'Uncategorized'}`.trim()
                      return (
                        <button
                          key={row.categoryId ?? 'none'}
                          onClick={() => setOpenCategory({ id: row.categoryId, label })}
                          className="flex w-full items-center gap-2.5 rounded text-left hover:bg-white/[0.03] focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                          title={`Show the ${row.categoryName ?? 'uncategorized'} transactions behind this total`}
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
                        </button>
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

            {/* Transactions */}
            <Section
              title={(() => {
                const notes = []
                if (dashboard?.excludedTransfers) notes.push(`${dashboard.excludedTransfers} transfer`)
                if (dashboard?.excludedFuture) notes.push(`${dashboard.excludedFuture} scheduled`)
                return notes.length > 0 ? `📋 Transactions — ${notes.join(', ')} not counted` : '📋 Transactions'
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
                          className={`border-b border-[#1e2535] last:border-none hover:bg-white/[0.02] ${tx.isFuture || tx.isTransfer ? 'opacity-60' : ''}`}
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
                              <span
                                className="ml-2 rounded-full border border-sky-500/40 bg-sky-500/10 px-1.5 py-0.5 align-middle text-[0.62rem] font-medium uppercase tracking-wide text-sky-400"
                                title="Matched against the opposite leg in another of your accounts — not counted as income or spending"
                              >
                                Transfer
                              </span>
                            )}
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

        {openCategory && (
          <CategoryTransactionsDialog
            categoryId={openCategory.id}
            categoryLabel={openCategory.label}
            accountIds={accountIdsParam}
            period={period}
            accountNameById={accountNameById}
            onClose={() => setOpenCategory(null)}
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5 rounded-xl border border-[#232b3b] bg-[#1a1f2e] p-4 md:p-5">
      <div className="mb-4 text-[0.7rem] font-bold uppercase tracking-wider text-slate-600">{title}</div>
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

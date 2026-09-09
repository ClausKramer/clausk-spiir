import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useMe, useLogout } from '../hooks/useAuth'
import {
  getTransactions,
  getDashboard,
  markTransfer,
  type Period,
  type Transaction,
  type TransactionQuery,
} from '../api/transactions'
import { MarkTransferDialog } from '../components/MarkTransferDialog'
import { getBankAccounts } from '../api/accounts'
import { CategoryPicker } from '../components/CategoryPicker'
import { TagEditor } from '../components/TagEditor'
import { CashFlowChart } from '../components/CashFlowChart'
import { PeriodNavigator } from '../components/PeriodNavigator'
import { periodLabel, MONTH_NAMES, readPeriod, writePeriod, currentMonth } from '../lib/period'
import { drillTo, type Measure } from '../lib/drill'
import { BarRow } from '../components/BarRow'
import { EXPENSE, TAG, KIND_FIXED, KIND_VARIABLE, KIND_SAVINGS, KIND_DEBT, KIND_NONE } from '../lib/chartColors'

// Validated as a categorical set against the #111620 panel surface (lightness band, chroma,
// CVD separation, normal-vision floor, contrast). Uncategorized is deliberately outside the
// set — it's absence of data, not a fifth kind, so it stays neutral gray.
const KIND_SLOTS = [
  { key: 'fixed', label: 'Fixed', color: KIND_FIXED, hint: 'Committed costs — rent, insurance, subscriptions' },
  { key: 'variable', label: 'Variable', color: KIND_VARIABLE, hint: 'Discretionary spending you can flex month to month' },
  { key: 'savings', label: 'Savings', color: KIND_SAVINGS, hint: 'Money moved into savings and investments' },
  { key: 'debt', label: 'Debt', color: KIND_DEBT, hint: 'Loan and credit repayments' },
  { key: 'uncategorized', label: 'Unfiled', color: KIND_NONE, hint: 'Spending not filed under any category yet' },
] as const

const dkk = (n: number) =>
  n.toLocaleString('da-DK', { style: 'currency', currency: 'DKK', maximumFractionDigits: 0 })

export function DashboardPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { data: user } = useMe()
  const { mutate: doLogout, isPending: loggingOut } = useLogout()

  const { data: accounts = [] } = useQuery({ queryKey: ['accounts'], queryFn: getBankAccounts })


  // Every filter and view choice on this page lives in the URL, so the view can be bookmarked,
  // shared, and survives a reload — and so that coming back from a drill-down lands on the same
  // dashboard you left. Written with replace so filter fiddling doesn't fill up the back button.
  const [search, setSearch] = useSearchParams()
  const update = (mutate: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(search)
    mutate(next)
    setSearch(next, { replace: true })
  }

  // null = every account included. Once the user toggles one off, we track an explicit set.
  // In the URL: no marker means all, `accounts=none` means an empty selection (which is a real
  // state the user can reach and would be baffling to silently reset), otherwise the ids.
  const selectedIds: string[] | null =
    search.get('accounts') === 'none' ? [] : search.getAll('accountIds').length > 0 ? search.getAll('accountIds') : null

  const effectiveSelected = selectedIds ?? accounts.map((a) => a.id)
  const noneSelected = accounts.length > 0 && effectiveSelected.length === 0
  const allSelected = selectedIds === null
  // Send [] (no filter) when every account is included — cheaper query, same result.
  const accountIdsParam = allSelected || effectiveSelected.length === accounts.length ? [] : effectiveSelected

  function setSelectedIds(next: string[] | null) {
    update((p) => {
      p.delete('accountIds')
      p.delete('accounts')
      if (next === null) return
      if (next.length === 0) p.set('accounts', 'none')
      else next.forEach((id) => p.append('accountIds', id))
    })
  }

  function toggleAccount(id: string) {
    // Coming from "All" (selectedIds === null), a click means "show me just this one", not
    // "remove this one from everything" — so the starting set is empty, not every account. From
    // any explicit selection onward, clicks toggle normally within that set.
    const current = selectedIds ?? []
    setSelectedIds(current.includes(id) ? current.filter((x) => x !== id) : [...current, id])
  }

  // Opens on the current month: the dashboard's job on arrival is "how is this month going",
  // and a whole year of history is a question you go looking for rather than land on. An
  // explicit ?year= in the URL always wins, so a bookmarked or shared view keeps its period.
  const period: Period = readPeriod(search) ?? currentMonth()
  const setPeriod = (next: Period) => update((p) => writePeriod(p, next))

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
  const flowView: 'chart' | 'cards' = search.get('flow') === 'cards' ? 'cards' : 'chart'
  const setFlowView = (v: 'chart' | 'cards') =>
    update((p) => (v === 'chart' ? p.delete('flow') : p.set('flow', v)))

  // Average by default: "we spend 4.200 kr/month on groceries" is the figure a budget is set
  // against, and it's comparable between a part-year and a full one — a total isn't.
  const categoryAmounts: 'average' | 'total' = search.get('amounts') === 'total' ? 'total' : 'average'
  const setCategoryAmounts = (v: 'average' | 'total') =>
    update((p) => (v === 'average' ? p.delete('amounts') : p.set('amounts', v)))
  // Months that actually saw spending, never zero. Over a single selected month this is 1, so
  // average and total coincide and the toggle is hidden.
  const monthDivisor = Math.max(1, dashboard?.monthsWithData ?? 1)
  const showAverage = categoryAmounts === 'average' && monthDivisor > 1

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

  // Every calculated figure on this page is openable. One helper so the page's account filter
  // and period always travel with the link and the drill-down describes the same slice.
  const drill = (
    text: string,
    query: TransactionQuery,
    measure: Measure,
    month?: { year: number; month: number },
  ) => drillTo(text, query, accountIdsParam, period, { measure, month })

  // Income and expense figures for one month go to the flow page, the same destination the
  // chart's bars use, so the two views of the same data don't lead to different places.
  const monthFlowLink = (dir: 'income' | 'expense', m: { year: number; month: number }) => {
    const p = new URLSearchParams()
    p.set('year', String(m.year))
    p.set('month', String(m.month))
    accountIdsParam.forEach((id) => p.append('accountIds', id))
    return `/flow/${dir}?${p.toString()}`
  }

  // Unfiled isn't a Kind — it's the absence of one — so it filters on "no category" instead.
  const kindDrill = (slot: { key: string; label: string }) =>
    slot.key === 'uncategorized'
      ? drill('Unfiled spending', { uncategorized: true, direction: 'expense' }, 'outflow')
      : drill(`${slot.label} spending`, { kind: slot.label, direction: 'expense' }, 'outflow')

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
              <Kpi
                label="Avg. monthly income"
                value={dkk(kpis?.avgMonthlyIncome ?? 0)}
                valueClass="text-emerald-400"
                loading={dashboardLoading}
                to={drill('All income', { direction: 'income' }, 'inflow')}
              />
              <Kpi
                label="Avg. monthly expenses"
                value={dkk(-(kpis?.avgMonthlyExpense ?? 0))}
                valueClass="text-red-400"
                loading={dashboardLoading}
                to={drill('All spending', { direction: 'expense' }, 'outflow')}
              />
              <Kpi
                label="Avg. monthly surplus"
                value={dkk(kpis?.avgMonthlySurplus ?? 0)}
                valueClass={surplusPositive ? 'text-amber-400' : 'text-red-400'}
                loading={dashboardLoading}
                to={drill('Income and spending', {}, 'net')}
              />
              <Kpi
                label="Net balance (tracked)"
                value={dkk(kpis?.netBalance ?? 0)}
                valueClass={netBalancePositive ? 'text-emerald-400' : 'text-red-400'}
                sub="Sum of synced transactions"
                loading={dashboardLoading}
                to={drill('Net balance', { scope: 'balance' }, 'net')}
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
                <CashFlowChart
                  data={dashboard?.monthlyFlow ?? []}
                  // Scoped to the bar's own month, not the dashboard's period — the bar shows
                  // one month, so the page behind it has to as well or the totals won't match.
                  onSelect={(dir, m) => {
                    const p = new URLSearchParams()
                    p.set('year', String(m.year))
                    p.set('month', String(m.month))
                    accountIdsParam.forEach((id) => p.append('accountIds', id))
                    navigate(`/flow/${dir}?${p.toString()}`)
                  }}
                />
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {/* The cards view is this chart's table view, so each figure opens the same
                      rows its bar does — income and expenses to the flow page the bars use,
                      net to the generic view, since no bar represents it. */}
                  {dashboard?.monthlyFlow.map((m) => (
                    <div key={`${m.year}-${m.month}`} className="rounded-lg border border-[#1e2535] bg-[#111620] px-2.5 py-3 text-center">
                      <div className="text-[0.65rem] uppercase text-slate-600 mb-1.5">{MONTH_NAMES[m.month - 1]}</div>
                      <Link
                        to={monthFlowLink('income', m)}
                        className="block text-xs font-semibold text-emerald-400 hover:underline"
                      >
                        +{Math.round(m.income).toLocaleString('da-DK')}
                      </Link>
                      <Link
                        to={monthFlowLink('expense', m)}
                        className="block text-xs font-semibold text-red-400 hover:underline"
                      >
                        −{Math.round(m.expense).toLocaleString('da-DK')}
                      </Link>
                      <Link
                        to={drill(
                          `${MONTH_NAMES[m.month - 1]} ${m.year}`,
                          {},
                          'net',
                          { year: m.year, month: m.month },
                        )}
                        className={`mt-1 block text-[0.7rem] font-semibold hover:underline ${m.net >= 0 ? 'text-emerald-400' : 'text-red-400'}`}
                      >
                        {m.net >= 0 ? '+' : ''}
                        {Math.round(m.net).toLocaleString('da-DK')}
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <div className="mb-5 grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Category breakdown */}
              <Section
                title={`📊 Spending by category — ${label}`}
                action={
                  // Meaningless over a single month, where the average is the total.
                  monthDivisor > 1 ? (
                    <div
                      className="flex rounded-lg border border-slate-700 p-0.5"
                      role="group"
                      aria-label="Category amounts"
                    >
                      {(['average', 'total'] as const).map((v) => (
                        <button
                          key={v}
                          onClick={() => setCategoryAmounts(v)}
                          aria-pressed={categoryAmounts === v}
                          className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                            categoryAmounts === v ? 'bg-[#232b3b] text-slate-200' : 'text-slate-500 hover:text-slate-300'
                          }`}
                          title={
                            v === 'average'
                              ? `Per month, over the ${monthDivisor} months with spending`
                              : `Total across ${label}`
                          }
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                  ) : undefined
                }
              >
                {dashboardLoading ? (
                  <Spinner />
                ) : categoryRows.length === 0 ? (
                  <p className="text-center text-sm text-slate-600 py-8">No categorized spending yet.</p>
                ) : (
                  <>
                    <div className="space-y-2">
                      {categoryRows.slice(0, 9).map((row) => {
                        const amount = showAverage ? row.total / monthDivisor : row.total
                        return (
                          <BarRow
                            key={row.categoryId ?? 'none'}
                            labelWidth="w-36"
                            label={
                              <>
                                {row.categoryEmoji && <span className="mr-1">{row.categoryEmoji}</span>}
                                {row.categoryName ?? 'Uncategorized'}
                              </>
                            }
                            // Scaled against the largest bar, so switching between total and
                            // per-month rescales every bar by the same divisor and the shape
                            // of the chart is unchanged.
                            fraction={row.total / maxCategory}
                            amount={dkk(amount)}
                            color={EXPENSE}
                            meta="›"
                            metaWidth="w-4"
                            to={
                              row.categoryId
                                ? `/spending/${row.categoryId}?${categoryLinkParams}`
                                : drill('Uncategorized spending', { uncategorized: true, direction: 'expense' }, 'outflow')
                            }
                            title={`Open the ${row.categoryName ?? 'uncategorized'} breakdown`}
                          />
                        )
                      })}
                    </div>
                    {monthDivisor > 1 && (
                      <p className="mt-3 text-[0.68rem] text-slate-600">
                        {showAverage
                          ? `Per month, averaged over the ${monthDivisor} month${monthDivisor === 1 ? '' : 's'} with spending.`
                          : `Total across ${label}.`}
                      </p>
                    )}
                  </>
                )}
              </Section>

              {/* Structural balance */}
              <Section title="💰 Structural monthly balance">
                {dashboardLoading ? (
                  <Spinner />
                ) : (
                  <div className="rounded-lg border border-[#1e2535] bg-[#111620] px-3.5 py-3 text-sm">
                    <FlowRow
                      label="Avg. income"
                      value={dkk(kpis?.avgMonthlyIncome ?? 0)}
                      valueClass="text-emerald-400"
                      to={drill('All income', { direction: 'income' }, 'inflow')}
                    />
                    <FlowRow
                      label="Avg. expenses"
                      value={dkk(-(kpis?.avgMonthlyExpense ?? 0))}
                      valueClass="text-red-400"
                      to={drill('All spending', { direction: 'expense' }, 'outflow')}
                    />
                    <div className="mt-1.5 border-t border-slate-700 pt-1.5">
                      <FlowRow
                        label="Avg. surplus"
                        value={`${surplusPositive ? '+' : ''}${dkk(kpis?.avgMonthlySurplus ?? 0)}`}
                        valueClass={surplusPositive ? 'text-emerald-400' : 'text-red-400'}
                        bold
                        to={drill('Income and spending', {}, 'net')}
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
                        <Link
                          key={s.key}
                          to={kindDrill(s)}
                          className="flex items-center justify-center first:rounded-l last:rounded-r"
                          style={{ width: `${(s.value / kindTotal) * 100}%`, background: s.color }}
                          title={`${s.label}: ${dkk(s.value)} — click to see the transactions`}
                        >
                          {s.value / kindTotal > 0.11 && (
                            <span className="text-[0.68rem] font-semibold text-white/95">
                              {Math.round((s.value / kindTotal) * 100)}%
                            </span>
                          )}
                        </Link>
                      ))}
                    </div>

                    <dl className="mt-3 space-y-1.5">
                      {kindSlots.map((s) => (
                        <Link
                          key={s.key}
                          to={kindDrill(s)}
                          className="-mx-1 flex items-center gap-2 rounded px-1 text-xs hover:bg-white/[0.04]"
                          title={s.hint}
                        >
                          <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
                          <dt className="flex-1 text-slate-400">{s.label}</dt>
                          <dd className="tabular-nums font-semibold text-slate-200">{dkk(s.value)}</dd>
                          <dd className="w-10 text-right tabular-nums text-slate-600">
                            {Math.round((s.value / kindTotal) * 100)}%
                          </dd>
                        </Link>
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
                      <BarRow
                        key={tag.tagId}
                        labelWidth="w-28"
                        label={tag.name}
                        fraction={tag.total / maxTag}
                        amount={dkk(tag.total)}
                        color={TAG}
                        meta={`${tag.count}×`}
                        metaWidth="w-10"
                        to={drill(tag.name, { tagId: tag.tagId, direction: 'expense' }, 'outflow')}
                        title={`Show the transactions tagged ${tag.name}`}
                      />
                    ))}
                  </div>
                )}
              </Section>
            </div>

            {/* Transactions */}
            <Section
              title="📋 Transactions"
              // Transfers stay listed but marked; scheduled payments aren't listed here at all,
              // so the wording distinguishes them rather than lumping both under "not counted".
              // Both counts open the rows they describe — a figure saying what was left out is
              // no use unless you can see what that was.
              action={
                (dashboard?.excludedTransfers || dashboard?.excludedFuture) ? (
                  <div className="flex flex-wrap items-center gap-3 text-[0.7rem]">
                    {dashboard.excludedTransfers > 0 && (
                      <Link
                        to={drill('Internal transfers', { scope: 'transfers' }, 'net')}
                        className="text-sky-400 hover:underline"
                      >
                        {dashboard.excludedTransfers} transfer legs marked
                      </Link>
                    )}
                    {dashboard.excludedFuture > 0 && (
                      <Link
                        to={drill('Scheduled payments', { scope: 'future' }, 'net')}
                        className="text-amber-400 hover:underline"
                      >
                        {dashboard.excludedFuture} scheduled hidden
                      </Link>
                    )}
                  </div>
                ) : undefined
              }
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

// `to` makes the figure openable — every calculated number on this page has one, so any total
// can be counted rather than taken on trust.
function Kpi({
  label,
  value,
  valueClass,
  sub,
  loading,
  to,
}: {
  label: string
  value: string
  valueClass: string
  sub?: string
  loading?: boolean
  to?: string
}) {
  const body = (
    <>
      <div className="text-[0.68rem] uppercase tracking-wider text-slate-600 mb-1.5">{label}</div>
      <div className={`text-xl font-bold tabular-nums ${valueClass}`}>{loading ? '—' : value}</div>
      {sub && <div className="mt-1 text-[0.68rem] text-slate-600">{sub}</div>}
    </>
  )
  const base = 'block rounded-xl border border-[#232b3b] bg-[#1a1f2e] px-4 py-3.5'

  return to ? (
    <Link
      to={to}
      className={`${base} transition-colors hover:border-slate-600 hover:bg-[#1e2433] focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500`}
      title={`Show the transactions behind ${label.toLowerCase()}`}
    >
      {body}
    </Link>
  ) : (
    <div className={base}>{body}</div>
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

function FlowRow({
  label,
  value,
  valueClass,
  bold,
  to,
}: {
  label: string
  value: string
  valueClass: string
  bold?: boolean
  to?: string
}) {
  const cls = `flex justify-between py-0.5 ${bold ? 'font-bold text-[0.9rem]' : 'text-slate-400'}`
  const body = (
    <>
      <span>{label}</span>
      <span className={valueClass}>{value}</span>
    </>
  )

  return to ? (
    <Link to={to} className={`${cls} -mx-1 rounded px-1 hover:bg-white/[0.04]`} title={`Show the transactions behind ${label.toLowerCase()}`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  )
}

function Spinner() {
  return (
    <div className="flex justify-center py-8">
      <div className="h-6 w-6 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
    </div>
  )
}

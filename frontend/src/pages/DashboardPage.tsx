import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
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
import { ScheduledBadge, TransactionList, TransferBadge } from '../components/TransactionList'
import { BUTTON_PRIMARY, BUTTON_SECONDARY, EmptyState, Kpi, LoadError, PageHeader, Panel, REVEAL_ON_ROW_HOVER, Spinner } from '../components/ui'
import { CashFlowChart } from '../components/CashFlowChart'
import { DailySpendChart } from '../components/DailySpendChart'
import { MonthPaceChart } from '../components/MonthPaceChart'
import { getMonthOutlook } from '../api/month'
import { PeriodNavigator } from '../components/PeriodNavigator'
import { periodLabel, MONTH_NAMES, readPeriod, writePeriod, currentMonth } from '../lib/period'
import { drillTo, type Measure } from '../lib/drill'
import { BarRow } from '../components/BarRow'
import { TAG, EXPENSE, KIND_FIXED, KIND_VARIABLE, KIND_SAVINGS, KIND_DEBT, KIND_NONE, buildCategoryColors } from '../lib/chartColors'
import { getCategories } from '../api/categories'
import { getNetWorthDue } from '../api/networth'
import { NetWorthEntryDialog } from '../components/NetWorthEntryDialog'

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

  const {
    data: dashboard,
    isLoading: dashboardLoading,
    isError: dashboardFailed,
    refetch: refetchDashboard,
    isRefetching: dashboardRefetching,
  } = useQuery({
    queryKey: ['dashboard', accountIdsParam, period],
    queryFn: () => getDashboard(accountIdsParam, period),
    enabled: !noneSelected,
    // Keeps the previous period's numbers on screen while the next load runs, so switching
    // month doesn't blank the whole dashboard.
    placeholderData: (prev) => prev,
  })

  // A month and a year answer different questions. A year is for trends — averages, the shape of
  // each month — which mean nothing over a single month; a month is for "how is this going", which
  // needs a baseline, the bills still to come and an honest estimate of where it ends.
  const isMonth = period.month !== null
  const {
    data: outlook,
    isLoading: outlookLoading,
    isError: outlookFailed,
    refetch: refetchOutlook,
    isRefetching: outlookRefetching,
  } = useQuery({
    queryKey: ['month-outlook', accountIdsParam, period],
    queryFn: () => getMonthOutlook(accountIdsParam, period),
    enabled: !noneSelected && isMonth,
    placeholderData: (prev) => prev,
  })

  const {
    data: txPage,
    isLoading: txLoading,
    isError: txFailed,
    refetch: refetchTx,
    isRefetching: txRefetching,
  } = useQuery({
    queryKey: ['transactions', 1, accountIdsParam, period, 'settled'],
    // includeFuture: false — scheduled payments are excluded from every figure on this page, so
    // listing them here would only invite the question of why they don't add up. They stay
    // visible on the per-account list.
    queryFn: () => getTransactions(1, 50, accountIdsParam, period, false),
    enabled: !noneSelected,
    placeholderData: (prev) => prev,
  })

  // Keyed on the category, not on its rank, so a bar keeps its colour when the period changes
  // and the page it opens is the same colour as the bar that opened it.
  const { data: allCategories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: getCategories,
    staleTime: 5 * 60 * 1000,
  })
  const categoryColors = buildCategoryColors(allCategories)

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

  const typicalOpen = search.get('typical') === 'open'
  const setTypicalOpen = (open: boolean) => update((p) => (open ? p.set('typical', 'open') : p.delete('typical')))

  const [markingTransfer, setMarkingTransfer] = useState<Transaction | null>(null)

  // Net worth is recorded by hand once a month, so the prompt has to appear where the user
  // already is rather than waiting on a page they might not visit.
  const { data: netWorthDue } = useQuery({ queryKey: ['networth-due'], queryFn: getNetWorthDue })
  const [recordingNetWorth, setRecordingNetWorth] = useState(false)

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
    <div>
      <div>
        <PageHeader
          title="Spending"
          sub={txPage ? `${txPage.totalCount} transaction${txPage.totalCount === 1 ? '' : 's'} in ${label}` : label}
        />

        {netWorthDue?.isDue && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-500/40 bg-indigo-500/10 px-4 py-3">
            <div className="text-sm text-indigo-200">
              <span className="font-semibold">
                Record what everything was worth in {MONTH_NAMES[netWorthDue.month - 1]} {netWorthDue.year}.
              </span>{' '}
              <span className="text-indigo-300/80">
                {netWorthDue.missingCount} of {netWorthDue.accountCount} still to go.
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setRecordingNetWorth(true)}
                className={BUTTON_PRIMARY}
              >
                Enter values
              </button>
              <Link
                to="/networth"
                className={BUTTON_SECONDARY}
              >
                Open net worth
              </Link>
            </div>
          </div>
        )}

        {/* Period */}
        <div className="mb-4">
          {/* No "All years" here: every figure on this page is per-period, and an unbounded
              range would make the monthly averages meaningless. */}
          <PeriodNavigator
            period={period}
            onChange={(p) => p && setPeriod(p)}
            availableYears={yearOptions}
          />
        </div>

        {/* Account filter */}
        {accounts.length > 0 && (
          <div className="mb-5 flex flex-wrap items-center gap-2" role="group" aria-label="Accounts included">
            <button
              onClick={() => setSelectedIds(null)}
              aria-pressed={allSelected}
              className={`min-h-8 rounded-full border px-3 py-1 text-xs font-medium transition-colors pointer-coarse:min-h-9 ${
                allSelected
                  ? 'border-indigo-500 bg-indigo-500/20 text-indigo-200'
                  : 'border-slate-700 text-slate-300 hover:bg-[#1a1f2e]'
              }`}
            >
              All accounts
            </button>
            {accounts.map((a) => {
              // Under "All accounts" nothing is individually chosen, so no chip claims to be.
              const active = !allSelected && effectiveSelected.includes(a.id)
              return (
                <button
                  key={a.id}
                  onClick={() => toggleAccount(a.id)}
                  aria-pressed={active}
                  title={a.name}
                  className={`min-h-8 max-w-[16rem] truncate rounded-full border px-3 py-1 text-xs font-medium transition-colors pointer-coarse:min-h-9 ${
                    active
                      ? 'border-indigo-500 bg-indigo-500/20 text-indigo-200'
                      : 'border-slate-700 text-slate-300 hover:bg-[#1a1f2e]'
                  }`}
                >
                  {a.name}
                </button>
              )
            })}
          </div>
        )}

        {noneSelected ? (
          <Panel title={label}>
            <EmptyState title="No accounts selected">
              <button onClick={() => setSelectedIds(null)} className={`${BUTTON_SECONDARY} mt-3`}>
                Include all accounts
              </button>
            </EmptyState>
          </Panel>
        ) : dashboardFailed && !dashboard ? (
          // Without this the panels below read their empty states, and a failed load told you
          // that you had no transactions and should connect a bank.
          <LoadError what="your spending" onRetry={() => refetchDashboard()} retrying={dashboardRefetching} />
        ) : (
          <>
            {/* A year: averages and the shape of each month. Per-month averages are meaningless
                over a single month, where "average" is just that month, so a month gets its own
                tiles below instead. */}
            {!isMonth && (
            <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
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
            )}

            {/* A month: where it stands against a typical one, what is still to come, and where
                it is likely to end. */}
            {isMonth && (
              <>
                {outlookFailed && !outlook ? (
                  <LoadError what={`the outlook for ${label}`} onRetry={() => refetchOutlook()} retrying={outlookRefetching} />
                ) : outlookLoading || !outlook ? (
                  <Panel title={label}>
                    <Spinner />
                  </Panel>
                ) : (
                  <>
                    <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                      <Kpi
                        prominent
                        label={outlook.isFinished ? 'Spent' : 'Spent so far'}
                        value={dkk(outlook.spentSoFar)}
                        valueClass={outlook.spentSoFar > 0 ? 'text-red-400' : 'text-slate-100'}
                        sub={
                          outlook.typical && outlook.isCurrent
                            ? `Typical by day ${outlook.elapsedDays}: ${dkk(outlook.typical.spendByNow)}`
                            : undefined
                        }
                        to={drill('All spending', { direction: 'expense' }, 'outflow')}
                      />
                      {outlook.isCurrent && (
                        <Kpi
                          label="Expected month end"
                          value={outlook.expectedMonthEnd === null ? '—' : dkk(outlook.expectedMonthEnd)}
                          valueClass="text-slate-100"
                          sub={
                            outlook.typical
                              ? `Typical month: ${dkk(outlook.typical.monthSpend)}`
                              : 'Not enough history to estimate'
                          }
                        />
                      )}
                      {outlook.isCurrent && outlook.balance && (
                        <Kpi
                          label="Expected balance, month end"
                          value={outlook.balance.expectedEnd === null ? '—' : dkk(outlook.balance.expectedEnd)}
                          valueClass={
                            outlook.balance.expectedEnd === null
                              ? 'text-slate-100'
                              : outlook.balance.expectedEnd >= 0
                                ? 'text-emerald-400'
                                : 'text-red-400'
                          }
                          sub={
                            outlook.balance.expectedEnd === null
                              ? `Balance now ${dkk(outlook.balance.current)} · not enough history to estimate`
                              : `Now ${dkk(outlook.balance.current)} + ${dkk(outlook.balance.incomeStillToCome ?? 0)} income − ${dkk(outlook.balance.billsStillToCome)} bills − ${dkk(outlook.balance.everydayStillToCome ?? 0)} everyday`
                          }
                          to={drill('Net balance', { scope: 'balance' }, 'net')}
                        />
                      )}
                      <Kpi
                        label="Everyday spending"
                        value={dkk(outlook.everydaySoFar)}
                        valueClass={outlook.everydaySoFar > 0 ? 'text-red-400' : 'text-slate-100'}
                        sub={(() => {
                          if (!outlook.typical || !outlook.isCurrent) return 'Everything except bills'
                          const diff = outlook.everydaySoFar - outlook.typical.everydayByNow
                          if (Math.abs(diff) < 0.5) return 'In line with the usual pace'
                          return diff > 0
                            ? `${dkk(diff)} above the usual pace`
                            : `${dkk(-diff)} below the usual pace`
                        })()}
                        to={drill('Everyday spending', { direction: 'expense', recurring: 'excluded' }, 'outflow')}
                      />
                      {outlook.isCurrent ? (
                        <Kpi
                          label="Bills still to come"
                          value={dkk(outlook.stillToCome.total)}
                          valueClass="text-slate-100"
                          sub={`${outlook.stillToCome.items.length} expected · ${dkk(outlook.billsPaid)} paid so far`}
                        />
                      ) : (
                        <Kpi
                          label="Bills paid"
                          value={dkk(outlook.billsPaid)}
                          valueClass="text-slate-100"
                          to={drill('Bills', { direction: 'expense', recurring: 'only' }, 'outflow')}
                        />
                      )}
                      <Kpi
                        wide={!outlook.isCurrent}
                        label={outlook.isFinished ? 'Income' : 'Income so far'}
                        value={dkk(outlook.incomeSoFar)}
                        valueClass={outlook.incomeSoFar > 0 ? 'text-emerald-400' : 'text-slate-100'}
                        sub={outlook.typical ? `Typical month: ${dkk(outlook.typical.income)}` : undefined}
                        to={drill('All income', { direction: 'income' }, 'inflow')}
                      />
                      {outlook.typical && (
                        <Kpi
                          wide={!outlook.isCurrent}
                          label="Typical month"
                          value={dkk(outlook.typical.monthSpend)}
                          valueClass="text-slate-300"
                          sub={`Middle of the last ${outlook.baselineMonths} month${outlook.baselineMonths === 1 ? '' : 's'}`}
                        />
                      )}
                    </div>

                    {!outlook.hasBaseline && (
                      <p className="mb-5 text-xs text-slate-400">
                        There is no earlier month to compare this one with yet, so nothing here can be called
                        high or low.
                      </p>
                    )}

                    {(outlook.elapsedDays > 0 || outlook.typical) && (
                      <Panel title={`Pace — ${label}`}>
                        <MonthPaceChart
                          cumulative={outlook.cumulative}
                          typical={outlook.typical?.cumulative ?? null}
                          daysInMonth={outlook.daysInMonth}
                          expectedEnd={outlook.expectedMonthEnd}
                        />
                        {outlook.typical && outlook.isCurrent && (
                          <p className="mt-2 text-center text-xs text-slate-400">
                            Compared with the same point in each of the last {outlook.baselineMonths} month
                            {outlook.baselineMonths === 1 ? '' : 's'}, so a bill that always falls early in the
                            month doesn’t count against this one.
                          </p>
                        )}
                      </Panel>
                    )}

                    {outlook.isCurrent && (
                      <Panel
                        title={`Still to come — ${label}`}
                        action={
                          outlook.billsPaid > 0 ? (
                            <Link
                              to={drill('Bills paid so far', { direction: 'expense', recurring: 'only' }, 'outflow')}
                              className="text-xs text-sky-400 hover:underline"
                            >
                              {dkk(outlook.billsPaid)} of bills paid ›
                            </Link>
                          ) : undefined
                        }
                      >
                        {outlook.stillToCome.items.length === 0 ? (
                          <p className="py-4 text-center text-sm text-slate-400">
                            No bills expected for the rest of the month.
                          </p>
                        ) : (
                          <div className="space-y-1">
                            {outlook.stillToCome.items.map((b, i) => (
                              <div
                                key={`${b.merchantKey}-${i}`}
                                className="flex items-center gap-3 rounded py-2"
                              >
                                <span className="w-12 shrink-0 text-xs text-slate-400 tabular-nums">
                                  {(() => {
                                    // Split rather than parsed as a Date, which reads "2026-10-06" as UTC
                                    // midnight and can land on the previous day west of Greenwich.
                                    const [, mo, da] = b.expectedDate.split('-').map(Number)
                                    return `${da} ${MONTH_NAMES[mo - 1]}`
                                  })()}
                                </span>
                                <span className="min-w-0 flex-1 text-sm break-words text-slate-300">
                                  {b.categoryEmoji ? `${b.categoryEmoji} ` : ''}
                                  {b.displayName}
                                  {b.overdue && (
                                    <span
                                      className="ml-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 align-middle text-xs font-medium text-amber-300"
                                      title="Expected by now but not seen yet — banks often post a day or two late"
                                    >
                                      Late
                                    </span>
                                  )}
                                </span>
                                <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-200">
                                  {dkk(b.amount)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                        <p className="mt-3 text-xs text-slate-400">
                          Estimated from charges that repeat on a schedule.{' '}
                          <Link to="/recurring" className="text-sky-400 hover:underline">
                            Correct a wrong one on the Recurring page
                          </Link>
                          .
                        </p>
                      </Panel>
                    )}

                    {/* The typical month is an average, and an average can be wrong in two quiet
                        ways: one enormous month drags it up, or every month is high because
                        savings and loan repayments count. Showing the months and what they are
                        made of lets either be seen rather than taken on trust. */}
                    {outlook.typical && (
                      <details open={typicalOpen} className="mb-4 rounded-xl border border-[#232b3b] bg-[#1a1f2e] p-4 md:p-5">
                        <summary
                          onClick={(e) => {
                            e.preventDefault()
                            setTypicalOpen(!typicalOpen)
                          }}
                          className="cursor-pointer text-sm font-semibold text-slate-200"
                        >
                          What a typical month is made of
                          <span className="ml-2 font-normal text-slate-400 tabular-nums">{dkk(outlook.typical.monthSpend)}</span>
                        </summary>
                        <div className="mt-3">
                        {(() => {
                          const typical = outlook.typical!
                          const maxSpend = Math.max(...typical.months.map((m) => m.spend), 1)
                          const highest = typical.months.reduce((a, b) => (b.spend > a.spend ? b : a))
                          const kindRows = [
                            ...KIND_SLOTS.map((s) => ({
                              key: s.key as string,
                              label: s.label as string,
                              color: s.color as string,
                              value: typical.byKind[s.key],
                            })),
                            { key: 'other', label: 'Other', color: KIND_NONE, value: typical.byKind.other },
                          ].filter((r) => r.value > 0)
                          const maxKind = Math.max(...kindRows.map((r) => r.value), 1)

                          return (
                            <>
                              <div className="flex h-16 items-end gap-1" role="list" aria-label="Spending in each of the months averaged">
                                {typical.months.map((m) => (
                                  <Link
                                    key={`${m.year}-${m.month}`}
                                    role="listitem"
                                    to={drill(
                                      `${MONTH_NAMES[m.month - 1]} ${m.year} spending`,
                                      { direction: 'expense' },
                                      'outflow',
                                      { year: m.year, month: m.month },
                                    )}
                                    className="flex h-full flex-1 flex-col justify-end rounded-t hover:bg-white/[0.04]"
                                    title={`${MONTH_NAMES[m.month - 1]} ${m.year}: ${dkk(m.spend)} — click to see the transactions`}
                                  >
                                    <div
                                      className="w-full rounded-t"
                                      style={{ height: `${(m.spend / maxSpend) * 100}%`, minHeight: m.spend > 0 ? 2 : 0, background: EXPENSE }}
                                    />
                                  </Link>
                                ))}
                              </div>
                              <div className="mt-1 flex gap-1">
                                {typical.months.map((m) => (
                                  <div key={`l-${m.year}-${m.month}`} className="flex-1 text-center text-xs text-slate-400">
                                    {MONTH_NAMES[m.month - 1].slice(0, 1)}
                                  </div>
                                ))}
                              </div>
                              <p className="mt-2 text-xs text-slate-400">
                                Total spending in each of the last {typical.months.length} month
                                {typical.months.length === 1 ? '' : 's'} — tap one to open it. Highest:{' '}
                                <span className="text-slate-300">
                                  {MONTH_NAMES[highest.month - 1]} {highest.year}, {dkk(highest.spend)}
                                </span>
                              </p>

                              <div className="mt-4 space-y-2">
                                {kindRows.map((r) => (
                                  <BarRow
                                    key={r.key}
                                    labelWidth="sm:w-24"
                                    label={r.label}
                                    fraction={r.value / maxKind}
                                    amount={dkk(r.value)}
                                    color={r.color}
                                  />
                                ))}
                              </div>
                              <p className="mt-3 text-xs text-slate-400">
                                A typical month is the middle one of these, {dkk(typical.monthSpend)}, so a single
                                large one-off doesn’t pull it up. The average is {dkk(typical.averageMonthSpend)},
                                and the split above is of the average. Both count everything that leaves your
                                accounts and isn’t a transfer — savings and loan repayments included — so they run
                                higher than a figure for everyday living alone.
                              </p>
                            </>
                          )
                        })()}
                      </div>
                      </details>
                    )}
                  </>
                )}
              </>
            )}

            {/* Daily burn — only over a single month, where "the 3rd" means one day. */}
            {period.month !== null && (dashboard?.dailySpending.length ?? 0) > 0 && (
              <Panel title={`Daily spending — ${label}`}>
                {dashboardLoading ? (
                  <Spinner />
                ) : (
                  <DailySpendChart
                    daily={dashboard!.dailySpending}
                    daysInMonth={dashboard!.daysInMonth}
                    elapsedDays={dashboard!.elapsedDays}
                    onSelectDay={(day) =>
                      navigate(drill(`${label} — day ${day}`, { direction: 'expense', day }, 'outflow'))
                    }
                  />
                )}
              </Panel>
            )}

            {/* Monthly flow — the shape of a year. Over one month it is a single bar. */}
            {!isMonth && (
            <Panel
              title={`Monthly cash flow — ${label}`}
              action={
                <div className="flex rounded-lg border border-slate-700 p-0.5" role="group" aria-label="Cash flow view">
                  {(['chart', 'cards'] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setFlowView(v)}
                      aria-pressed={flowView === v}
                      className={`min-h-7 rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                        flowView === v ? 'bg-[#232b3b] text-slate-200' : 'text-slate-400 hover:text-slate-300'
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
                      <div className="text-xs uppercase text-slate-400 mb-1.5">{MONTH_NAMES[m.month - 1]}</div>
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
                        className={`mt-1 block text-xs font-semibold hover:underline ${m.net >= 0 ? 'text-emerald-400' : 'text-red-400'}`}
                      >
                        {m.net >= 0 ? '+' : ''}
                        {Math.round(m.net).toLocaleString('da-DK')}
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
            )}

            <div className={isMonth ? '' : 'grid grid-cols-1 gap-x-4 lg:grid-cols-2'}>
              {/* Category breakdown */}
              <Panel
                title={`Spending by category — ${label}`}
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
                          className={`min-h-7 rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                            categoryAmounts === v ? 'bg-[#232b3b] text-slate-200' : 'text-slate-400 hover:text-slate-300'
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
                  <p className="text-center text-sm text-slate-400 py-8">No categorized spending yet.</p>
                ) : (
                  <>
                    <div className="space-y-2">
                      {categoryRows.slice(0, 9).map((row) => {
                        const amount = showAverage ? row.total / monthDivisor : row.total
                        return (
                          <BarRow
                            key={row.categoryId ?? 'none'}
                            labelWidth="sm:w-36"
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
                            // Uncategorized has no identity to carry, so it takes the neutral
                            // grey used for "unfiled" throughout.
                            color={(row.categoryId && categoryColors.get(row.categoryId)) || KIND_NONE}
                            meta={<span aria-hidden>›</span>}
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
                      <p className="mt-3 text-xs text-slate-400">
                        {showAverage
                          ? `Per month, averaged over the ${monthDivisor} month${monthDivisor === 1 ? '' : 's'} with spending.`
                          : `Total across ${label}.`}
                      </p>
                    )}
                  </>
                )}
              </Panel>

              {/* Structural balance — averages, so a year's question. */}
              {!isMonth && (
              <Panel title="Structural monthly balance">
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
              </Panel>
              )}
            </div>

            <div className="grid grid-cols-1 gap-x-4 lg:grid-cols-2">
              <Panel title={`Committed vs. discretionary — ${label}`}>
                {dashboardLoading ? (
                  <Spinner />
                ) : kindTotal === 0 ? (
                  <p className="py-8 text-center text-sm text-slate-400">No spending in this period.</p>
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
                            <span className="text-xs font-semibold text-white/95">
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
                          <dd className="w-10 text-right tabular-nums text-slate-400">
                            {Math.round((s.value / kindTotal) * 100)}%
                          </dd>
                        </Link>
                      ))}
                    </dl>
                  </>
                )}
              </Panel>

              <Panel title={`Tags — ${label}`}>
                {dashboardLoading ? (
                  <Spinner />
                ) : tagRows.length === 0 ? (
                  <p className="px-1 py-8 text-center text-sm text-slate-400">
                    No tags yet. Use <span className="text-slate-200">+ tag</span> on a transaction to label it — “Padel”,
                    “Føtex”, “Clara” — and its total shows up here.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {tagRows.slice(0, 9).map((tag) => (
                      <BarRow
                        key={tag.tagId}
                        labelWidth="sm:w-28"
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
              </Panel>
            </div>

            {/* Transactions */}
            <Panel
              title="Transactions"
              // Transfers stay listed but marked; scheduled payments aren't listed here at all,
              // so the wording distinguishes them rather than lumping both under "not counted".
              // Both counts open the rows they describe — a figure saying what was left out is
              // no use unless you can see what that was.
              action={
                (dashboard?.excludedTransfers || dashboard?.excludedFuture) ? (
                  <div className="flex flex-wrap items-center gap-3 text-xs">
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
              {txFailed && !txPage ? (
                <LoadError what="your transactions" onRetry={() => refetchTx()} retrying={txRefetching} />
              ) : txLoading ? (
                <Spinner />
              ) : txPage && txPage.items.length > 0 ? (
                <>
                  <TransactionList
                    items={txPage.items}
                    accountNameById={accountNameById}
                    dimmed={(tx) => tx.isFuture || tx.isTransfer}
                    flags={(tx) => (
                      <>
                        {tx.isFuture && <ScheduledBadge />}
                        {tx.isTransfer ? (
                          <TransferBadge onUndo={tx.isManualTransfer ? () => unmarkTransfer(tx.id) : undefined} />
                        ) : (
                          <button
                            onClick={() => setMarkingTransfer(tx)}
                            className={`rounded-full px-2 py-0.5 text-xs text-slate-400 hover:text-sky-300 ${REVEAL_ON_ROW_HOVER}`}
                            title="Mark as an internal transfer, so it's left out of income and spending"
                          >
                            Mark transfer
                          </button>
                        )}
                      </>
                    )}
                  />
                  {/* The page lists the first 50. Saying so, with the way to the rest, is what
                      stops the list being mistaken for all of them. */}
                  {txPage.totalCount > txPage.items.length && (
                    <p className="mt-3 text-center text-sm text-slate-400">
                      Showing the latest {txPage.items.length} of {txPage.totalCount}.{' '}
                      <Link to={drill(`All transactions, ${label}`, {}, 'net')} className="text-sky-300 hover:underline">
                        See all
                      </Link>
                    </p>
                  )}
                </>
              ) : accounts.length === 0 ? (
                <EmptyState title="No transactions yet">
                  <p>Connect a bank account to start tracking.</p>
                  <Link to="/accounts/connect" className={`${BUTTON_PRIMARY} mt-3`}>
                    Connect a bank
                  </Link>
                </EmptyState>
              ) : (
                <EmptyState title={`No transactions in ${label}`}>
                  Choose another month, or sync your accounts from the Accounts page.
                </EmptyState>
              )}
            </Panel>
          </>
        )}

        {recordingNetWorth && netWorthDue && (
          <NetWorthEntryDialog
            year={netWorthDue.year}
            month={netWorthDue.month}
            onClose={() => setRecordingNetWorth(false)}
            onSaved={() => {}}
          />
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
  const cls = `flex justify-between py-0.5 ${bold ? 'font-bold text-xs' : 'text-slate-400'}`
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


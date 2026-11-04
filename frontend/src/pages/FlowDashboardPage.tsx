import { useQuery } from '@tanstack/react-query'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { getFlowBreakdown, type FlowDirection, type Period, type TransactionQuery } from '../api/transactions'
import { getBankAccounts } from '../api/accounts'
import { MonthBars } from '../components/MonthBars'
import { TransactionList } from '../components/TransactionList'
import { EmptyState, Kpi, LoadError, PageHeader, Panel, Spinner } from '../components/ui'
import { periodLabel, readPeriod, currentMonth } from '../lib/period'
import { drillTo, dashboardLink } from '../lib/drill'
import { BarRow } from '../components/BarRow'
import { INCOME, EXPENSE, KIND_NONE, buildCategoryColors } from '../lib/chartColors'
import { getCategories } from '../api/categories'

const kr = (n: number) =>
  n.toLocaleString('da-DK', { style: 'currency', currency: 'DKK', maximumFractionDigits: 0 })

export function FlowDashboardPage() {
  const { direction: routeDirection } = useParams<{ direction: string }>()
  const [search] = useSearchParams()

  const direction: FlowDirection = routeDirection === 'income' ? 'income' : 'expense'
  const isIncome = direction === 'income'
  const accent = isIncome ? INCOME : EXPENSE
  // The chart colours are for marks. On text they fall short of 4.5:1, so figures take a lighter step of the same hue.
  const accentText = isIncome ? 'text-emerald-400' : 'text-red-400'

  const accountIds = search.getAll('accountIds')
  const period: Period = readPeriod(search) ?? currentMonth()
  const label = periodLabel(period)

  const { data: accounts = [] } = useQuery({ queryKey: ['accounts'], queryFn: getBankAccounts })
  // Same category colours as the dashboard, so the "by category" panel here and the one on the
  // front page are visibly the same breakdown rather than two unrelated charts.
  const { data: allCategories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: getCategories,
    staleTime: 5 * 60 * 1000,
  })
  const categoryColors = buildCategoryColors(allCategories)
  const accountNameById = new Map(accounts.map((a) => [a.id, a.name]))

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
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

  // How this period compares to a typical one. Null when there's only a single month on record,
  // where there is no "typical" yet.
  const average = data?.stats.periodAverage ?? null
  const vsAverage = average && average > 0 && data ? data.total / average - 1 : null

  return (
    <div>
      <div>
        <PageHeader
          title={isIncome ? 'Income' : 'Expenses'}
          back={{ to: dashboardLink(accountIds, period), label: 'Spending' }}
          sub={
            <>
              {label}
              {accountIds.length > 0 && ` · ${accountIds.length} of ${accounts.length} accounts`}
            </>
          }
          aside={
            data && (
              <div className="text-right">
                <div className={`text-2xl font-bold tabular-nums ${accentText}`}>{kr(data.total)}</div>
                {vsAverage !== null && Math.abs(vsAverage) >= 0.005 && (
                  <div className="text-xs text-slate-400">
                    {vsAverage > 0 ? '▲' : '▼'} {Math.abs(vsAverage * 100).toFixed(0)}% vs. the{' '}
                    {kr(average!)} monthly average
                  </div>
                )}
              </div>
            )
          }
        />

        {isLoading ? (
          <Spinner large />
        ) : isError && !data ? (
          <LoadError what={isIncome ? 'your income' : 'your expenses'} onRetry={() => refetch()} retrying={isRefetching} />
        ) : !data || data.items.length === 0 ? (
          <Panel title={label}>
            <EmptyState title={`No ${isIncome ? 'money in' : 'money out'} for ${label}`} />
          </Panel>
        ) : (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Kpi label="Total" value={kr(data.total)} valueClass={accentText} />
              <Kpi label="Transactions" value={String(data.stats.transactionCount)} />
              <Kpi label="Average each" value={kr(data.stats.average)} />
              <Kpi label="Largest single" value={kr(data.stats.largest)} />
            </div>

            {data.monthlyTotals.length > 1 && (
              <Panel title={`${isIncome ? 'Income' : 'Spending'} per month`}>
                <MonthBars
                  data={data.monthlyTotals.map((m) => ({ year: m.year, month: m.month, value: m.total }))}
                  colorOf={() => accent}
                  format={kr}
                  height="h-40"
                />
              </Panel>
            )}

            <Panel title={`By category`}>
              <div className="space-y-1.5">
                {data.byCategory.map((c) => (
                  <BarRow
                    key={c.categoryId ?? 'none'}
                    label={
                      <>
                        {c.emoji && <span className="mr-1">{c.emoji}</span>}
                        {c.name ?? 'Uncategorized'}
                      </>
                    }
                    fraction={c.total / maxCategory}
                    amount={kr(c.total)}
                    color={(c.categoryId && categoryColors.get(c.categoryId)) || KIND_NONE}
                    meta={`${c.count}×`}
                    metaWidth="w-12"
                    // Uncategorized has no category page to open — there is no category behind
                    // it — so it links to the filtered rows instead of nowhere.
                    to={
                      c.categoryId
                        ? `/spending/${c.categoryId}?${search.toString()}`
                        : drill('Uncategorized', { uncategorized: true })
                    }
                    title={c.categoryId ? `Open the ${c.name} breakdown` : 'Show the unfiled transactions'}
                  />
                ))}
              </div>
            </Panel>

            <Panel title={isIncome ? '💼 Where it comes from' : '🏬 Where it goes'}>
              <div className="space-y-1.5">
                {data.bySource.slice(0, 12).map((src) => (
                  <BarRow
                    key={src.merchant}
                    label={src.merchant}
                    fraction={src.total / maxSource}
                    amount={kr(src.total)}
                    color={accent}
                    meta={`${src.count}× · ${kr(src.average)}`}
                    to={drill(src.merchant, { merchant: src.merchant })}
                    title={`Show the ${src.merchant} transactions`}
                  />
                ))}
                {data.bySource.length > 12 && (
                  <p className="pt-1 text-center text-xs text-slate-400">
                    …and {data.bySource.length - 12} more
                  </p>
                )}
              </div>
            </Panel>

            {data.byAccount.length > 1 && (
              <Panel title="By account">
                <div className="flex flex-wrap gap-2">
                  {data.byAccount.map((a) => (
                    <Link
                      key={a.bankAccountId}
                      to={drill(accountNameById.get(a.bankAccountId) ?? 'Account', {}, [a.bankAccountId])}
                      className="rounded-lg border border-[#1e2535] bg-[#111620] px-3 py-2 hover:border-slate-600"
                    >
                      <div className="text-xs text-slate-400">
                        {accountNameById.get(a.bankAccountId) ?? 'Unknown account'}
                      </div>
                      <div className="mt-0.5 text-sm font-semibold tabular-nums text-slate-200">{kr(a.total)}</div>
                      <div className="text-xs text-slate-400">{a.count} transactions</div>
                    </Link>
                  ))}
                </div>
              </Panel>
            )}

            {data.tagBreakdown.length > 0 && (
              <Panel title="By tag">
                <p className="mb-2.5 text-xs text-slate-400">
                  One transaction can carry several tags, so these won't add up to the total.
                </p>
                <div className="flex flex-wrap gap-2">
                  {data.tagBreakdown.map((tag) => (
                    <Link
                      key={tag.tagId}
                      to={drill(tag.name, { tagId: tag.tagId })}
                      className="rounded-lg border border-violet-500/25 bg-violet-500/10 px-3 py-2 hover:border-violet-400/50"
                    >
                      <div className="text-xs font-medium text-violet-300">{tag.name}</div>
                      <div className="mt-0.5 text-sm font-semibold tabular-nums text-slate-200">
                        {kr(Math.abs(tag.total))}
                      </div>
                      <div className="text-xs text-slate-400">{tag.count} transactions</div>
                    </Link>
                  ))}
                </div>
              </Panel>
            )}

            <Panel title="Transactions">
              <TransactionList items={data.items} accountNameById={accountNameById} />
            </Panel>
          </>
        )}
      </div>
    </div>
  )
}

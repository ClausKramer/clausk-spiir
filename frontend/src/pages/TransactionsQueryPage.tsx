import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { runTransactionQuery, type Period, type TransactionQuery } from '../api/transactions'
import { getBankAccounts } from '../api/accounts'
import { MonthBars } from '../components/MonthBars'
import { ScheduledBadge, TransactionList, TransferBadge } from '../components/TransactionList'
import { EmptyState, Kpi, LoadError, PageHeader, Panel, Spinner } from '../components/ui'
import { periodLabel, readPeriod, currentMonth } from '../lib/period'
import { dashboardLink, type Measure } from '../lib/drill'
import { INCOME as POSITIVE, EXPENSE as NEGATIVE } from '../lib/chartColors'


const kr = (n: number) =>
  n.toLocaleString('da-DK', { style: 'currency', currency: 'DKK', maximumFractionDigits: 0 })

// The rows behind a figure the reader clicked. Deliberately generic: every calculated number on
// every page links here with the filters that produced it, rather than each growing a bespoke
// page of its own.
export function TransactionsQueryPage() {
  const [search] = useSearchParams()

  const label = search.get('label') ?? 'Transactions'
  const measure = (search.get('measure') as Measure | null) ?? 'net'
  const accountIds = search.getAll('accountIds')
  const period: Period = readPeriod(search) ?? currentMonth()

  const query: TransactionQuery = {
    scope: (search.get('scope') as TransactionQuery['scope']) ?? 'settled',
    categoryId: search.get('categoryId') ?? undefined,
    uncategorized: search.get('uncategorized') === 'true' || undefined,
    tagId: search.get('tagId') ?? undefined,
    merchant: search.get('merchant') ?? undefined,
    kind: search.get('kind') ?? undefined,
    direction: (search.get('direction') as TransactionQuery['direction']) ?? undefined,
    day: search.get('day') ? Number(search.get('day')) : undefined,
    recurring: (search.get('recurring') as TransactionQuery['recurring']) ?? undefined,
  }

  const { data: accounts = [] } = useQuery({ queryKey: ['accounts'], queryFn: getBankAccounts })
  const accountNameById = new Map(accounts.map((a) => [a.id, a.name]))

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['query', query, accountIds, period],
    queryFn: () => runTransactionQuery(query, accountIds, period),
  })

  // The headline is whichever measure the figure meant — showing net where the reader clicked a
  // spending total would contradict the number they came from.
  const headline = data ? (measure === 'inflow' ? data.inflow : measure === 'outflow' ? data.outflow : data.net) : 0
  const headlineClass = measure === 'inflow' || (measure === 'net' && headline >= 0) ? 'text-emerald-400' : 'text-red-400'

  const scopeNote =
    query.scope === 'transfers'
      ? 'These are the internal transfers left out of income and spending — each has a matching leg in another of your accounts.'
      : query.scope === 'future'
        ? "These are payments the bank has scheduled but not yet made. They're excluded from every total."
        : query.scope === 'balance'
          ? 'Everything that has actually moved, up to today — transfers included, since a matched pair nets to zero and the money is still where it ended up.'
          : null

  return (
    <div>
      <div>
        <PageHeader
          title={label}
          back={{ to: dashboardLink(accountIds, period), label: 'Spending' }}
          sub={
            <>
              {query.scope === 'balance' ? 'All history to today' : periodLabel(period)}
              {accountIds.length > 0 && ` · ${accountIds.length} of ${accounts.length} accounts`}
              {data && ` · ${data.count} transaction${data.count === 1 ? '' : 's'}`}
            </>
          }
          aside={data && <div className={`text-2xl font-bold tabular-nums ${headlineClass}`}>{kr(headline)}</div>}
        />

        {scopeNote && (
          <p className="mb-5 rounded-lg border border-[#232b3b] bg-[#1a1f2e] px-4 py-3 text-xs text-slate-400">
            {scopeNote}
          </p>
        )}

        {isLoading ? (
          <Spinner large />
        ) : isError && !data ? (
          <LoadError what="these transactions" onRetry={() => refetch()} retrying={isRefetching} />
        ) : !data || data.items.length === 0 ? (
          <Panel title={periodLabel(period)}>
            <EmptyState title={`No transactions match “${label}” for this period`} />
          </Panel>
        ) : (
          <>
            {/* All three sides shown regardless of which one the figure meant: a total that
                nets two directions is much easier to trust when both are visible. */}
            <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Kpi label="Money in" value={kr(data.inflow)} valueClass={data.inflow > 0 ? 'text-emerald-400' : undefined} />
              <Kpi label="Money out" value={kr(data.outflow)} valueClass={data.outflow > 0 ? 'text-red-400' : undefined} />
              <Kpi label="Net" value={kr(data.net)} valueClass={data.net >= 0 ? 'text-emerald-400' : 'text-red-400'} />
              <Kpi label="Transactions" value={String(data.count)} />
            </div>

            {data.monthlyTotals.length > 1 && (
              <Panel title="Per month">
                <MonthBars
                  data={data.monthlyTotals.map((m) => ({ year: m.year, month: m.month, value: m.net }))}
                  colorOf={(b) => (b.value >= 0 ? POSITIVE : NEGATIVE)}
                  format={kr}
                  height="h-32"
                />
                <div className="mt-2 flex items-center gap-3 text-xs text-slate-400">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-sm" style={{ background: POSITIVE }} /> Net in
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-sm" style={{ background: NEGATIVE }} /> Net out
                  </span>
                </div>
              </Panel>
            )}

            <Panel title="Transactions">
              <TransactionList items={data.items} accountNameById={accountNameById} flags={(tx) => (
                  <>
                    {tx.isFuture && <ScheduledBadge />}
                    {tx.isTransfer && <TransferBadge />}
                  </>
                )} />
            </Panel>
          </>
        )}
      </div>
    </div>
  )
}

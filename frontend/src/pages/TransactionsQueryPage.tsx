import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { runTransactionQuery, type Period, type TransactionQuery } from '../api/transactions'
import { getBankAccounts } from '../api/accounts'
import { CategoryPicker } from '../components/CategoryPicker'
import { TagEditor } from '../components/TagEditor'
import { MONTH_NAMES, periodLabel, readPeriod, currentMonth } from '../lib/period'
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

  const { data, isLoading } = useQuery({
    queryKey: ['query', query, accountIds, period],
    queryFn: () => runTransactionQuery(query, accountIds, period),
  })

  // The headline is whichever measure the figure meant — showing net where the reader clicked a
  // spending total would contradict the number they came from.
  const headline = data ? (measure === 'inflow' ? data.inflow : measure === 'outflow' ? data.outflow : data.net) : 0
  const headlineColor = measure === 'inflow' ? POSITIVE : measure === 'outflow' ? NEGATIVE : headline >= 0 ? POSITIVE : NEGATIVE

  const maxMonth = Math.max(...(data?.monthlyTotals.map((m) => Math.abs(m.net)) ?? [0]), 1)
  const scopeNote =
    query.scope === 'transfers'
      ? 'These are the internal transfers left out of income and spending — each has a matching leg in another of your accounts.'
      : query.scope === 'future'
        ? "These are payments the bank has scheduled but not yet made. They're excluded from every total."
        : query.scope === 'balance'
          ? 'Everything that has actually moved, up to today — transfers included, since a matched pair nets to zero and the money is still where it ended up.'
          : null

  return (
    <div className="min-h-screen bg-[#0f1117] px-4 py-6 text-slate-200 md:px-8 md:py-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <Link to={dashboardLink(accountIds, period)} className="text-xs text-slate-500 hover:text-slate-300">
              ← Dashboard
            </Link>
            <h1 className="mt-1 text-xl font-bold text-slate-50">{label}</h1>
            <p className="mt-0.5 text-xs text-slate-500">
              {query.scope === 'balance' ? 'All history to today' : periodLabel(period)}
              {accountIds.length > 0 && ` · ${accountIds.length} of ${accounts.length} accounts`}
              {data && ` · ${data.count} transaction${data.count === 1 ? '' : 's'}`}
            </p>
          </div>
          {data && (
            <div className="text-2xl font-bold tabular-nums" style={{ color: headlineColor }}>
              {kr(headline)}
            </div>
          )}
        </div>

        {scopeNote && (
          <p className="mb-5 rounded-lg border border-[#232b3b] bg-[#1a1f2e] px-4 py-3 text-xs text-slate-400">
            {scopeNote}
          </p>
        )}

        {isLoading ? (
          <div className="flex justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
          </div>
        ) : !data || data.items.length === 0 ? (
          <Panel title="Nothing here">
            <p className="py-6 text-center text-sm text-slate-500">
              No transactions match {label.toLowerCase()} for this period.
            </p>
          </Panel>
        ) : (
          <>
            {/* All three sides shown regardless of which one the figure meant: a total that
                nets two directions is much easier to trust when both are visible. */}
            <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Kpi label="Money in" value={kr(data.inflow)} color={data.inflow > 0 ? POSITIVE : undefined} />
              <Kpi label="Money out" value={kr(data.outflow)} color={data.outflow > 0 ? NEGATIVE : undefined} />
              <Kpi label="Net" value={kr(data.net)} color={data.net >= 0 ? POSITIVE : NEGATIVE} />
              <Kpi label="Transactions" value={String(data.count)} />
            </div>

            {data.monthlyTotals.length > 1 && (
              <Panel title="📅 Per month">
                <div className="flex h-32 items-end gap-1.5">
                  {data.monthlyTotals.map((m) => (
                    <div
                      key={`${m.year}-${m.month}`}
                      className="group relative flex h-full flex-1 flex-col justify-end"
                      title={`${MONTH_NAMES[m.month - 1]}: ${kr(m.net)}`}
                    >
                      <span className="absolute inset-x-0 -top-1 text-center text-[0.6rem] tabular-nums text-slate-400 opacity-0 transition-opacity group-hover:opacity-100">
                        {m.net !== 0 ? Math.round(m.net).toLocaleString('da-DK') : ''}
                      </span>
                      <div
                        className="w-full rounded-t"
                        style={{
                          height: `${(Math.abs(m.net) / maxMonth) * 100}%`,
                          minHeight: m.net !== 0 ? 2 : 0,
                          background: m.net >= 0 ? POSITIVE : NEGATIVE,
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
                <div className="mt-2 flex items-center gap-3 text-[0.65rem] text-slate-500">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-sm" style={{ background: POSITIVE }} /> Net in
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-sm" style={{ background: NEGATIVE }} /> Net out
                  </span>
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
                          {tx.isFuture && (
                            <span className="ml-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 align-middle text-[0.62rem] font-medium uppercase tracking-wide text-amber-400">
                              Scheduled
                            </span>
                          )}
                          {tx.isTransfer && (
                            <span className="ml-2 rounded-full border border-sky-500/40 bg-sky-500/10 px-1.5 py-0.5 align-middle text-[0.62rem] font-medium uppercase tracking-wide text-sky-400">
                              Transfer
                            </span>
                          )}
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
                          className={`py-2 pl-3 text-right font-semibold tabular-nums ${
                            tx.amount < 0 ? 'text-red-400' : 'text-emerald-400'
                          }`}
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

function Kpi({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-xl border border-[#232b3b] bg-[#1a1f2e] px-3.5 py-3">
      <div className="text-[0.62rem] uppercase tracking-wider text-slate-600">{label}</div>
      <div className="mt-1 text-lg font-bold tabular-nums" style={color ? { color } : undefined}>
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

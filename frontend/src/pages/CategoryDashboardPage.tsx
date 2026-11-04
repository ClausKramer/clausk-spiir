import { useQuery } from '@tanstack/react-query'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { getTransactionsByCategory, type Period, type TransactionQuery } from '../api/transactions'
import { getBankAccounts } from '../api/accounts'
import { getCategories } from '../api/categories'
import { MonthBars } from '../components/MonthBars'
import { TransactionList } from '../components/TransactionList'
import { EmptyState, Kpi, LoadError, PageHeader, Panel, Spinner } from '../components/ui'
import { readPeriod, currentMonth, periodLabel } from '../lib/period'
import { drillTo, dashboardLink } from '../lib/drill'
import { BarRow } from '../components/BarRow'
import { INCOME, NEUTRAL, SURFACE, KIND_NONE, buildCategoryColors } from '../lib/chartColors'

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
  const period: Period = readPeriod(search) ?? currentMonth()
  const label = periodLabel(period)

  const { data: accounts = [] } = useQuery({ queryKey: ['accounts'], queryFn: getBankAccounts })
  const { data: categories = [] } = useQuery({ queryKey: ['categories'], queryFn: getCategories })
  const accountNameById = new Map(accounts.map((a) => [a.id, a.name]))

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['by-category', categoryId, accountIds, period],
    queryFn: () => getTransactionsByCategory(categoryId, accountIds, period),
  })

  // The colour of the bar that opened this page, so the connection is visible rather than
  // something the reader has to take on trust.
  const categoryColors = buildCategoryColors(categories)
  const accent = (categoryId && categoryColors.get(categoryId)) || KIND_NONE

  const category = categories.find((c) => c.id === categoryId)
  const title = categoryId === null ? 'Uncategorized' : `${category?.emoji ?? ''} ${category?.name ?? 'Category'}`.trim()

  // Preserve the dashboard's filters when going back, so the user returns to the view they left.
  const backTo = dashboardLink(accountIds, period)

  // Every figure on this page opens the rows behind it, always narrowed to this category (or to
  // uncategorized) so a merchant or tag total means "within this category", matching the number
  // shown. `accountOverride` is for the per-account cards, which narrow further to one account.
  const drill = (
    text: string,
    query: TransactionQuery,
    accountOverride?: string[],
  ) => drillTo(text, query, accountOverride ?? accountIds, period, { measure: 'outflow' })

  // Scaled on magnitude, not value: a month or merchant that nets negative (refunds outweighing
  // charges) still needs a bar proportional to how much moved, drawn in the refund colour.
  const maxMerchant = Math.max(...(data?.merchants.map((m) => Math.abs(m.total)) ?? [0]), 1)
  const maxChild = Math.max(...(data?.childBreakdown.map((c) => Math.abs(c.total)) ?? [0]), 1)
  const recurringShare = data && data.total > 0 ? data.stats.recurringTotal / data.total : 0

  return (
    <div>
      <div>
        <PageHeader
          title={title}
          back={{ to: backTo, label: 'Spending' }}
          sub={
            <>
              {label}
              {accountIds.length > 0 && <> · {accountIds.length} of {accounts.length} accounts</>}
            </>
          }
          aside={
            data && (
              <div className="text-right">
                <div className={`text-2xl font-bold tabular-nums ${data.total >= 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                  {kr(data.total)}
                </div>
                {data.refundTotal > 0 && (
                  <div className="mt-0.5 text-xs text-slate-400">
                    {kr(data.spendTotal)} spent − {kr(data.refundTotal)} refunded
                  </div>
                )}
              </div>
            )
          }
        />

        {isLoading ? (
          <Spinner large />
        ) : isError && !data ? (
          <LoadError what="this category" onRetry={() => refetch()} retrying={isRefetching} />
        ) : !data || data.stats.transactionCount === 0 ? (
          <Panel title={label}>
            <EmptyState title={`Nothing spent in this category for ${label}`} />
          </Panel>
        ) : (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Kpi label="Per month" value={kr(data.stats.averagePerMonth)} sub={`over ${data.stats.monthsWithData} month${data.stats.monthsWithData === 1 ? '' : 's'} with activity`} />
              <Kpi label="Share of all spending" value={`${(data.stats.shareOfSpending * 100).toFixed(1)}%`} />
              <Kpi
                label="Transactions"
                value={String(data.stats.transactionCount)}
                sub={
                  data.stats.refundCount > 0
                    ? `incl. ${data.stats.refundCount} refund${data.stats.refundCount === 1 ? '' : 's'}`
                    : `${kr(data.stats.averageTransaction)} average`
                }
              />
              <Kpi label="Largest single" value={kr(data.stats.largest)} />
            </div>

            {/* Recurring vs one-off: the most actionable split in a category — standing costs are
                what you can renegotiate or cancel, one-offs mostly aren't. */}
            {recurringShare > 0 && (
              <Panel title="Recurring vs one-off">
                {/* Segments are rendered only when they have width. At 100% recurring, a
                    flex-1 sibling would still claim a sliver and imply a one-off share that
                    isn't there. */}
                <div className="flex h-6 overflow-hidden rounded">
                  {recurringShare > 0 && (
                    <div
                      className="flex items-center justify-center text-xs font-semibold text-white/95"
                      style={{ width: `${recurringShare * 100}%`, background: accent }}
                    >
                      {recurringShare > 0.12 && `${Math.round(recurringShare * 100)}%`}
                    </div>
                  )}
                  {recurringShare > 0 && recurringShare < 1 && <div className="w-0.5 shrink-0" style={{ background: SURFACE }} />}
                  {recurringShare < 1 && (
                    <div
                      className="flex items-center justify-center text-xs font-semibold text-white/95"
                      style={{ width: `${(1 - recurringShare) * 100}%`, background: NEUTRAL }}
                    >
                      {1 - recurringShare > 0.12 && `${Math.round((1 - recurringShare) * 100)}%`}
                    </div>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap justify-center gap-4 text-xs text-slate-400">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: accent }} />
                    Recurring {kr(data.stats.recurringTotal)}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: NEUTRAL }} />
                    One-off {kr(data.total - data.stats.recurringTotal)}
                  </span>
                </div>
                <p className="mt-2 text-center text-xs text-slate-400">
                  Recurring = seen in most months of this period. Useful for spotting standing costs.
                </p>
              </Panel>
            )}

            {data.monthlyTotals.length > 1 && (
              <Panel title={`Spend per month — ${label}`}>
                {/* Plot area and labels are separate rows sharing the same flex layout. The plot
                    row carries a definite height so the bars' percentage heights have something
                    to resolve against — nesting them under an items-end container sizes each
                    column to its content instead, and the percentages silently collapse. */}
                <MonthBars
                  data={data.monthlyTotals.map((m) => ({ year: m.year, month: m.month, value: m.total }))}
                  colorOf={(b) => (b.value < 0 ? INCOME : accent)}
                  format={kr}
                  height="h-32"
                />
              </Panel>
            )}

            {/* A breakdown into one part says nothing the total didn't already — and the
                merchant panel below is the more useful split at that point. */}
            {data.childBreakdown.length > 1 && (
              <Panel title="Broken down">
                <div className="space-y-1.5">
                  {data.childBreakdown.map((child) => (
                    <BarRow
                      key={child.categoryId ?? 'self'}
                      label={
                        <>
                          {child.emoji && <span className="mr-1">{child.emoji}</span>}
                          {child.name}
                        </>
                      }
                      // Magnitude, not value: a leaf that nets negative (refunds outweighing
                      // charges) still needs a bar proportional to how much moved, drawn in
                      // the refund colour.
                      fraction={Math.abs(child.total) / maxChild}
                      amount={kr(child.total)}
                      color={child.total < 0 ? INCOME : accent}
                      meta={`${child.count}×`}
                      metaWidth="w-12"
                      to={child.categoryId ? `/spending/${child.categoryId}?${search.toString()}` : undefined}
                      title={child.categoryId ? `Open the ${child.name} breakdown` : 'Filed on the group itself'}
                    />
                  ))}
                </div>
              </Panel>
            )}

            <Panel title="Where it goes">
              <div className="space-y-1.5">
                {data.merchants.slice(0, 12).map((m) => (
                  <BarRow
                    key={m.merchant}
                    label={
                      <>
                        {m.merchant}
                        {m.isRecurring && (
                          <span className="ml-1 text-xs text-amber-500" title="Appears in most months of this period">🔁</span>
                        )}
                      </>
                    }
                    fraction={Math.abs(m.total) / maxMerchant}
                    amount={kr(m.total)}
                    color={m.total < 0 ? INCOME : accent}
                    meta={
                      <>
                        {m.count}× · {kr(m.average)}
                        {m.refundTotal > 0 && (
                          <span className="ml-1 text-emerald-500" title={`${kr(m.refundTotal)} refunded`}>↩</span>
                        )}
                      </>
                    }
                    metaWidth="w-28"
                    to={drill(m.merchant, { merchant: m.merchant, categoryId: categoryId ?? undefined, uncategorized: categoryId === null })}
                    title={`Show the ${m.merchant} transactions in this category`}
                  />
                ))}
                {data.merchants.length > 12 && (
                  <p className="pt-1 text-center text-xs text-slate-400">…and {data.merchants.length - 12} more</p>
                )}
              </div>
            </Panel>

            {data.byAccount.length > 1 && (
              <Panel title="By account">
                <div className="flex flex-wrap gap-2">
                  {data.byAccount.map((a) => (
                    <Link
                      key={a.bankAccountId}
                      to={drill(accountNameById.get(a.bankAccountId) ?? 'Account', { categoryId: categoryId ?? undefined, uncategorized: categoryId === null }, [a.bankAccountId])}
                      className="rounded-lg border border-[#1e2535] bg-[#111620] px-3 py-2 hover:border-slate-600"
                    >
                      <div className="text-xs text-slate-400">{accountNameById.get(a.bankAccountId) ?? 'Unknown account'}</div>
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
                  Tags cut across categories, and one transaction can carry several, so these won't add up to the total.
                </p>
                <div className="flex flex-wrap gap-2">
                  {data.tagBreakdown.map((tag) => (
                    <Link
                      key={tag.tagId}
                      to={drill(tag.name, { tagId: tag.tagId, categoryId: categoryId ?? undefined, uncategorized: categoryId === null })}
                      className="rounded-lg border border-violet-500/25 bg-violet-500/10 px-3 py-2 hover:border-violet-400/50"
                    >
                      <div className="text-xs font-medium text-violet-300">{tag.name}</div>
                      <div className="mt-0.5 text-sm font-semibold tabular-nums text-slate-200">{kr(tag.total)}</div>
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

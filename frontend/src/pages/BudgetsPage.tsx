import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { getBudgetDashboard, setBudget, type BudgetGroup } from '../api/budgets'
import { getCategories } from '../api/categories'
import { readPeriod, writePeriod, currentMonth, MONTH_NAMES } from '../lib/period'
import type { Period } from '../api/transactions'
import { drillTo } from '../lib/drill'
import { buildCategoryColors, EXPENSE, NEUTRAL } from '../lib/chartColors'
import { BUTTON_PRIMARY, BUTTON_SMALL, EmptyState, INPUT, Kpi, LoadError, PageHeader, Panel, Spinner } from '../components/ui'

const kr = (n: number) =>
  n.toLocaleString('da-DK', { style: 'currency', currency: 'DKK', maximumFractionDigits: 0 })

// Budgets are inherently monthly, unlike net worth's year/lifetime scope — there's no "budget
// for the whole year" concept here, so a resolved period with no month falls back to this month
// rather than offering a year view that wouldn't mean anything.
function resolveMonth(search: URLSearchParams): Period {
  const period = readPeriod(search)
  return period?.month ? { year: period.year, month: period.month } : currentMonth()
}

function shiftMonth(period: Period, delta: number): Period {
  const d = new Date(period.year, (period.month ?? 1) - 1 + delta, 1)
  return { year: d.getFullYear(), month: d.getMonth() + 1 }
}

export function BudgetsPage() {
  const [search, setSearch] = useSearchParams()
  const update = (mutate: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(search)
    mutate(next)
    setSearch(next, { replace: true })
  }

  const period = resolveMonth(search)
  const setPeriod = (next: Period) => update((p) => writePeriod(p, next))

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['budget-dashboard', period.year, period.month],
    queryFn: () => getBudgetDashboard(period.year, period.month ?? undefined),
    placeholderData: (prev) => prev,
  })
  const { data: categories = [] } = useQuery({ queryKey: ['categories'], queryFn: getCategories })
  const categoryColors = buildCategoryColors(categories)

  const drill = (group: BudgetGroup) =>
    drillTo(group.categoryName, { categoryId: group.categoryId, direction: 'expense' }, [], period, { measure: 'outflow' })

  return (
    <div>
      <div>
        <PageHeader
          title="Budgets"
          sub="Monthly limits, against what you actually spend"
          aside={
            <div className="flex items-center gap-1">
              <button onClick={() => setPeriod(shiftMonth(period, -1))} className={`${BUTTON_SMALL} min-w-9`} aria-label="Previous month">
                ‹
              </button>
              <span className="min-w-20 text-center text-sm font-medium text-slate-200 tabular-nums">
                {MONTH_NAMES[period.month! - 1]} {period.year}
              </span>
              <button onClick={() => setPeriod(shiftMonth(period, 1))} className={`${BUTTON_SMALL} min-w-9`} aria-label="Next month">
                ›
              </button>
            </div>
          }
        />

        {isLoading ? (
          <Spinner large />
        ) : isError && !data ? (
          <LoadError what="your budgets" onRetry={() => refetch()} retrying={isRefetching} />
        ) : (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3">
              <Kpi label="Budgeted per month" value={kr(data!.totalLimit)} />
              <Kpi
                label="Spent this month"
                value={kr(data!.totalActual)}
                valueClass={data!.totalLimit > 0 && data!.totalActual > data!.totalLimit ? 'text-red-400' : undefined}
              />
              {/* The number to judge "am I on track" by: a quarterly or yearly bill landing in
                  one month spikes "This month", but it averages out here. */}
              <Kpi
                className="col-span-2 md:col-span-1"
                label="Typical month"
                sub="Over the last 12 months"
                value={kr(data!.totalAverage)}
                valueClass={data!.totalLimit > 0 && data!.totalAverage > data!.totalLimit ? 'text-red-400' : undefined}
              />
            </div>

            <Panel title="By category">
              {!data!.hasAnyBudgets && (
                <p className="mb-4 text-sm text-slate-400">
                  No limits set yet — enter a monthly limit next to any category below. Each one is
                  also shown against its typical month over the last year, so a quarterly or yearly
                  bill landing in one month isn't mistaken for overspending.
                </p>
              )}
              {data!.groups.length === 0 && (
                <EmptyState title="No categories to budget yet">Categories appear here once you've connected a bank.</EmptyState>
              )}
              <div className="space-y-4">
                {data!.groups.map((g) => (
                  <BudgetRow
                    key={g.categoryId}
                    group={g}
                    color={categoryColors.get(g.categoryId) ?? NEUTRAL}
                    to={drill(g)}
                  />
                ))}
              </div>
            </Panel>
          </>
        )}
      </div>
    </div>
  )
}

// Not BarRow — that encodes a ranked list's "share of the largest," but this is a single
// category's own fraction of its own limit. Filled in the category's own colour up to the limit;
// any spend past it draws as a red overflow segment, the same "red = bad direction" convention
// as net worth's change indicators, not a new rank-based rule.
//
// Each row owns its own save so a failure surfaces right where it happened and the typed value
// is never lost — an earlier version closed the editor and reverted to the old value the instant
// you pressed Enter, before the request even resolved, so a failed save looked identical to a
// successful one that silently did nothing.
function BudgetRow({ group, color, to }: { group: BudgetGroup; color: string; to: string }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(group.limit === null ? '' : String(group.limit))

  const { mutate: save, isPending: saving, error, reset } = useMutation({
    mutationFn: (limit: number | null) => setBudget(group.categoryId, limit),
    onSuccess: () => {
      setEditing(false)
      qc.invalidateQueries({ queryKey: ['budget-dashboard'] })
    },
  })

  const limit = group.limit
  const fraction = limit && limit > 0 ? Math.min(group.actual / limit, 1) : 0
  const overflowFraction = limit && limit > 0 && group.actual > limit ? Math.min((group.actual - limit) / limit, 1) : 0
  const over = limit !== null && group.actual > limit
  // Over this month, but an ordinary month would have been fine: the case a lumpy charge
  // produces, and the one that shouldn't read as "behind budget".
  const withinOnAverage = over && group.average !== null && group.average <= limit!

  const startEditing = () => {
    reset()
    setDraft(group.limit === null ? '' : String(group.limit))
    setEditing(true)
  }

  const commit = () => {
    const trimmed = draft.trim()
    save(trimmed === '' ? null : Number(trimmed))
  }

  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
        <Link to={to} className="min-w-0 flex-1 basis-32 truncate text-slate-200 hover:text-slate-50">
          {group.categoryEmoji} {group.categoryName}
        </Link>
        <span className={`order-3 basis-full tabular-nums sm:order-none sm:shrink-0 sm:basis-auto ${over ? 'text-red-400' : 'text-slate-300'}`}>
          {kr(group.actual)}
          {limit !== null && <span className="text-slate-400"> of {kr(limit)}</span>}
        </span>
        {editing ? (
          <div className="flex shrink-0 items-center gap-1">
            <input
              autoFocus
              type="number"
              inputMode="decimal"
              aria-label={`Monthly limit for ${group.categoryName}`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit()
                if (e.key === 'Escape') {
                  reset()
                  setEditing(false)
                }
              }}
              placeholder="No limit"
              className={`${INPUT} w-24 text-right`}
            />
            <button
              onClick={commit}
              disabled={saving}
              className={BUTTON_PRIMARY}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => {
                reset()
                setEditing(false)
              }}
              className={BUTTON_SMALL}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={startEditing}
            className={`${BUTTON_SMALL} shrink-0`}
            aria-label={`${limit === null ? 'Set limit for' : 'Edit limit for'} ${group.categoryName}`}
          >
            {limit === null ? 'Set limit' : 'Edit'}
          </button>
        )}
      </div>
      {error && (
        <p className="mb-1 text-xs text-red-400" role="alert">
          Couldn't save — the request failed. Your typed value is still here; try again.
        </p>
      )}
      <div className="flex h-2 overflow-hidden rounded-full bg-[#111620]">
        {fraction > 0 && <div style={{ width: `${fraction * 100}%`, background: color }} />}
        {overflowFraction > 0 && <div style={{ width: `${overflowFraction * 100}%`, background: EXPENSE }} />}
      </div>
      {group.average !== null && (group.average > 0 || group.actual > 0) && (
        <p className="mt-1 text-xs text-slate-400">
          Typical month {kr(group.average)}
          {group.unusual && (
            <span>
              {' '}
              · higher than usual this month — likely a quarterly or yearly charge
            </span>
          )}
          {withinOnAverage && <span> · within budget in a typical month</span>}
        </p>
      )}
    </div>
  )
}

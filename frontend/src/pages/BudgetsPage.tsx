import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { getBudgetDashboard, setBudget, type BudgetGroup } from '../api/budgets'
import { getCategories } from '../api/categories'
import { readPeriod, writePeriod, currentMonth, MONTH_NAMES } from '../lib/period'
import type { Period } from '../api/transactions'
import { drillTo } from '../lib/drill'
import { buildCategoryColors, EXPENSE, NEUTRAL } from '../lib/chartColors'

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
    <div className="min-h-screen bg-[#0f1117] px-4 py-6 text-slate-200 md:px-8 md:py-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link to="/dashboard" className="text-xs text-slate-500 hover:text-slate-300">
              ← Spending
            </Link>
            <h1 className="mt-1 text-xl font-bold text-slate-50">🎯 Budgets</h1>
            <p className="mt-0.5 text-xs text-slate-500">
              {MONTH_NAMES[period.month! - 1]} {period.year}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPeriod(shiftMonth(period, -1))}
              className="rounded-lg border border-slate-700 bg-[#1a1f2e] px-2.5 py-1.5 text-xs text-slate-300 hover:bg-[#232b3b]"
              aria-label="Previous month"
            >
              ←
            </button>
            <button
              onClick={() => setPeriod(shiftMonth(period, 1))}
              className="rounded-lg border border-slate-700 bg-[#1a1f2e] px-2.5 py-1.5 text-xs text-slate-300 hover:bg-[#232b3b]"
              aria-label="Next month"
            >
              →
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
          </div>
        ) : isError && !data ? (
          <Panel title="Couldn't load budgets">
            <div className="py-8 text-center">
              <div className="mb-2 text-3xl">⚠️</div>
              <p className="text-slate-400">The request failed — your budgets haven't gone anywhere.</p>
              <button
                onClick={() => refetch()}
                disabled={isRefetching}
                className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {isRefetching ? 'Retrying…' : 'Try again'}
              </button>
            </div>
          </Panel>
        ) : (
          <>
            <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3">
              <Kpi label="Budgeted" sub="per month" value={kr(data!.totalLimit)} />
              <Kpi
                label="This month"
                value={kr(data!.totalActual)}
                color={data!.totalLimit > 0 && data!.totalActual > data!.totalLimit ? EXPENSE : undefined}
              />
              {/* The number to judge "am I on track" by: a quarterly or yearly bill landing in
                  one month spikes "This month", but it averages out here. */}
              <Kpi
                label="Typical month"
                sub="last 12 months"
                value={kr(data!.totalAverage)}
                color={data!.totalLimit > 0 && data!.totalAverage > data!.totalLimit ? EXPENSE : undefined}
              />
            </div>

            <Panel title="By category">
              {!data!.hasAnyBudgets && (
                <p className="mb-4 text-sm text-slate-500">
                  No limits set yet — enter a monthly limit next to any category below. Each one is
                  also shown against its typical month over the last year, so a quarterly or yearly
                  bill landing in one month isn't mistaken for overspending.
                </p>
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
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-sm">
        <Link to={to} className="min-w-0 flex-1 truncate text-slate-200 hover:text-slate-50">
          {group.categoryEmoji} {group.categoryName}
        </Link>
        <span className="shrink-0 tabular-nums" style={{ color: over ? EXPENSE : '#94a3b8' }}>
          {kr(group.actual)}
          {limit !== null && <span className="text-slate-600"> / {kr(limit)}</span>}
        </span>
        {editing ? (
          <div className="flex shrink-0 items-center gap-1">
            <input
              autoFocus
              type="number"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && commit()}
              placeholder="No limit"
              className="w-24 rounded border border-indigo-500 bg-[#111620] px-2 py-0.5 text-right text-xs text-slate-200 outline-none"
            />
            <button
              onClick={commit}
              disabled={saving}
              className="rounded bg-indigo-600 px-2 py-0.5 text-[0.65rem] font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => {
                reset()
                setEditing(false)
              }}
              className="rounded border border-slate-700 px-2 py-0.5 text-[0.65rem] text-slate-400 hover:bg-[#232b3b]"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={startEditing}
            className="shrink-0 rounded border border-slate-700 px-2 py-0.5 text-[0.65rem] text-slate-400 hover:bg-[#232b3b]"
          >
            {limit === null ? 'Set limit' : 'Edit'}
          </button>
        )}
      </div>
      {error && (
        <p className="mb-1 text-[0.68rem]" style={{ color: EXPENSE }}>
          Couldn't save — the request failed. Your typed value is still here; try again.
        </p>
      )}
      <div className="flex h-2 overflow-hidden rounded-full bg-[#111620]">
        {fraction > 0 && <div style={{ width: `${fraction * 100}%`, background: color }} />}
        {overflowFraction > 0 && <div style={{ width: `${overflowFraction * 100}%`, background: EXPENSE }} />}
      </div>
      {group.average !== null && (group.average > 0 || group.actual > 0) && (
        <p className="mt-1 text-[0.68rem] text-slate-600">
          Typical month {kr(group.average)}
          {group.unusual && (
            <span style={{ color: NEUTRAL }}>
              {' '}
              · higher than usual this month — likely a quarterly or yearly charge
            </span>
          )}
          {withinOnAverage && <span style={{ color: NEUTRAL }}> · within budget in a typical month</span>}
        </p>
      )}
    </div>
  )
}

function Kpi({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-[#232b3b] bg-[#1a1f2e] px-4 py-3.5">
      <div className="mb-1.5 text-[0.68rem] uppercase tracking-wider text-slate-600">
        {label}
        {sub && <span className="normal-case tracking-normal text-slate-700"> · {sub}</span>}
      </div>
      <div className="text-xl font-bold tabular-nums" style={color ? { color } : undefined}>
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

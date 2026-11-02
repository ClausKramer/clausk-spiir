import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  getRecurring,
  getDismissedRecurring,
  dismissRecurring,
  undismissRecurring,
  type RecurringSeries,
} from '../api/recurring'
import { currentMonth } from '../lib/period'
import { drillTo } from '../lib/drill'
import { EXPENSE } from '../lib/chartColors'

const kr = (n: number) =>
  n.toLocaleString('da-DK', { style: 'currency', currency: 'DKK', maximumFractionDigits: 0 })

const CADENCE_LABELS: Record<RecurringSeries['cadence'], string> = {
  Weekly: 'Weekly',
  Biweekly: 'Every 2 weeks',
  Monthly: 'Monthly',
  Quarterly: 'Quarterly',
  Yearly: 'Yearly',
}

// A series has no single period of its own — it spans however many months it's been
// recurring — so the drill-down opens the month of its most recent charge, the one a reader
// checking "did this actually happen" would want to see.
function drillToLastCharge(series: RecurringSeries) {
  const lastSeen = new Date(series.lastSeen)
  return drillTo(
    series.displayName,
    { merchant: series.merchantKey, direction: 'expense' },
    [],
    currentMonth(),
    { measure: 'outflow', month: { year: lastSeen.getFullYear(), month: lastSeen.getMonth() + 1 } },
  )
}

export function RecurringPage() {
  const qc = useQueryClient()
  const [managing, setManaging] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['recurring'],
    queryFn: getRecurring,
  })

  const { mutate: dismiss } = useMutation({
    mutationFn: dismissRecurring,
    onSuccess: () => {
      setStatus(null)
      qc.invalidateQueries({ queryKey: ['recurring'] })
    },
    // Surfaced rather than swallowed: a dismiss that fails silently looks exactly like one that
    // never fired, and the series would seem stuck on the page for no visible reason.
    onError: () => setStatus("Couldn't dismiss that — the request failed. Try again."),
  })

  return (
    <div className="min-h-screen bg-[#0f1117] px-4 py-6 text-slate-200 md:px-8 md:py-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link to="/dashboard" className="text-xs text-slate-500 hover:text-slate-300">
              ← Spending
            </Link>
            <h1 className="mt-1 text-xl font-bold text-slate-50">🔁 Recurring</h1>
            <p className="mt-0.5 text-xs text-slate-500">
              Bills and subscriptions detected from your transaction history
            </p>
          </div>
          <button
            onClick={() => setManaging(true)}
            className="rounded-lg border border-slate-700 bg-[#1a1f2e] px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-[#232b3b]"
          >
            Manage dismissed
          </button>
        </div>

        {status && (
          <div className="mb-4 rounded-lg border border-[#232b3b] bg-[#1a1f2e] px-4 py-2.5 text-sm text-slate-300">
            {status}
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
          </div>
        ) : isError && !data ? (
          <Panel title="Couldn't load recurring charges">
            <div className="py-8 text-center">
              <div className="mb-2 text-3xl">⚠️</div>
              <p className="text-slate-400">The request failed — nothing about your transactions has changed.</p>
              <button
                onClick={() => refetch()}
                disabled={isRefetching}
                className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {isRefetching ? 'Retrying…' : 'Try again'}
              </button>
            </div>
          </Panel>
        ) : data!.count === 0 ? (
          <Panel title="Nothing detected yet">
            <p className="py-8 text-center text-sm text-slate-500">
              No repeating charges found in the last 13 months. A subscription or bill needs a few
              occurrences on a regular schedule before it shows up here.
            </p>
          </Panel>
        ) : (
          <>
            <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-2">
              <Kpi label="Monthly total" value={kr(data!.totalMonthlyEquivalent)} />
              <Kpi label="Detected" value={String(data!.count)} />
            </div>

            <Panel title="By monthly cost">
              <div className="space-y-1">
                {data!.series.map((s) => (
                  <div
                    key={s.merchantKey}
                    className="flex items-center gap-3 rounded px-2 py-2.5 hover:bg-[#111620]"
                  >
                    <Link to={drillToLastCharge(s)} className="min-w-0 flex-1">
                      <div className="truncate text-sm text-slate-200">
                        {s.categoryEmoji ? `${s.categoryEmoji} ` : ''}
                        {s.displayName}
                      </div>
                      <div className="mt-0.5 text-[0.68rem] text-slate-600">
                        {CADENCE_LABELS[s.cadence]} · next expected {new Date(s.nextExpectedDate).toLocaleDateString('da-DK')}
                      </div>
                    </Link>
                    <div className="shrink-0 text-right">
                      <div className="text-sm font-semibold tabular-nums text-slate-200">{kr(s.lastAmount)}</div>
                      {s.priceChanged && (
                        <div className="text-[0.65rem] tabular-nums" style={{ color: EXPENSE }}>
                          was {kr(s.previousAmount)}
                        </div>
                      )}
                    </div>
                    <div className="shrink-0 text-sm font-semibold tabular-nums text-slate-400">
                      {kr(s.monthlyEquivalentCost)}<span className="text-[0.65rem] text-slate-600">/mo</span>
                    </div>
                    <button
                      onClick={() => dismiss(s.merchantKey)}
                      className="shrink-0 rounded border border-slate-700 px-2 py-0.5 text-[0.65rem] text-slate-500 hover:bg-[#232b3b]"
                      title="Not actually recurring"
                    >
                      Not recurring
                    </button>
                  </div>
                ))}
              </div>
            </Panel>
          </>
        )}
      </div>

      {managing && <ManageDismissedDialog onClose={() => setManaging(false)} />}
    </div>
  )
}

function ManageDismissedDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const { data: dismissed = [], isLoading } = useQuery({
    queryKey: ['recurring-dismissed'],
    queryFn: getDismissedRecurring,
  })

  const { mutate: restore, error } = useMutation({
    mutationFn: undismissRecurring,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recurring-dismissed'] })
      qc.invalidateQueries({ queryKey: ['recurring'] })
    },
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-md flex-col rounded-xl border border-[#232b3b] bg-[#1a1f2e] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-[#232b3b] px-6 py-4">
          <h2 className="text-base font-semibold text-slate-100">Dismissed series</h2>
          <p className="mt-1 text-sm text-slate-500">Charges marked "not recurring" — restore one to see it again.</p>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-3">
          {isLoading ? (
            <div className="flex justify-center py-10">
              <div className="h-6 w-6 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
            </div>
          ) : dismissed.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">Nothing dismissed.</p>
          ) : (
            <div className="space-y-1">
              {error && (
                <p className="mb-2 text-[0.68rem]" style={{ color: EXPENSE }}>
                  Couldn't restore that — the request failed. Try again.
                </p>
              )}
              {dismissed.map((d) => (
                <div key={d.merchantKey} className="flex items-center gap-3 rounded px-2 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-200">{d.merchantKey}</span>
                  <button
                    onClick={() => restore(d.merchantKey)}
                    className="shrink-0 rounded border border-slate-700 px-2 py-0.5 text-[0.65rem] text-slate-400 hover:bg-[#232b3b]"
                  >
                    Undo
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="border-t border-[#232b3b] px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-700 px-4 py-1.5 text-sm text-slate-300 hover:bg-[#232b3b]"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[#232b3b] bg-[#1a1f2e] px-4 py-3.5">
      <div className="mb-1.5 text-[0.68rem] uppercase tracking-wider text-slate-600">{label}</div>
      <div className="text-xl font-bold tabular-nums">{value}</div>
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

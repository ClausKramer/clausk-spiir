import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { BUTTON_SECONDARY, BUTTON_SMALL, EmptyState, Kpi, LoadError, Modal, Notice, PageHeader, Panel, Spinner } from '../components/ui'
import {
  getRecurring,
  getDismissedRecurring,
  dismissRecurring,
  undismissRecurring,
  type RecurringSeries,
} from '../api/recurring'
import { currentMonth, formatDay } from '../lib/period'
import { drillTo } from '../lib/drill'

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
    onSuccess: (_result, merchantKey) => {
      setStatus(`Moved “${merchantKey}” out of this list. Manage dismissed brings it back.`)
      qc.invalidateQueries({ queryKey: ['recurring'] })
    },
    // Surfaced rather than swallowed: a dismiss that fails silently looks exactly like one that
    // never fired, and the series would seem stuck on the page for no visible reason.
    onError: () => setStatus("Couldn't dismiss that — the request failed. Try again."),
  })

  return (
    <div>
      <div>
        <PageHeader
          title="Recurring"
          sub="Bills and subscriptions detected from your transactions"
          aside={
            <button onClick={() => setManaging(true)} className={BUTTON_SECONDARY}>
              Manage dismissed
            </button>
          }
        />

        {status && <Notice onDismiss={() => setStatus(null)}>{status}</Notice>}

        {isLoading ? (
          <Spinner large />
        ) : isError && !data ? (
          <LoadError what="recurring charges" onRetry={() => refetch()} retrying={isRefetching} />
        ) : data!.count === 0 ? (
          <Panel title="Recurring charges">
            <EmptyState title="Nothing detected yet">
              A subscription or bill needs a few occurrences on a regular schedule in the last 13 months before it
              shows up here.
            </EmptyState>
          </Panel>
        ) : (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3">
              <Kpi label="Cost per month" value={kr(data!.totalMonthlyEquivalent)} />
              <Kpi label="Charges detected" value={String(data!.count)} />
            </div>

            <Panel title="By monthly cost">
              <ul className="divide-y divide-[#232b3b]">
                {data!.series.map((s) => (
                  <li key={s.merchantKey} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                    <Link to={drillToLastCharge(s)} className="min-w-0 flex-1 basis-full hover:text-slate-50 sm:basis-0">
                      <div className="text-sm break-words text-slate-200">
                        {s.categoryEmoji ? `${s.categoryEmoji} ` : ''}
                        {s.displayName}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-400">
                        {CADENCE_LABELS[s.cadence]}, next on {formatDay(s.nextExpectedDate.slice(0, 10))}
                      </div>
                    </Link>
                    <div className="shrink-0 sm:text-right">
                      <div className="text-sm font-semibold text-slate-200 tabular-nums">{kr(s.lastAmount)}</div>
                      {s.priceChanged && (
                        <div className="text-xs text-red-400 tabular-nums">was {kr(s.previousAmount)}</div>
                      )}
                    </div>
                    <div className="shrink-0 text-sm font-semibold text-slate-300 tabular-nums sm:w-28 sm:text-right">
                      {kr(s.monthlyEquivalentCost)}<span className="text-xs font-normal text-slate-400">/mo</span>
                    </div>
                    <button
                      onClick={() => dismiss(s.merchantKey)}
                      className={`${BUTTON_SMALL} ml-auto shrink-0`}
                      title="Remove this from the list if it isn't really a repeating charge"
                    >
                      Not recurring
                    </button>
                  </li>
                ))}
              </ul>
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
    <Modal title="Dismissed charges" onClose={onClose} size="max-w-md">
        <p className="border-b border-[#232b3b] px-5 pt-1 pb-3 text-sm text-slate-400">Charges you marked as not recurring. Restore one to see it again.</p>
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {isLoading ? (
            <Spinner large />
          ) : dismissed.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">Nothing dismissed.</p>
          ) : (
            <div className="space-y-1">
              {error && (
                <p className="mb-2 text-xs text-red-400" role="alert">
                  Couldn't restore that — the request failed. Try again.
                </p>
              )}
              {dismissed.map((d) => (
                <div key={d.merchantKey} className="flex items-center gap-3 rounded px-2 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-200">{d.merchantKey}</span>
                  <button
                    onClick={() => restore(d.merchantKey)}
                    className={`${BUTTON_SMALL} shrink-0`}
                  >
                    Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex justify-end border-t border-[#232b3b] px-5 py-3">
          <button onClick={onClose} className={BUTTON_SECONDARY}>
            Done
          </button>
        </div>
      </Modal>
  )
}

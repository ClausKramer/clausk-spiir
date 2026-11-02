import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getNetWorthEntry, saveNetWorthEntry, KIND_LABELS } from '../api/networth'
import { MONTH_NAMES } from '../lib/period'
import { INCOME, EXPENSE } from '../lib/chartColors'

interface Props {
  year: number
  month: number
  onClose: () => void
  onSaved: (message: string) => void
}

const kr = (n: number) => Math.round(n).toLocaleString('da-DK')

// The monthly valuation form: every account, one number each.
//
// Each box starts from the last figure recorded for that account rather than empty. Most of
// these barely move month to month — a property valuation is usually last month's number, a
// pension moves a few per cent — so starting from the previous value turns the task from
// "look up seven figures" into "correct the two that changed", which is the difference between
// a habit that survives and one that doesn't.
export function NetWorthEntryDialog({ year: initialYear, month: initialMonth, onClose, onSaved }: Props) {
  const qc = useQueryClient()

  // The month being edited. The props only say where to start: a correction to an older figure
  // is as common as the monthly entry, and a dialog that could only ever open on the month
  // currently due made every past figure uneditable.
  const [cursor, setCursor] = useState({ year: initialYear, month: initialMonth })
  const { year, month } = cursor

  const { data, isLoading } = useQuery({
    queryKey: ['networth-entry', year, month],
    queryFn: () => getNetWorthEntry(year, month),
  })

  // Only what the user has actually typed is held in state. Everything else is derived from
  // the loaded form, so there is no effect copying server data into state and no window where
  // the two disagree — the box shows the edit if there is one, otherwise the starting point.
  //
  // Raw strings, not numbers: an empty box has to stay distinguishable from a zero, because
  // "I don't have a figure" and "this is worth nothing" are different facts.
  const [edits, setEdits] = useState<Record<string, string>>({})

  const startingValue = (item: { id: string; value: number | null; previousValue: number | null }) => {
    const start = item.value ?? item.previousValue
    return start === null || start === undefined ? '' : String(start)
  }
  const valueOf = (item: { id: string; value: number | null; previousValue: number | null }) =>
    edits[item.id] ?? startingValue(item)

  const { mutate: save, isPending } = useMutation({
    mutationFn: () =>
      saveNetWorthEntry({
        year,
        month,
        values: (data?.items ?? []).map((item) => {
          const raw = valueOf(item).trim().replace(/\s/g, '').replace(',', '.')
          const parsed = raw === '' ? null : Number(raw)
          return {
            accountId: item.id,
            value: parsed === null || Number.isNaN(parsed) ? null : parsed,
          }
        }),
      }),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['networth-dashboard'] })
      qc.invalidateQueries({ queryKey: ['networth-due'] })
      qc.invalidateQueries({ queryKey: ['networth-entry'] })
      onSaved(result.message)
      onClose()
    },
  })

  // Typed values belong to one month. Carried across a change of month they would be saved
  // against the wrong one, so they are dropped — after asking, since that is a loss.
  function moveMonth(delta: number) {
    if (Object.keys(edits).length > 0 && !window.confirm('Discard what you have typed for this month?')) return
    setEdits({})
    const d = new Date(year, month - 1 + delta, 1)
    setCursor({ year: d.getFullYear(), month: d.getMonth() + 1 })
  }

  const items = data?.items ?? []
  const assets = items.filter((i) => !i.isLiability)
  const liabilities = items.filter((i) => i.isLiability)

  // The sign is the data: what you type is what gets stored. Nothing here normalises it, because
  // an account is not permanently one side of the balance — a current account goes overdrawn, a
  // loan can be overpaid — and a forced sign can only express the anticipated case.
  const numberOf = (item: (typeof items)[number]) => {
    const raw = valueOf(item).trim().replace(/\s/g, '').replace(',', '.')
    const n = raw === '' ? NaN : Number(raw)
    return Number.isNaN(n) ? 0 : n
  }
  // Split by sign rather than by kind, so this running total matches what the dashboard will
  // show: an overdrawn account counts against you whatever it happens to be called.
  const entered = items.map(numberOf)
  const assetTotal = entered.filter((n) => n > 0).reduce((s, n) => s + n, 0)
  const liabilityTotal = -entered.filter((n) => n < 0).reduce((s, n) => s + n, 0)
  const filled = items.filter((i) => valueOf(i).trim() !== '').length

  function row(item: (typeof items)[number]) {
    const previous = item.previousValue
    const current = numberOf(item)
    const delta = previous !== null && valueOf(item).trim() !== '' ? current - previous : null

    return (
      <div key={item.id} className="flex items-center gap-3 py-1.5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm text-slate-200">{item.name}</div>
          <div className="text-[0.65rem] text-slate-500">
            {KIND_LABELS[item.kind]}
            {previous !== null && <> · last {kr(previous)}</>}
            {item.suggestedValue !== null && (
              <>
                {' '}
                ·{' '}
                <button
                  type="button"
                  onClick={() => setEdits((v) => ({ ...v, [item.id]: String(Math.round(item.suggestedValue!)) }))}
                  className="text-indigo-400 hover:underline"
                  title="What this app's own transaction history sums to — a suggestion, not the bank's balance"
                >
                  use {kr(item.suggestedValue)}
                </button>
              </>
            )}
          </div>
        </div>
        {/* Up is good whichever kind of account it is, now that debts are negative: a mortgage
            moving from -500.000 to -490.000 is a rise of 10.000. */}
        <div className="w-16 shrink-0 text-right text-[0.7rem] tabular-nums">
          {delta !== null && delta !== 0 && (
            <span style={{ color: delta >= 0 ? INCOME : EXPENSE }}>
              {delta > 0 ? '+' : ''}
              {kr(delta)}
            </span>
          )}
        </div>
        <input
          inputMode="decimal"
          value={valueOf(item)}
          onChange={(e) => setEdits((v) => ({ ...v, [item.id]: e.target.value }))}
          placeholder="—"
          className="w-32 shrink-0 rounded border border-slate-700 bg-[#111620] px-2 py-1.5 text-right text-sm tabular-nums text-slate-200 outline-none focus:border-indigo-500"
          aria-label={`${item.name} value for ${MONTH_NAMES[month - 1]} ${year}`}
        />
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="flex max-h-[88vh] w-full max-w-2xl flex-col rounded-xl border border-[#232b3b] bg-[#1a1f2e] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-[#232b3b] px-6 py-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-slate-100">
              What was everything worth in {MONTH_NAMES[month - 1]} {year}?
            </h2>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => moveMonth(-1)}
                disabled={isPending}
                className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-[#232b3b] disabled:opacity-50"
                aria-label="Previous month"
              >
                ←
              </button>
              <button
                type="button"
                onClick={() => moveMonth(1)}
                disabled={isPending}
                className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-[#232b3b] disabled:opacity-50"
                aria-label="Next month"
              >
                →
              </button>
            </div>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Enter each balance as it stands: what you owe as a negative number, what you hold as a
            positive one. Leave a box empty to record nothing for that account this month.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-3">
          {isLoading ? (
            <div className="flex justify-center py-10">
              <div className="h-6 w-6 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
            </div>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              No accounts to value yet — add some first.
            </p>
          ) : (
            <>
              {assets.length > 0 && (
                <>
                  <div className="mb-1 mt-1 text-[0.65rem] font-semibold uppercase tracking-wide" style={{ color: INCOME }}>
                    What you own
                  </div>
                  {assets.map(row)}
                </>
              )}
              {liabilities.length > 0 && (
                <>
                  <div className="mb-1 mt-4 text-[0.65rem] font-semibold uppercase tracking-wide" style={{ color: EXPENSE }}>
                    What you owe
                  </div>
                  {liabilities.map(row)}
                </>
              )}
            </>
          )}
        </div>

        <div className="border-t border-[#232b3b] px-6 py-4">
          {items.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-slate-500">
                {filled} of {items.length} filled in
              </span>
              <span className="tabular-nums text-slate-400">
                {kr(assetTotal)} − {kr(liabilityTotal)} ={' '}
                <span className="font-semibold text-slate-100">{kr(assetTotal - liabilityTotal)} kr.</span>
              </span>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              disabled={isPending}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-[#232b3b] disabled:opacity-50"
            >
              Not now
            </button>
            <button
              onClick={() => save()}
              disabled={isPending || items.length === 0}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {isPending ? 'Saving…' : `Record ${MONTH_NAMES[month - 1]}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getNetWorthEntry, saveNetWorthEntry, KIND_LABELS } from '../api/networth'
import { MONTH_NAMES } from '../lib/period'
import { BUTTON_PRIMARY, BUTTON_SECONDARY, BUTTON_SMALL, Modal, Spinner } from './ui'

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
          <div className="text-sm break-words text-slate-200">{item.name}</div>
          <div className="text-xs text-slate-400">
            {KIND_LABELS[item.kind]}
            {previous !== null && <> · last {kr(previous)}</>}
            {item.suggestedValue !== null && (
              <>
                {' '}
                ·{' '}
                <button
                  type="button"
                  onClick={() => setEdits((v) => ({ ...v, [item.id]: String(Math.round(item.suggestedValue!)) }))}
                  className="text-indigo-300 underline-offset-2 hover:underline"
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
        <div className="hidden w-16 shrink-0 text-right text-xs tabular-nums sm:block">
          {delta !== null && delta !== 0 && (
            <span className={delta >= 0 ? 'text-emerald-400' : 'text-red-400'}>
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
          className="min-h-9 w-28 shrink-0 rounded-lg border border-slate-700 bg-[#111620] px-2 py-1.5 text-right text-sm sm:w-32 tabular-nums text-slate-200 outline-none focus:border-indigo-500"
          aria-label={`${item.name} value for ${MONTH_NAMES[month - 1]} ${year}`}
        />
      </div>
    )
  }

  return (
    <Modal title={`What was everything worth in ${MONTH_NAMES[month - 1]} ${year}?`} onClose={onClose} dismissable={!isPending}>
        <div className="border-b border-[#232b3b] px-5 pt-1 pb-3">
          <div className="mb-2 flex items-center gap-1">
              <button
                type="button"
                onClick={() => moveMonth(-1)}
                disabled={isPending}
                className={`${BUTTON_SMALL} min-w-9`}
                aria-label="Previous month"
              >
                ‹ Earlier
              </button>
              <button
                type="button"
                onClick={() => moveMonth(1)}
                disabled={isPending}
                className={`${BUTTON_SMALL} min-w-9`}
                aria-label="Next month"
              >
                Later ›
              </button>
          </div>
          <p className="text-sm text-slate-400">
            Enter each balance as it stands: what you owe as a negative number, what you hold as a
            positive one. Leave a box empty to record nothing for that account this month.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {isLoading ? (
            <Spinner />
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">
              No accounts to value yet — add some first.
            </p>
          ) : (
            <>
              {assets.length > 0 && (
                <>
                  <div className="mt-1 mb-1 text-xs font-semibold text-emerald-400">
                    What you own
                  </div>
                  {assets.map(row)}
                </>
              )}
              {liabilities.length > 0 && (
                <>
                  <div className="mt-4 mb-1 text-xs font-semibold text-red-400">
                    What you owe
                  </div>
                  {liabilities.map(row)}
                </>
              )}
            </>
          )}
        </div>

        <div className="border-t border-[#232b3b] px-5 py-3">
          {items.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-slate-400">
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
              className={BUTTON_SECONDARY}
            >
              Not now
            </button>
            <button
              onClick={() => save()}
              disabled={isPending || items.length === 0}
              className={BUTTON_PRIMARY}
            >
              {isPending ? 'Saving…' : `Record ${MONTH_NAMES[month - 1]}`}
            </button>
          </div>
        </div>
      </Modal>
  )
}

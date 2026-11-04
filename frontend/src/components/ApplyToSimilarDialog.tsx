import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSimilarTransactions, applyToSimilar } from '../api/transactions'
import { formatDay } from '../lib/period'
import { BUTTON_PRIMARY, BUTTON_SECONDARY, Modal } from './ui'

interface Props {
  transactionId: string
  categoryId: string
  categoryLabel: string
  onClose: () => void
}

// Shown after a manual recategorization, when other auto-categorized transactions look like they
// come from the same merchant. Everything is opt-in and reviewable: matching is a heuristic, so
// the user confirms what it caught rather than discovering afterwards that it rewrote unrelated rows.
export function ApplyToSimilarDialog({ transactionId, categoryId, categoryLabel, onClose }: Props) {
  const qc = useQueryClient()
  // null until the user touches a checkbox; until then everything found is treated as selected.
  // The common case is "yes, all of these", and deriving the default from the loaded data rather
  // than syncing it into state via an effect avoids a cascading render on load.
  const [deselected, setDeselected] = useState<Set<string> | null>(null)
  const [createRule, setCreateRule] = useState(true)

  const { data, isLoading } = useQuery({
    queryKey: ['similar', transactionId],
    queryFn: () => getSimilarTransactions(transactionId),
  })

  const allIds = data?.items.map((i) => i.id) ?? []
  const selected = deselected === null ? new Set(allIds) : deselected

  const { mutate: apply, isPending } = useMutation({
    mutationFn: () =>
      applyToSimilar({
        categoryId,
        transactionIds: [...selected],
        merchantKey: data?.merchantKey ?? null,
        createRule,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      onClose()
    },
  })

  // Nothing similar found — don't make the user dismiss an empty dialog.
  useEffect(() => {
    if (!isLoading && data && data.items.length === 0) onClose()
  }, [isLoading, data, onClose])

  if (isLoading || !data || data.items.length === 0) return null

  const allSelected = selected.size === data.items.length

  function toggle(id: string) {
    setDeselected((prev) => {
      const next = new Set(prev ?? allIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <Modal title="Apply to similar transactions?" onClose={onClose} dismissable={!isPending}>
        <div className="border-b border-[#232b3b] px-5 pt-1 pb-3">
          <p className="text-sm text-slate-400">
            Found {data.items.length} other transaction{data.items.length === 1 ? '' : 's'} matching{' '}
            <span className="font-medium text-slate-200">“{data.merchantKey}”</span>. Set{' '}
            {selected.size} of them to <span className="font-medium text-slate-200">{categoryLabel}</span>?
          </p>
        </div>

        <div className="border-b border-[#232b3b] px-5 py-2">
          <button
            onClick={() => setDeselected(allSelected ? new Set() : new Set(allIds))}
            className="text-xs text-indigo-300 hover:underline"
          >
            {allSelected ? 'Deselect all' : 'Select all'}
          </button>
        </div>

        <ul className="flex-1 divide-y divide-[#232b3b] overflow-y-auto px-5 py-1">
          {data.items.map((tx) => (
            <li key={tx.id}>
              <label className="flex cursor-pointer items-start gap-3 py-2 text-sm hover:bg-white/[0.03]">
                <input type="checkbox" checked={selected.has(tx.id)} onChange={() => toggle(tx.id)} className="mt-1" />
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-slate-200">{tx.description}</span>
                  <span className="block text-xs text-slate-400">
                    {formatDay(tx.bookingDate)}
                    {tx.categoryName ? `, now ${tx.categoryEmoji ?? ''} ${tx.categoryName}` : ', no category yet'}
                  </span>
                </span>
                <span className={`shrink-0 tabular-nums ${tx.amount < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                  {tx.amount.toLocaleString('da-DK', { style: 'currency', currency: tx.currency })}
                </span>
              </label>
            </li>
          ))}
        </ul>

        <div className="border-t border-[#232b3b] px-5 py-3">
          <label className="flex items-start gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={createRule} onChange={(e) => setCreateRule(e.target.checked)} className="mt-1" />
            Also categorize future “{data.merchantKey}” transactions this way
          </label>

          <div className="mt-3 flex justify-end gap-2">
            <button
              onClick={onClose}
              disabled={isPending}
              className={BUTTON_SECONDARY}
            >
              Not now
            </button>
            <button
              onClick={() => apply()}
              disabled={isPending || (selected.size === 0 && !createRule)}
              className={BUTTON_PRIMARY}
            >
              {isPending ? 'Applying…' : `Apply${selected.size > 0 ? ` to ${selected.size}` : ''}`}
            </button>
          </div>
        </div>
      </Modal>
  )
}

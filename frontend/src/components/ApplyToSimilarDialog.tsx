import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSimilarTransactions, applyToSimilar } from '../api/transactions'

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-base font-semibold text-slate-800">Apply to similar transactions?</h2>
          <p className="mt-1 text-sm text-slate-500">
            Found {data.items.length} other transaction{data.items.length === 1 ? '' : 's'} matching{' '}
            <span className="font-medium text-slate-700">“{data.merchantKey}”</span>. Set{' '}
            {selected.size} of them to <span className="font-medium text-slate-700">{categoryLabel}</span>?
          </p>
        </div>

        <div className="border-b border-slate-100 px-6 py-2">
          <button
            onClick={() => setDeselected(allSelected ? new Set() : new Set(allIds))}
            className="text-xs text-indigo-600 hover:underline"
          >
            {allSelected ? 'Deselect all' : 'Select all'}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-2">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {data.items.map((tx) => (
                <tr key={tx.id} className="hover:bg-slate-50">
                  <td className="py-2 pr-3 w-8">
                    <input
                      type="checkbox"
                      checked={selected.has(tx.id)}
                      onChange={() => toggle(tx.id)}
                      className="rounded border-slate-300"
                    />
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap text-slate-500">{tx.bookingDate}</td>
                  <td className="py-2 pr-3 text-slate-800">{tx.description}</td>
                  <td className="py-2 pr-3 whitespace-nowrap text-xs text-slate-400">
                    {tx.categoryName ? `${tx.categoryEmoji ?? ''} ${tx.categoryName}` : '—'}
                  </td>
                  <td className={`py-2 text-right whitespace-nowrap tabular-nums ${tx.amount < 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {tx.amount.toLocaleString('da-DK', { style: 'currency', currency: tx.currency })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="border-t border-slate-200 px-6 py-4">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={createRule}
              onChange={(e) => setCreateRule(e.target.checked)}
              className="rounded border-slate-300"
            />
            Also categorize future “{data.merchantKey}” transactions this way
          </label>

          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={onClose}
              disabled={isPending}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              Not now
            </button>
            <button
              onClick={() => apply()}
              disabled={isPending || (selected.size === 0 && !createRule)}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {isPending ? 'Applying…' : `Apply${selected.size > 0 ? ` to ${selected.size}` : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

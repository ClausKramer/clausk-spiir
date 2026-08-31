import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getDuplicates, markDuplicate } from '../api/transactions'

interface Props {
  accountNameById: Map<string, string>
  onClose: () => void
  onDone: (message: string) => void
}

const kr = (n: number, currency: string) => n.toLocaleString('da-DK', { style: 'currency', currency })

// Finds transactions that share an account, date and amount — the signature of one payment
// recorded twice, which happens when a CSV import and a bank sync both cover the same period.
//
// Nothing is marked without confirmation, and the copies are shown side by side, because two
// identical charges at the same merchant on the same day are a real pattern. The pre-selection is
// a suggestion, not a decision.
export function DuplicatesDialog({ accountNameById, onClose, onDone }: Props) {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['duplicates'], queryFn: getDuplicates })

  // null until touched: until then the server's suggestion stands.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})

  const suggested = new Set(data?.groups.flatMap((g) => g.suggestedIds) ?? [])
  const isSelected = (id: string) => overrides[id] ?? suggested.has(id)
  const selectedIds = (data?.groups.flatMap((g) => g.items.map((i) => i.id)) ?? []).filter(isSelected)

  const { mutate: apply, isPending } = useMutation({
    mutationFn: () => markDuplicate(selectedIds, true),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['by-category'] })
      qc.invalidateQueries({ queryKey: ['duplicates'] })
      onDone(result.message)
      onClose()
    },
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-xl border border-slate-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-base font-semibold text-slate-800">Possible duplicates</h2>
          <p className="mt-1 text-sm text-slate-500">
            {isLoading
              ? 'Looking for transactions recorded more than once…'
              : data && data.groupCount > 0
                ? `${data.groupCount} set${data.groupCount === 1 ? '' : 's'} share an account, date and amount. ${selectedIds.length} copy/copies selected to exclude.`
                : 'Nothing looks duplicated.'}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-3">
          {isLoading ? (
            <div className="flex justify-center py-10">
              <div className="h-6 w-6 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
            </div>
          ) : !data || data.groupCount === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              No transaction shares an account, date and amount with another.
            </p>
          ) : (
            <div className="space-y-3">
              {data.groups.map((g) => (
                <div key={`${g.bankAccountId}-${g.bookingDate}-${g.amount}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="mb-2 flex items-center justify-between gap-3 text-xs">
                    <span className="text-slate-500">
                      {g.bookingDate} · {accountNameById.get(g.bankAccountId) ?? 'Unknown account'}
                    </span>
                    <span className={`tabular-nums ${g.amount < 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {kr(g.amount, g.currency)}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {g.items.map((i) => (
                      <label
                        key={i.id}
                        className={`flex cursor-pointer items-center gap-2.5 rounded px-2 py-1.5 text-sm transition-colors ${
                          isSelected(i.id) ? 'bg-red-50 text-slate-400 line-through' : 'text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected(i.id)}
                          onChange={(e) => setOverrides((prev) => ({ ...prev, [i.id]: e.target.checked }))}
                          className="rounded border-slate-300"
                        />
                        <span className="min-w-0 flex-1 truncate">{i.description}</span>
                        <span
                          className={`shrink-0 rounded px-1.5 py-0.5 text-[0.6rem] uppercase tracking-wide ${
                            i.source === 'csv' ? 'bg-amber-100 text-amber-700' : 'bg-sky-100 text-sky-700'
                          }`}
                          title={i.source === 'csv' ? 'Came from a CSV import' : "Came from the bank's own feed"}
                        >
                          {i.source === 'csv' ? 'Imported' : 'Bank'}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-slate-200 px-6 py-4">
          {data && data.groupCount > 0 && (
            <p className="mb-3 text-xs text-slate-500">
              Checked copies are excluded from every total. Nothing is deleted — you can restore
              them from the account's transaction list.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              disabled={isPending}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              {data && data.groupCount > 0 ? 'Cancel' : 'Close'}
            </button>
            {data && data.groupCount > 0 && (
              <button
                onClick={() => apply()}
                disabled={isPending || selectedIds.length === 0}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {isPending ? 'Marking…' : `Exclude ${selectedIds.length}`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

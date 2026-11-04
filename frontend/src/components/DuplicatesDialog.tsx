import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getDuplicates, markDuplicate } from '../api/transactions'
import { BUTTON_PRIMARY, BUTTON_SECONDARY, Modal, Spinner } from './ui'

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
    <Modal title="Possible duplicates" onClose={onClose} size="max-w-3xl" dismissable={!isPending}>
        <div className="border-b border-[#232b3b] px-5 pt-1 pb-3">
          <p className="text-sm text-slate-400">
            {isLoading
              ? 'Looking for transactions recorded more than once…'
              : data && data.groupCount > 0
                ? `${data.groupCount} set${data.groupCount === 1 ? '' : 's'} share an account, date and amount. ${selectedIds.length} selected to exclude.`
                : 'Nothing looks duplicated.'}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {isLoading ? (
            <Spinner />
          ) : !data || data.groupCount === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">
              No transaction shares an account, date and amount with another.
            </p>
          ) : (
            <div className="space-y-3">
              {data.groups.map((g) => (
                <div key={`${g.bankAccountId}-${g.bookingDate}-${g.amount}`} className="rounded-lg border border-[#232b3b] bg-[#111620] p-3">
                  <div className="mb-2 flex items-center justify-between gap-3 text-xs">
                    <span className="text-slate-400">
                      {g.bookingDate} · {accountNameById.get(g.bankAccountId) ?? 'Unknown account'}
                    </span>
                    <span className={`tabular-nums ${g.amount < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                      {kr(g.amount, g.currency)}
                    </span>
                  </div>
                  {/* A pair the user never created by hand needs explaining, or the only
                      conclusion available is that the app invented a transaction. */}
                  {g.origin === 'bank' && (
                    <p className="mb-2 rounded bg-sky-500/10 px-2 py-1.5 text-xs text-sky-200">
                      Both copies came from the bank under different ids — usually a payment that
                      was sent through once while still pending and again once it settled. Keeping
                      the newer one; it's the id the bank still reports.
                    </p>
                  )}
                  <div className="space-y-1">
                    {g.items.map((i) => (
                      <label
                        key={i.id}
                        className={`flex cursor-pointer items-center gap-2.5 rounded px-2 py-1.5 text-sm transition-colors ${
                          isSelected(i.id) ? 'bg-red-500/10 text-slate-400 line-through' : 'text-slate-200 hover:bg-[#1a1f2e]/5'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected(i.id)}
                          onChange={(e) => setOverrides((prev) => ({ ...prev, [i.id]: e.target.checked }))}
                        />
                        <span className="min-w-0 flex-1 break-words" title={`id: ${i.externalTransactionId}`}>
                          {i.description}
                        </span>
                        <span
                          className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${
                            i.source === 'csv' ? 'bg-amber-500/15 text-amber-300' : 'bg-sky-500/15 text-sky-300'
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

        <div className="border-t border-[#232b3b] px-5 py-3">
          {data && data.groupCount > 0 && (
            <p className="mb-3 text-xs text-slate-400">
              Checked copies are excluded from every total. Nothing is deleted — you can restore
              them from the account's transaction list.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              disabled={isPending}
              className={BUTTON_SECONDARY}
            >
              {data && data.groupCount > 0 ? 'Cancel' : 'Close'}
            </button>
            {data && data.groupCount > 0 && (
              <button
                onClick={() => apply()}
                disabled={isPending || selectedIds.length === 0}
                className={BUTTON_PRIMARY}
              >
                {isPending ? 'Marking…' : `Exclude ${selectedIds.length}`}
              </button>
            )}
          </div>
        </div>
      </Modal>
  )
}

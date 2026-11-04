import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getCounterpartCandidates, markTransfer, type Transaction } from '../api/transactions'
import { BUTTON_PRIMARY, BUTTON_SECONDARY, Modal, Spinner } from './ui'

interface Props {
  transaction: Transaction
  accountNameById: Map<string, string>
  onClose: () => void
}

const kr = (n: number, currency: string) => n.toLocaleString('da-DK', { style: 'currency', currency })

// Marking a transfer by hand. Two cases matter and they're different:
//   - both legs are in Spiir, and the matcher just missed them (dates too far apart, say)
//   - only one leg exists, because the money went to an account that isn't connected
// The first is worth marking as a pair; the second can only ever be a single row. Offering the
// candidate list handles the first without forcing it on the second.
export function MarkTransferDialog({ transaction, accountNameById, onClose }: Props) {
  const qc = useQueryClient()
  const [pickedId, setPickedId] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['counterpart-candidates', transaction.id],
    queryFn: () => getCounterpartCandidates(transaction.id),
  })

  const { mutate: mark, isPending } = useMutation({
    mutationFn: () => markTransfer(pickedId ? [transaction.id, pickedId] : [transaction.id], true),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['by-category'] })
      onClose()
    },
  })

  const candidates = data?.items ?? []

  return (
    <Modal title="Mark as internal transfer" onClose={onClose} dismissable={!isPending}>
        <div className="border-b border-[#232b3b] px-5 pt-1 pb-3">
          <p className="text-sm text-slate-400">
            Transfers between your own accounts aren't income or spending, so they're left out of
            the totals.
          </p>
          <div className="mt-3 rounded-lg border border-[#1e2535] bg-[#111620] px-3 py-2 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-300">{transaction.description}</span>
              <span className={`shrink-0 tabular-nums ${transaction.amount < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                {kr(transaction.amount, transaction.currency)}
              </span>
            </div>
            <div className="mt-0.5 text-xs text-slate-400">
              {transaction.bookingDate} · {accountNameById.get(transaction.bankAccountId) ?? 'Unknown account'}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {isLoading ? (
            <Spinner />
          ) : candidates.length === 0 ? (
            <p className="py-2 text-sm text-slate-400">
              No matching opposite amount found in your other accounts. That's expected if the money
              went somewhere Spiir isn't connected to — marking just this transaction still keeps it
              out of the totals.
            </p>
          ) : (
            <>
              <p className="mb-2 text-xs text-slate-400">Other leg (optional)</p>
              <div className="space-y-1.5">
                {candidates.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setPickedId(pickedId === c.id ? null : c.id)}
                    className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                      pickedId === c.id
                        ? 'border-indigo-500 bg-indigo-500/10'
                        : 'border-[#1e2535] bg-[#111620] hover:border-slate-600'
                    }`}
                  >
                    <span className={`shrink-0 text-xs ${pickedId === c.id ? 'text-indigo-400' : 'text-slate-400'}`}>
                      {pickedId === c.id ? '●' : '○'}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-slate-300">{c.description}</span>
                      <span className="block text-xs text-slate-400">
                        {c.bookingDate} · {accountNameById.get(c.bankAccountId) ?? 'Unknown account'}
                      </span>
                    </span>
                    <span className={`shrink-0 tabular-nums ${c.amount < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                      {kr(c.amount, c.currency)}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-[#232b3b] px-5 py-3">
          <button
            onClick={onClose}
            disabled={isPending}
            className={BUTTON_SECONDARY}
          >
            Cancel
          </button>
          <button
            onClick={() => mark()}
            disabled={isPending}
            className={BUTTON_PRIMARY}
          >
            {isPending ? 'Marking…' : pickedId ? 'Mark both as transfer' : 'Mark as transfer'}
          </button>
        </div>
      </Modal>
  )
}

import type { ReactNode } from 'react'
import type { Transaction } from '../api/transactions'
import { formatDay } from '../lib/period'
import { useMediaQuery } from '../lib/useMediaQuery'
import { CategoryPicker } from './CategoryPicker'
import { TagEditor } from './TagEditor'

// Five columns on a wide screen, stacked on a phone. It was a table in a scrolling box, which
// pushed the amount — the one thing a row is read for — off the right edge of the screen.
const COLUMNS = 'md:grid-cols-[6.5rem_minmax(0,1fr)_9rem_12rem_8rem]'

export function TransactionList({
  items,
  accountNameById,
  showAccount = true,
  flags,
  dimmed,
  strike,
}: {
  items: Transaction[]
  accountNameById: Map<string, string>
  showAccount?: boolean
  /** Badges and actions beside the description, which differ by page. */
  flags?: (tx: Transaction) => ReactNode
  dimmed?: (tx: Transaction) => boolean
  strike?: (tx: Transaction) => boolean
}) {
  const wide = useMediaQuery('(min-width: 768px)')

  return (
    <div>
      <div className={`hidden gap-x-3 border-b border-[#232b3b] pb-2 text-xs font-medium text-slate-400 md:grid ${COLUMNS}`}>
        <div>Date</div>
        <div>Description</div>
        <div>{showAccount && 'Account'}</div>
        <div>Category</div>
        <div className="text-right">Amount</div>
      </div>
      <ul>
        {items.map((tx) => {
          const account = showAccount ? (accountNameById.get(tx.bankAccountId) ?? 'Unknown account') : null
          // Beside the description on a wide screen, where the actions hide until hover and must
          // not hold open a line of their own; beside the category on a phone, where they are
          // always showing and a line each would double the height of the list.
          const extras = (
            <>
              <TagEditor transactionId={tx.id} tags={tx.tags} />
              {flags?.(tx)}
            </>
          )
          return (
            <li
              key={tx.id}
              className={`group/row grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-b border-[#1e2535] py-2.5 last:border-none md:items-start md:hover:bg-white/[0.02] ${COLUMNS} ${
                dimmed?.(tx) ? 'opacity-70' : ''
              }`}
            >
              <div className="hidden pt-0.5 text-sm whitespace-nowrap text-slate-400 md:col-start-1 md:row-start-1 md:block">
                {formatDay(tx.bookingDate)}
              </div>

              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 md:col-start-2 md:row-start-1">
                <div className={`min-w-0 pt-0.5 text-sm break-words text-slate-200 ${strike?.(tx) ? 'line-through' : ''}`}>
                  {tx.description}
                </div>
                {wide && extras}
              </div>

              <div
                className={`col-start-2 row-start-1 pt-0.5 text-right text-sm font-semibold whitespace-nowrap tabular-nums md:col-start-5 ${
                  tx.amount < 0 ? 'text-red-400' : 'text-emerald-400'
                }`}
              >
                {tx.amount.toLocaleString('da-DK', { style: 'currency', currency: tx.currency })}
              </div>

              <div className="col-span-2 text-xs text-slate-400 md:hidden">
                {formatDay(tx.bookingDate)}
                {account && ` · ${account}`}
              </div>

              <div className="hidden min-w-0 truncate pt-0.5 text-sm text-slate-400 md:col-start-3 md:row-start-1 md:block" title={account ?? undefined}>
                {account}
              </div>

              <div className="col-span-2 -ml-2 flex min-w-0 flex-wrap items-center gap-1 md:col-span-1 md:col-start-4 md:row-start-1">
                <CategoryPicker
                  transactionId={tx.id}
                  categoryId={tx.categoryId}
                  categoryName={tx.categoryName}
                  categoryEmoji={tx.categoryEmoji}
                />
                {!wide && extras}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

const BADGE = 'rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap'

export function ScheduledBadge() {
  return (
    <span
      className={`${BADGE} border-amber-500/40 bg-amber-500/10 text-amber-300`}
      title="Scheduled by the bank for a future date — not counted in any total"
    >
      Scheduled
    </span>
  )
}

export function TransferBadge({ onUndo }: { onUndo?: () => void }) {
  const cls = `${BADGE} border-sky-500/40 bg-sky-500/10 text-sky-300`
  return onUndo ? (
    <button onClick={onUndo} className={`${cls} hover:bg-sky-500/20`} title="Marked as a transfer by you — click to undo">
      Transfer ✕
    </button>
  ) : (
    <span className={cls} title="Matched against the opposite leg in another of your accounts — not counted as income or spending">
      Transfer
    </span>
  )
}

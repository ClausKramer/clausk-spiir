import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { getTransactions, markDuplicate, type Period } from '../api/transactions'
import { getBankAccounts } from '../api/accounts'
import { CategoryPicker } from '../components/CategoryPicker'
import { TagEditor } from '../components/TagEditor'
import { PeriodNavigator } from '../components/PeriodNavigator'
import { periodLabel, readPeriod, writePeriod } from '../lib/period'

const PAGE_SIZE = 100

export function AccountTransactionsPage() {
  const { id } = useParams<{ id: string }>()

  // Period and page live in the URL so a particular month of an account is a bookmarkable,
  // shareable address rather than a place you have to navigate back to by hand.
  const [search, setSearch] = useSearchParams()
  const update = (mutate: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(search)
    mutate(next)
    setSearch(next, { replace: true })
  }

  // null means every year on record. This list is the "show me everything the bank has" view,
  // so it opens unfiltered and the navigator narrows it — the opposite of the dashboard, which
  // is an analysis view and always scopes to a period.
  const period = readPeriod(search)
  const page = Math.max(1, Number(search.get('page')) || 1)

  const setPage = (next: number) => update((p) => (next === 1 ? p.delete('page') : p.set('page', String(next))))

  function changePeriod(next: Period | null) {
    update((p) => {
      writePeriod(p, next)
      // Page 4 of January is almost never a page that exists.
      p.delete('page')
    })
  }

  const qc = useQueryClient()
  const { data: accounts = [] } = useQuery({ queryKey: ['accounts'], queryFn: getBankAccounts })
  const account = accounts.find((a) => a.id === id)

  // This list deliberately shows duplicates, so it's also where they can be undone.
  const { mutate: setDuplicate } = useMutation({
    mutationFn: ({ txId, value }: { txId: string; value: boolean }) => markDuplicate([txId], value),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['duplicates'] })
    },
  })

  const { data: txPage, isLoading } = useQuery({
    queryKey: ['transactions', page, id ? [id] : [], period],
    queryFn: () => getTransactions(page, PAGE_SIZE, id ? [id] : [], period ?? undefined),
    enabled: !!id,
    // Holds the previous period's rows on screen while the next load runs, so stepping through
    // months doesn't flash an empty table between each one.
    placeholderData: (prev) => prev,
  })

  const totalPages = txPage ? Math.max(1, Math.ceil(txPage.totalCount / PAGE_SIZE)) : 1
  const years = txPage?.availableYears ?? [new Date().getFullYear()]

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-4">
        <Link to="/accounts" className="text-slate-500 hover:text-slate-700 text-sm">← Accounts</Link>
        <span className="text-lg font-semibold text-slate-800">
          {account ? account.name : 'Transactions'}
        </span>
        {txPage && (
          <span className="text-sm text-slate-400">
            {txPage.totalCount} transaction{txPage.totalCount === 1 ? '' : 's'}
            {period && ` in ${periodLabel(period)}`}
          </span>
        )}
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <PeriodNavigator allowAllYears period={period} onChange={changePeriod} availableYears={years} />
          {!period && <span className="text-sm text-slate-400">Showing all history</span>}
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
          </div>
        ) : !txPage || txPage.items.length === 0 ? (
          <div className="rounded-xl bg-white border border-slate-100 p-12 text-center shadow-sm">
            <div className="text-4xl mb-3">📭</div>
            {period ? (
              <>
                <p className="font-medium text-slate-700">Nothing in {periodLabel(period)}</p>
                <p className="mt-1 text-sm text-slate-400">
                  Step to another month, or clear the filter to see the whole account.
                </p>
              </>
            ) : (
              <>
                <p className="font-medium text-slate-700">No transactions for this account</p>
                <p className="mt-1 text-sm text-slate-400">
                  Sync the account, or import older history from a CSV file.
                </p>
              </>
            )}
          </div>
        ) : (
          <>
            <div className="rounded-xl bg-white border border-slate-100 shadow-sm overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-3 text-left font-medium">Date</th>
                    <th className="px-5 py-3 text-left font-medium">Description</th>
                    <th className="px-5 py-3 text-left font-medium">Category</th>
                    <th className="px-5 py-3 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {txPage.items.map((tx) => (
                    <tr key={tx.id} className={`group/row hover:bg-slate-50 ${tx.isFuture || tx.isDuplicate ? 'opacity-60' : ''}`}>
                      <td className="px-5 py-2.5 whitespace-nowrap text-slate-500">{tx.bookingDate}</td>
                      <td className={`px-5 py-2.5 text-slate-800 ${tx.isDuplicate ? 'line-through' : ''}`}>
                        {tx.description}
                        {tx.isFuture && (
                          <span
                            className="ml-2 rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 align-middle text-[0.62rem] font-medium uppercase tracking-wide text-amber-700"
                            title="Scheduled by the bank for a future date — not counted in any total"
                          >
                            Scheduled
                          </span>
                        )}
                        {tx.isDuplicate ? (
                          <button
                            onClick={() => setDuplicate({ txId: tx.id, value: false })}
                            className="ml-2 rounded-full border border-red-300 bg-red-50 px-1.5 py-0.5 align-middle text-[0.62rem] font-medium uppercase tracking-wide text-red-700 hover:bg-red-100"
                            title="Excluded as a duplicate — click to restore it"
                          >
                            Duplicate ✕
                          </button>
                        ) : (
                          <button
                            onClick={() => setDuplicate({ txId: tx.id, value: true })}
                            className="ml-2 align-middle text-[0.62rem] text-slate-300 opacity-0 transition-opacity hover:text-red-500 group-hover/row:opacity-100"
                            title="Mark as a duplicate copy, so it's excluded from every total"
                          >
                            ⧉
                          </button>
                        )}
                        <div className="mt-1">
                          <TagEditor transactionId={tx.id} tags={tx.tags} />
                        </div>
                      </td>
                      <td className="px-5 py-2.5">
                        <CategoryPicker
                          transactionId={tx.id}
                          categoryId={tx.categoryId}
                          categoryName={tx.categoryName}
                          categoryEmoji={tx.categoryEmoji}
                        />
                      </td>
                      <td className={`px-5 py-2.5 text-right font-medium tabular-nums ${tx.amount < 0 ? 'text-red-600' : 'text-green-600'}`}>
                        {tx.amount.toLocaleString('da-DK', { style: 'currency', currency: tx.currency })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="mt-4 flex items-center justify-between text-sm">
                <button
                  onClick={() => setPage(Math.max(1, page - 1))}
                  disabled={page === 1}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                >
                  ← Previous
                </button>
                <span className="text-slate-500">Page {page} of {totalPages}</span>
                <button
                  onClick={() => setPage(Math.min(totalPages, page + 1))}
                  disabled={page >= totalPages}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                >
                  Next →
                </button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}

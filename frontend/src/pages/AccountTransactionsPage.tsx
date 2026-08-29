import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { getTransactions } from '../api/transactions'
import { getBankAccounts } from '../api/accounts'
import { CategoryPicker } from '../components/CategoryPicker'

const PAGE_SIZE = 100

export function AccountTransactionsPage() {
  const { id } = useParams<{ id: string }>()
  const [page, setPage] = useState(1)

  const { data: accounts = [] } = useQuery({ queryKey: ['accounts'], queryFn: getBankAccounts })
  const account = accounts.find((a) => a.id === id)

  const { data: txPage, isLoading } = useQuery({
    queryKey: ['transactions', page, id ? [id] : []],
    queryFn: () => getTransactions(page, PAGE_SIZE, id ? [id] : []),
    enabled: !!id,
  })

  const totalPages = txPage ? Math.max(1, Math.ceil(txPage.totalCount / PAGE_SIZE)) : 1

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
          </span>
        )}
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
          </div>
        ) : !txPage || txPage.items.length === 0 ? (
          <div className="rounded-xl bg-white border border-slate-100 p-12 text-center shadow-sm">
            <div className="text-4xl mb-3">📭</div>
            <p className="font-medium text-slate-700">No transactions for this account</p>
            <p className="mt-1 text-sm text-slate-400">
              Sync the account, or import older history from a CSV file.
            </p>
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
                    <tr key={tx.id} className={`hover:bg-slate-50 ${tx.isFuture ? 'opacity-60' : ''}`}>
                      <td className="px-5 py-2.5 whitespace-nowrap text-slate-500">{tx.bookingDate}</td>
                      <td className="px-5 py-2.5 text-slate-800">
                        {tx.description}
                        {tx.isFuture && (
                          <span
                            className="ml-2 rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 align-middle text-[0.62rem] font-medium uppercase tracking-wide text-amber-700"
                            title="Scheduled by the bank for a future date — not counted in any total"
                          >
                            Scheduled
                          </span>
                        )}
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
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                >
                  ← Previous
                </button>
                <span className="text-slate-500">Page {page} of {totalPages}</span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
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

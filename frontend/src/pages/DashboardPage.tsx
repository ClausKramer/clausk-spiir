import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useMe, useLogout } from '../hooks/useAuth'
import { getTransactions } from '../api/transactions'
import { getBankAccounts, syncAll } from '../api/accounts'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CategoryPicker } from '../components/CategoryPicker'
import { SpendingChart } from '../components/SpendingChart'

export function DashboardPage() {
  const qc = useQueryClient()
  const { data: user } = useMe()
  const { mutate: doLogout, isPending: loggingOut } = useLogout()
  const { data: txPage, isLoading: txLoading } = useQuery({
    queryKey: ['transactions', 1],
    queryFn: () => getTransactions(1, 50),
  })
  const { data: accounts = [] } = useQuery({ queryKey: ['accounts'], queryFn: getBankAccounts })
  const { mutate: doSync, isPending: syncing } = useMutation({
    mutationFn: syncAll,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['transactions'] }); qc.invalidateQueries({ queryKey: ['accounts'] }) },
  })

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
        <span className="text-xl font-bold text-indigo-600">Spiir</span>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-600 hidden sm:block">{user?.email}</span>
          <button
            onClick={() => doSync()}
            disabled={syncing || accounts.length === 0}
            className="rounded-lg border border-slate-200 px-3 py-1 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-40"
          >
            {syncing ? 'Syncing…' : 'Sync'}
          </button>
          <Link
            to="/accounts"
            className="rounded-lg border border-slate-200 px-3 py-1 text-sm text-slate-700 hover:bg-slate-100"
          >
            Accounts
          </Link>
          <button
            onClick={() => doLogout()}
            disabled={loggingOut}
            className="rounded-lg border border-slate-200 px-3 py-1 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8">
        {/* Summary cards */}
        <div className="mb-8 grid grid-cols-3 gap-4">
          {[
            { label: 'Transactions', value: txPage?.totalCount ?? '—' },
            { label: 'Bank accounts', value: accounts.length },
            { label: 'Categories', value: 15 },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-xl bg-white p-5 shadow-sm border border-slate-100">
              <p className="text-sm text-slate-500">{label}</p>
              <p className="mt-1 text-2xl font-bold text-slate-800">{value}</p>
            </div>
          ))}
        </div>

        {/* Spending chart */}
        <div className="mb-8">
          <SpendingChart />
        </div>

        {/* Transactions table */}
        <div className="rounded-xl bg-white shadow-sm border border-slate-100">
          <div className="border-b border-slate-100 px-6 py-4">
            <h2 className="text-base font-semibold text-slate-800">Transactions</h2>
          </div>

          {txLoading ? (
            <div className="flex justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
            </div>
          ) : txPage && txPage.items.length > 0 ? (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-6 py-3 text-left">Date</th>
                  <th className="px-6 py-3 text-left">Description</th>
                  <th className="px-6 py-3 text-left">Category</th>
                  <th className="px-6 py-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {txPage.items.map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-50">
                    <td className="px-6 py-3 text-slate-500 whitespace-nowrap">{tx.bookingDate}</td>
                    <td className="px-6 py-3 text-slate-800">{tx.description}</td>
                    <td className="px-6 py-3">
                      <CategoryPicker
                        transactionId={tx.id}
                        categoryId={tx.categoryId}
                        categoryName={tx.categoryName}
                        categoryEmoji={tx.categoryEmoji}
                      />
                    </td>
                    <td className={`px-6 py-3 text-right font-medium tabular-nums ${tx.amount < 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {tx.amount.toLocaleString('da-DK', { style: 'currency', currency: tx.currency })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="text-4xl mb-3">🏦</div>
              <p className="text-slate-600 font-medium">No transactions yet</p>
              <p className="mt-1 text-sm text-slate-400">
                Connect a bank account to start syncing transactions.
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { getBankAccounts, deleteBankAccount, syncAll } from '../api/accounts'

export function AccountsPage() {
  const qc = useQueryClient()
  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['accounts'],
    queryFn: getBankAccounts,
  })

  const { mutate: doDelete, isPending: deleting } = useMutation({
    mutationFn: deleteBankAccount,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  })

  const { mutate: doSync, isPending: syncing, data: syncResult } = useMutation({
    mutationFn: syncAll,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] })
      qc.invalidateQueries({ queryKey: ['transactions'] })
    },
  })

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-4">
        <Link to="/dashboard" className="text-slate-500 hover:text-slate-700 text-sm">← Dashboard</Link>
        <span className="text-lg font-semibold text-slate-800">Bank accounts</span>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-500">
            {accounts.length} connected account{accounts.length !== 1 ? 's' : ''}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => doSync()}
              disabled={syncing || accounts.length === 0}
              className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-40"
            >
              {syncing ? 'Syncing…' : 'Sync all'}
            </button>
            <Link
              to="/accounts/connect"
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              + Add bank
            </Link>
          </div>
        </div>

        {syncResult && (
          <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
            {syncResult.message}
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
          </div>
        ) : accounts.length === 0 ? (
          <div className="rounded-xl bg-white border border-slate-100 p-12 text-center shadow-sm">
            <div className="text-4xl mb-3">🏦</div>
            <p className="font-medium text-slate-700">No bank accounts yet</p>
            <p className="mt-1 text-sm text-slate-400">Add your first bank to start syncing transactions.</p>
            <Link
              to="/accounts/connect"
              className="mt-4 inline-block rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Connect a bank
            </Link>
          </div>
        ) : (
          <div className="rounded-xl bg-white border border-slate-100 shadow-sm divide-y divide-slate-100">
            {accounts.map((acc) => (
              <div key={acc.id} className="flex items-center justify-between px-6 py-4">
                <div>
                  <p className="font-medium text-slate-800">{acc.name}</p>
                  {acc.iban && <p className="text-xs text-slate-400 mt-0.5">{acc.iban}</p>}
                  <p className="text-xs text-slate-400">
                    {acc.lastSyncedAt
                      ? `Last synced ${new Date(acc.lastSyncedAt).toLocaleDateString('da-DK')}`
                      : 'Never synced'}
                  </p>
                </div>
                <button
                  onClick={() => { if (confirm('Remove this account and all its transactions?')) doDelete(acc.id) }}
                  disabled={deleting}
                  className="text-sm text-red-500 hover:text-red-700 disabled:opacity-40"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

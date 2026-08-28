import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { getBankAccounts, deleteBankAccount, renameBankAccount, importCsv, syncAll, type BankAccount, type ImportCsvResult } from '../api/accounts'

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
              <AccountRow key={acc.id} account={acc} onDelete={() => doDelete(acc.id)} deleting={deleting} />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

function AccountRow({ account, onDelete, deleting }: { account: BankAccount; onDelete: () => void; deleting: boolean }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(account.name)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importResult, setImportResult] = useState<ImportCsvResult | null>(null)
  const [importError, setImportError] = useState<string | null>(null)

  const { mutate: doRename, isPending: renaming } = useMutation({
    mutationFn: (newName: string) => renameBankAccount(account.id, newName),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] })
      setEditing(false)
    },
  })

  const { mutate: doImport, isPending: importing } = useMutation({
    mutationFn: (file: File) => importCsv(account.id, file),
    onSuccess: (result) => {
      setImportResult(result)
      setImportError(null)
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Import failed. Please try again.'
      setImportError(message)
      setImportResult(null)
    },
  })

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file later
    if (file) doImport(file)
  }

  function submit() {
    const trimmed = name.trim()
    if (!trimmed || trimmed === account.name) {
      setEditing(false)
      setName(account.name)
      return
    }
    doRename(trimmed)
  }

  return (
    <div className="px-6 py-4">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          {editing ? (
            <form
              onSubmit={(e) => { e.preventDefault(); submit() }}
              className="flex items-center gap-2"
            >
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={submit}
                onKeyDown={(e) => { if (e.key === 'Escape') { setEditing(false); setName(account.name) } }}
                disabled={renaming}
                className="rounded border border-indigo-300 px-2 py-1 text-sm font-medium text-slate-800 outline-none focus:ring-2 focus:ring-indigo-200"
              />
            </form>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="group flex items-center gap-1.5 font-medium text-slate-800 hover:text-indigo-600"
              title="Rename account"
            >
              {account.name}
              <span className="text-xs text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity">✎</span>
            </button>
          )}
          {account.iban && <p className="text-xs text-slate-400 mt-0.5">{account.iban}</p>}
          <p className="text-xs text-slate-400">
            {account.lastSyncedAt
              ? `Last synced ${new Date(account.lastSyncedAt).toLocaleDateString('da-DK')}`
              : 'Never synced'}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="text-sm text-slate-500 hover:text-slate-700 disabled:opacity-40"
            title="Import older transactions from a CSV file"
          >
            {importing ? 'Importing…' : 'Import CSV'}
          </button>
          <button
            onClick={() => { if (confirm('Remove this account and all its transactions?')) onDelete() }}
            disabled={deleting}
            className="text-sm text-red-500 hover:text-red-700 disabled:opacity-40"
          >
            Remove
          </button>
        </div>
      </div>

      {importResult && (
        <div className="mt-3 rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-xs text-green-700">
          <p>{importResult.message}</p>
          {importResult.errors.length > 0 && (
            <ul className="mt-1 list-disc pl-4 text-amber-700">
              {importResult.errors.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}
              {importResult.errors.length > 5 && <li>…and {importResult.errors.length - 5} more.</li>}
            </ul>
          )}
        </div>
      )}
      {importError && (
        <div className="mt-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          {importError}
        </div>
      )}
    </div>
  )
}

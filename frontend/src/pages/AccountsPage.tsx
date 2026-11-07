import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { getBankAccounts, deleteBankAccount, renameBankAccount, importCsv, syncAll, refreshBalance, type BankAccount, type ImportCsvResult } from '../api/accounts'
import { recategorize } from '../api/transactions'
import { syncDefaultCategories, clearLearnedRules } from '../api/categories'
import { DuplicatesDialog } from '../components/DuplicatesDialog'

export function AccountsPage() {
  const qc = useQueryClient()
  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['accounts'],
    queryFn: getBankAccounts,
  })

  // Every maintenance action reports the same shape of result — "here's what changed" — so they
  // share one banner rather than each owning a slot that's empty most of the time.
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [findingDuplicates, setFindingDuplicates] = useState(false)

  const accountNameById = new Map(accounts.map((a) => [a.id, a.name]))

  // Everything here changes stored transactions, so they all invalidate the same three caches.
  function refreshAll() {
    qc.invalidateQueries({ queryKey: ['accounts'] })
    qc.invalidateQueries({ queryKey: ['transactions'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
  }

  const { mutate: doDelete, isPending: deleting } = useMutation({
    mutationFn: deleteBankAccount,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  })

  const { mutate: doSync, isPending: syncing } = useMutation({
    mutationFn: (fullHistory: boolean) => syncAll(fullHistory),
    onSuccess: (result) => {
      refreshAll()
      setStatusMessage(result.message)
    },
    onError: () => setStatusMessage('Sync failed. Please try again.'),
  })

  // Sync defaults first, then recategorize — new categories are useless to the engine until they
  // exist, so doing both in one click is the only order that actually helps.
  const { mutate: doRecategorize, isPending: recategorizing } = useMutation({
    mutationFn: async () => {
      const defaults = await syncDefaultCategories()
      const result = await recategorize(true)
      return { defaults, result }
    },
    onSuccess: ({ defaults, result }) => {
      refreshAll()
      qc.invalidateQueries({ queryKey: ['categories'] })
      const defaultsChanged = defaults.addedCategories > 0 || defaults.addedRules > 0 || defaults.removedRules > 0
      setStatusMessage(defaultsChanged ? `${defaults.message} ${result.message}` : result.message)
    },
    onError: () => setStatusMessage('Recategorize failed. Please try again.'),
  })

  const { mutate: doClearRules, isPending: clearingRules } = useMutation({
    mutationFn: clearLearnedRules,
    onSuccess: (result) => {
      refreshAll()
      setStatusMessage(`${result.message} Run Recategorize to re-apply the default rules.`)
    },
    onError: () => setStatusMessage('Could not clear learned rules. Please try again.'),
  })

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-4">
        <Link to="/dashboard" className="text-slate-500 hover:text-slate-700 text-sm">← Dashboard</Link>
        <span className="text-lg font-semibold text-slate-800">Bank accounts</span>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-500">
            {accounts.length} connected account{accounts.length !== 1 ? 's' : ''}
          </p>
          <Link
            to="/accounts/connect"
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            + Add bank
          </Link>
        </div>

        {/* Grouped by what each action touches: the first row brings transactions in, the second
            reorganises the ones already stored. */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="mb-3 text-[0.7rem] font-semibold uppercase tracking-wider text-slate-400">Transaction data</p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => doSync(false)}
              disabled={syncing || accounts.length === 0}
              className="rounded-lg bg-slate-700 px-3.5 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-40"
              title="Fetch transactions added since the last sync"
            >
              {syncing ? 'Syncing…' : 'Sync all'}
            </button>
            <button
              onClick={() => {
                if (confirm('Fetch the oldest transactions each bank still offers? This can take a while, and banks usually stop offering full history some time after you connect the account.')) doSync(true)
              }}
              disabled={syncing || accounts.length === 0}
              className="rounded-lg border border-slate-300 px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40"
              title="Fetch as far back as each bank allows, not just what's new"
            >
              Fetch full history
            </button>

            <span className="mx-1 w-px self-stretch bg-slate-200" aria-hidden />

            <button
              onClick={() => doRecategorize()}
              disabled={recategorizing || accounts.length === 0}
              className="rounded-lg border border-slate-300 px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40"
              title="Re-run categorization on transactions that are still uncategorized"
            >
              {recategorizing ? 'Categorizing…' : 'Recategorize'}
            </button>
            <button
              onClick={() => setFindingDuplicates(true)}
              className="rounded-lg border border-slate-300 px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              title="Find transactions recorded twice, e.g. from a CSV import overlapping a bank sync"
            >
              Find duplicates
            </button>
            <button
              onClick={() => {
                if (confirm('Clear all rules learned from your corrections? Default rules and existing categories are kept.')) doClearRules()
              }}
              disabled={clearingRules}
              className="rounded-lg px-3.5 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
              title="Remove rules learned from your corrections, e.g. if one turned out too broad"
            >
              {clearingRules ? 'Clearing…' : 'Clear learned rules'}
            </button>
          </div>
        </div>

        {statusMessage && (
          <div className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">
            <span>{statusMessage}</span>
            <button onClick={() => setStatusMessage(null)} className="shrink-0 text-slate-400 hover:text-slate-600" aria-label="Dismiss">
              ✕
            </button>
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

        {findingDuplicates && (
          <DuplicatesDialog
            accountNameById={accountNameById}
            onClose={() => setFindingDuplicates(false)}
            onDone={setStatusMessage}
          />
        )}
      </main>
    </div>
  )
}

// Balance types that describe settled money. The rest (available, expected, forward) can fold in
// an overdraft facility or entries still in flight, so the row says which kind it is holding
// rather than letting one stand in for the other.
const BOOKED_BALANCE_TYPES = ['CLBD', 'ITBD', 'PRCD']

const BALANCE_TYPE_LABELS: Record<string, string> = {
  CLBD: 'Booked',
  ITBD: 'Booked (interim)',
  PRCD: 'Booked (previous close)',
  CLAV: 'Available',
  ITAV: 'Available (interim)',
  XPCD: 'Expected',
  FWAV: 'Forward available',
}

// The bank's own balance, shown with the two things that decide what it is worth: which balance
// it is, and what moment it describes. A bare number here would read as "this is in the account
// right now", which it can only honestly claim just after a sync.
function AccountBalance({ account }: { account: BankAccount }) {
  if (account.balance === null || account.balance === undefined) {
    return <p className="text-xs text-slate-400">Balance not read yet — sync or refresh to fetch it</p>
  }

  const type = account.balanceType ?? ''
  const isBooked = BOOKED_BALANCE_TYPES.includes(type)
  const typeLabel = BALANCE_TYPE_LABELS[type] ?? (type || 'Balance')

  // The reference date is what the figure describes; the fetch time is only how fresh our copy
  // is. Prefer the former and fall back to the latter, because one of them is always the honest
  // answer to "as at when?".
  const asOf = account.balanceReferenceDate ?? account.balanceFetchedAt ?? null

  const amount = account.balance.toLocaleString('da-DK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  const currency = account.balanceCurrency ?? account.currency

  return (
    <p className="mt-1 text-sm">
      <span className={`font-semibold tabular-nums ${account.balance < 0 ? 'text-red-600' : 'text-slate-800'}`}>
        {amount} {currency}
      </span>
      <span className="ml-2 text-xs text-slate-400">
        {typeLabel}
        {!isBooked && type && ' — may include unsettled entries'}
        {asOf && ` · as at ${new Date(asOf).toLocaleDateString('da-DK')}`}
      </span>
      {/* A balance reported in a currency other than the account's is a real difference, not a
          display quirk, so it is called out rather than quietly formatted away. */}
      {account.balanceCurrency && account.balanceCurrency !== account.currency && (
        <span className="ml-2 text-xs text-amber-600">
          reported in {account.balanceCurrency}, account is {account.currency}
        </span>
      )}
    </p>
  )
}

function AccountRow({ account, onDelete, deleting }: { account: BankAccount; onDelete: () => void; deleting: boolean }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(account.name)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importResult, setImportResult] = useState<ImportCsvResult | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [balanceError, setBalanceError] = useState<string | null>(null)

  const { mutate: doRefreshBalance, isPending: refreshingBalance } = useMutation({
    mutationFn: () => refreshBalance(account.id),
    onSuccess: () => {
      setBalanceError(null)
      qc.invalidateQueries({ queryKey: ['accounts'] })
      // The net worth entry form prefills from this balance, so a fresh figure should reach it
      // without a reload.
      qc.invalidateQueries({ queryKey: ['networth-entry'] })
    },
    onError: (err: unknown) => {
      setBalanceError(
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
          ?? 'Could not read the balance from the bank.',
      )
    },
  })

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
          <AccountBalance account={account} />
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileChange}
            className="hidden"
          />
          <Link
            to={`/accounts/${account.id}/transactions`}
            className="text-sm text-indigo-600 hover:text-indigo-800"
            title="View all transactions for this account"
          >
            Transactions
          </Link>
          <button
            onClick={() => doRefreshBalance()}
            disabled={refreshingBalance}
            className="text-sm text-slate-500 hover:text-slate-700 disabled:opacity-40"
            title="Ask the bank for this account's balance now"
          >
            {refreshingBalance ? 'Reading…' : 'Refresh balance'}
          </button>
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
      {balanceError && (
        <div className="mt-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          {balanceError}
        </div>
      )}
    </div>
  )
}

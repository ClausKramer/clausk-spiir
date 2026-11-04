import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { getBankAccounts, deleteBankAccount, renameBankAccount, importCsv, syncAll, type BankAccount, type ImportCsvResult } from '../api/accounts'
import { recategorize } from '../api/transactions'
import { syncDefaultCategories, clearLearnedRules } from '../api/categories'
import { DuplicatesDialog } from '../components/DuplicatesDialog'
import { BUTTON_PRIMARY, BUTTON_SECONDARY, BUTTON_SMALL, EmptyState, INPUT, LoadError, Notice, PageHeader, Panel, Spinner } from '../components/ui'

export function AccountsPage() {
  const qc = useQueryClient()
  const { data: accounts = [], isLoading, isError, refetch, isRefetching } = useQuery({
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
    onError: () => setStatusMessage("Couldn't remove that account. Nothing was changed."),
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

  const hasAccounts = accounts.length > 0

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Accounts"
        sub={isLoading || isError ? undefined : `${accounts.length} connected account${accounts.length !== 1 ? 's' : ''}`}
        aside={
          <Link to="/accounts/connect" className={BUTTON_PRIMARY}>
            Add bank
          </Link>
        }
      />

      {statusMessage && <Notice onDismiss={() => setStatusMessage(null)}>{statusMessage}</Notice>}

      {isLoading ? (
        <Spinner large />
      ) : isError ? (
        <LoadError what="your accounts" onRetry={() => refetch()} retrying={isRefetching} />
      ) : !hasAccounts ? (
        <Panel title="No bank accounts yet">
          <EmptyState title="Connect a bank to start tracking">
            <p>Transactions are read from your bank, and never changed there.</p>
            <Link to="/accounts/connect" className={`${BUTTON_PRIMARY} mt-4`}>
              Connect a bank
            </Link>
          </EmptyState>
        </Panel>
      ) : (
        <>
          <div className="mb-4 divide-y divide-[#232b3b] rounded-xl border border-[#232b3b] bg-[#1a1f2e]">
            {accounts.map((acc) => (
              <AccountRow key={acc.id} account={acc} onDelete={() => doDelete(acc.id)} deleting={deleting} />
            ))}
          </div>

          {/* Grouped by what each action touches: the first brings transactions in, the second
              reorganises the ones already stored. */}
          <Panel title="Get new transactions">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => doSync(false)}
                disabled={syncing}
                className={BUTTON_PRIMARY}
                title="Fetch transactions added since the last sync"
              >
                {syncing ? 'Syncing…' : 'Sync all'}
              </button>
              <button
                onClick={() => {
                  if (confirm('Fetch the oldest transactions each bank still offers? This can take a while, and banks usually stop offering full history some time after you connect the account.')) doSync(true)
                }}
                disabled={syncing}
                className={BUTTON_SECONDARY}
                title="Fetch as far back as each bank allows, not just what's new"
              >
                Fetch full history
              </button>
            </div>
          </Panel>

          <Panel title="Tidy up what's stored">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => doRecategorize()}
                disabled={recategorizing}
                className={BUTTON_SECONDARY}
                title="Re-run categorization on transactions that are still uncategorized"
              >
                {recategorizing ? 'Categorizing…' : 'Recategorize'}
              </button>
              <button
                onClick={() => setFindingDuplicates(true)}
                className={BUTTON_SECONDARY}
                title="Find transactions recorded twice, e.g. from a CSV import overlapping a bank sync"
              >
                Find duplicates
              </button>
              <button
                onClick={() => {
                  if (confirm('Clear all rules learned from your corrections? Default rules and existing categories are kept.')) doClearRules()
                }}
                disabled={clearingRules}
                className={BUTTON_SECONDARY}
                title="Remove rules learned from your corrections, e.g. if one turned out too broad"
              >
                {clearingRules ? 'Clearing…' : 'Clear learned rules'}
              </button>
            </div>
          </Panel>
        </>
      )}

      {findingDuplicates && (
        <DuplicatesDialog
          accountNameById={accountNameById}
          onClose={() => setFindingDuplicates(false)}
          onDone={setStatusMessage}
        />
      )}
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
    <div className="px-4 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
        <div className="min-w-0 flex-1 basis-56">
          {editing ? (
            <form
              onSubmit={(e) => { e.preventDefault(); submit() }}
              className="flex items-center gap-2"
            >
              <input
                autoFocus
                value={name}
                aria-label="Account name"
                onChange={(e) => setName(e.target.value)}
                onBlur={submit}
                onKeyDown={(e) => { if (e.key === 'Escape') { setEditing(false); setName(account.name) } }}
                disabled={renaming}
                className={`${INPUT} w-full font-medium`}
              />
            </form>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="text-left font-medium break-words text-slate-100 underline decoration-slate-600 decoration-dotted underline-offset-4 hover:text-indigo-300"
              title="Rename account"
            >
              {account.name}
            </button>
          )}
          {account.iban && <p className="mt-0.5 text-xs break-all text-slate-400">{account.iban}</p>}
          <p className="text-xs text-slate-400">
            {account.lastSyncedAt
              ? `Last synced ${new Date(account.lastSyncedAt).toLocaleDateString('da-DK')}`
              : 'Never synced'}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileChange}
            className="hidden"
          />
          <Link
            to={`/accounts/${account.id}/transactions`}
            className={BUTTON_SMALL}
            title="View all transactions for this account"
          >
            Transactions
          </Link>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className={BUTTON_SMALL}
            title="Import older transactions from a CSV file"
          >
            {importing ? 'Importing…' : 'Import CSV'}
          </button>
          <button
            onClick={() => { if (confirm(`Remove “${account.name}” and all its transactions? This can't be undone.`)) onDelete() }}
            disabled={deleting}
            className={`${BUTTON_SMALL} !border-red-900 !text-red-300 enabled:hover:!bg-red-950`}
          >
            Remove
          </button>
        </div>
      </div>

      {importResult && (
        <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200" role="status">
          <p>{importResult.message}</p>
          {importResult.errors.length > 0 && (
            <ul className="mt-1 list-disc pl-4 text-amber-200">
              {importResult.errors.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}
              {importResult.errors.length > 5 && <li>…and {importResult.errors.length - 5} more.</li>}
            </ul>
          )}
        </div>
      )}
      {importError && (
        <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300" role="alert">
          {importError}
        </div>
      )}
    </div>
  )
}

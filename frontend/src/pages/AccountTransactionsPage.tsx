import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, useSearchParams } from 'react-router-dom'
import { getTransactions, markDuplicate, type Period } from '../api/transactions'
import { getBankAccounts } from '../api/accounts'
import { PeriodNavigator } from '../components/PeriodNavigator'
import { ScheduledBadge, TransactionList } from '../components/TransactionList'
import { BUTTON_SECONDARY, EmptyState, LoadError, PageHeader, Panel, REVEAL_ON_ROW_HOVER, Spinner } from '../components/ui'
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
  const accountNameById = new Map(accounts.map((a) => [a.id, a.name]))

  // This list deliberately shows duplicates, so it's also where they can be undone.
  const { mutate: setDuplicate } = useMutation({
    mutationFn: ({ txId, value }: { txId: string; value: boolean }) => markDuplicate([txId], value),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['duplicates'] })
    },
  })

  const { data: txPage, isLoading, isError, refetch, isRefetching } = useQuery({
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
    <div>
      <PageHeader
        title={account ? account.name : 'Transactions'}
        back={{ to: '/accounts', label: 'Accounts' }}
        sub={
          txPage && (
            <>
              {txPage.totalCount} transaction{txPage.totalCount === 1 ? '' : 's'}
              {period ? ` in ${periodLabel(period)}` : ', all history'}
            </>
          )
        }
      />

      <div className="mb-4">
        <PeriodNavigator allowAllYears period={period} onChange={changePeriod} availableYears={years} />
      </div>

      {isLoading ? (
        <Spinner large />
      ) : isError && !txPage ? (
        <LoadError what="this account's transactions" onRetry={() => refetch()} retrying={isRefetching} />
      ) : !txPage || txPage.items.length === 0 ? (
        <Panel title="Transactions">
          {period ? (
            <EmptyState title={`Nothing in ${periodLabel(period)}`}>
              Step to another month, or choose All years to see the whole account.
            </EmptyState>
          ) : (
            <EmptyState title="No transactions for this account">
              Sync the account, or import older history from a CSV file on the Accounts page.
            </EmptyState>
          )}
        </Panel>
      ) : (
        <>
          <Panel title="Transactions">
            <TransactionList
              items={txPage.items}
              accountNameById={accountNameById}
              showAccount={false}
              dimmed={(tx) => tx.isFuture || tx.isDuplicate}
              strike={(tx) => tx.isDuplicate}
              flags={(tx) => (
                <>
                  {tx.isFuture && <ScheduledBadge />}
                  {tx.isDuplicate ? (
                    <button
                      onClick={() => setDuplicate({ txId: tx.id, value: false })}
                      className="rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-300 hover:bg-red-500/20"
                      title="Excluded as a duplicate — click to restore it"
                    >
                      Duplicate ✕
                    </button>
                  ) : (
                    <button
                      onClick={() => setDuplicate({ txId: tx.id, value: true })}
                      className={`rounded-full px-2 py-0.5 text-xs text-slate-400 hover:text-red-300 ${REVEAL_ON_ROW_HOVER}`}
                      title="Mark as a duplicate copy, so it's excluded from every total"
                    >
                      Mark duplicate
                    </button>
                  )}
                </>
              )}
            />
          </Panel>

          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm">
              <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} className={BUTTON_SECONDARY}>
                ← Previous
              </button>
              <span className="text-slate-400">Page {page} of {totalPages}</span>
              <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages} className={BUTTON_SECONDARY}>
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { getInstitutions, connectBank } from '../api/accounts'
import { EmptyState, INPUT, LoadError, PageHeader, Spinner } from '../components/ui'

export function ConnectBankPage() {
  const [search, setSearch] = useState('')

  const { data: institutions = [], isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['institutions'],
    queryFn: () => getInstitutions('DK'),
  })

  const { mutate: doConnect, isPending: connecting, isError: connectFailed } = useMutation({
    mutationFn: ({ name, country }: { name: string; country: string }) => connectBank(name, country),
    onSuccess: ({ url }) => {
      window.location.href = url
    },
  })

  const filtered = institutions.filter((i) =>
    i.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="max-w-xl">
      <PageHeader
        title="Choose your bank"
        sub="You'll approve read-only access at your bank, then come straight back."
        back={{ to: '/accounts', label: 'Accounts' }}
      />

      <input
        type="search"
        placeholder="Search banks…"
        aria-label="Search banks"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className={`${INPUT} mb-4 w-full`}
      />

      {connectFailed && (
        <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300" role="alert">
          Couldn't start the connection with that bank. Try again in a moment.
        </p>
      )}

      {isLoading ? (
        <Spinner />
      ) : isError ? (
        <LoadError what="the list of banks" hint="The bank connection service didn't answer." onRetry={() => refetch()} retrying={isRefetching} />
      ) : (
        <div className="divide-y divide-[#232b3b] rounded-xl border border-[#232b3b] bg-[#1a1f2e]">
          {filtered.map((inst) => (
            <button
              key={`${inst.name}:${inst.country}`}
              disabled={connecting}
              onClick={() => doConnect({ name: inst.name, country: inst.country })}
              className="flex w-full items-center gap-4 px-4 py-3 text-left first:rounded-t-xl last:rounded-b-xl hover:bg-white/[0.03] disabled:opacity-50"
            >
              {inst.logo ? (
                <img src={inst.logo} alt="" className="h-8 w-8 rounded bg-white object-contain" />
              ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded bg-[#232b3b] text-xs font-bold text-slate-300">
                  {inst.name[0]}
                </div>
              )}
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-200">{inst.name}</p>
                {inst.bic && <p className="text-xs text-slate-400">{inst.bic}</p>}
              </div>
              <span className="ml-auto text-slate-400" aria-hidden>›</span>
            </button>
          ))}

          {filtered.length === 0 && <EmptyState title={`No bank matches “${search}”`} />}
        </div>
      )}
    </div>
  )
}

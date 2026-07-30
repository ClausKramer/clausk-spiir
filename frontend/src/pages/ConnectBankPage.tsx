import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { getInstitutions, connectBank } from '../api/accounts'

export function ConnectBankPage() {
  const [search, setSearch] = useState('')

  const { data: institutions = [], isLoading, isError } = useQuery({
    queryKey: ['institutions'],
    queryFn: () => getInstitutions('DK'),
  })

  const { mutate: doConnect, isPending: connecting } = useMutation({
    mutationFn: connectBank,
    onSuccess: ({ link }) => {
      window.location.href = link
    },
  })

  const filtered = institutions.filter((i) =>
    i.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-4">
        <Link to="/accounts" className="text-slate-500 hover:text-slate-700 text-sm">← Back</Link>
        <span className="text-lg font-semibold text-slate-800">Choose your bank</span>
      </header>

      <main className="mx-auto max-w-xl px-6 py-8">
        <input
          type="search"
          placeholder="Search banks…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 mb-4"
        />

        {isLoading && (
          <div className="flex justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
          </div>
        )}

        {isError && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            Could not load banks. Make sure GoCardless credentials are configured in user-secrets.
          </div>
        )}

        <div className="rounded-xl bg-white border border-slate-100 shadow-sm divide-y divide-slate-100">
          {filtered.map((inst) => (
            <button
              key={inst.id}
              disabled={connecting}
              onClick={() => doConnect(inst.id)}
              className="w-full flex items-center gap-4 px-5 py-4 hover:bg-slate-50 disabled:opacity-50 text-left"
            >
              {inst.logo ? (
                <img src={inst.logo} alt={inst.name} className="h-8 w-8 object-contain rounded" />
              ) : (
                <div className="h-8 w-8 rounded bg-slate-200 flex items-center justify-center text-slate-500 text-xs font-bold">
                  {inst.name[0]}
                </div>
              )}
              <div>
                <p className="text-sm font-medium text-slate-800">{inst.name}</p>
                {inst.bic && <p className="text-xs text-slate-400">{inst.bic}</p>}
              </div>
              <span className="ml-auto text-slate-300">›</span>
            </button>
          ))}

          {!isLoading && filtered.length === 0 && (
            <p className="px-5 py-8 text-center text-sm text-slate-400">No banks found.</p>
          )}
        </div>
      </main>
    </div>
  )
}

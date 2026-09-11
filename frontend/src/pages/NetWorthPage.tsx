import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import {
  getNetWorthDashboard,
  getNetWorthDue,
  getNetWorthAccounts,
  createNetWorthAccount,
  updateNetWorthAccount,
  deleteNetWorthAccount,
  importNetWorth,
  KIND_LABELS,
  ASSET_KINDS,
  LIABILITY_KINDS,
  type NetWorthKind,
} from '../api/networth'
import { NetWorthChart } from '../components/NetWorthChart'
import { NetWorthEntryDialog } from '../components/NetWorthEntryDialog'
import { BarRow } from '../components/BarRow'
import { INCOME, EXPENSE, NET } from '../lib/chartColors'
import { MONTH_NAMES } from '../lib/period'

const kr = (n: number) =>
  n.toLocaleString('da-DK', { style: 'currency', currency: 'DKK', maximumFractionDigits: 0 })

const signed = (n: number) => `${n >= 0 ? '+' : ''}${kr(n)}`

export function NetWorthPage() {
  const qc = useQueryClient()
  const [search, setSearch] = useSearchParams()
  const update = (mutate: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(search)
    mutate(next)
    setSearch(next, { replace: true })
  }

  // Same URL convention as everywhere else: absent means the page's default, which here is the
  // current year. `scope=lifetime` spans every month on record instead.
  const scope: 'year' | 'lifetime' = search.get('scope') === 'lifetime' ? 'lifetime' : 'year'
  const year = Number(search.get('year')) || new Date().getFullYear()

  const [entryFor, setEntryFor] = useState<{ year: number; month: number } | null>(null)
  const [managing, setManaging] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['networth-dashboard', scope, year],
    queryFn: () => getNetWorthDashboard(scope, scope === 'lifetime' ? undefined : year),
    placeholderData: (prev) => prev,
  })
  const { data: due } = useQuery({ queryKey: ['networth-due'], queryFn: getNetWorthDue })

  const latest = data?.latest
  const series = data?.series ?? []

  const assetKinds = (data?.byKind ?? []).filter((k) => !k.isLiability)
  const liabilityKinds = (data?.byKind ?? []).filter((k) => k.isLiability)
  // Bars are scaled on magnitude, since a debt's value is negative but its bar still has length.
  const maxKind = Math.max(...(data?.byKind ?? []).map((k) => Math.abs(k.value)), 1)

  return (
    <div className="min-h-screen bg-[#0f1117] px-4 py-6 text-slate-200 md:px-8 md:py-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link to="/dashboard" className="text-xs text-slate-500 hover:text-slate-300">
              ← Spending
            </Link>
            <h1 className="mt-1 text-xl font-bold text-slate-50">📈 Net worth</h1>
            <p className="mt-0.5 text-xs text-slate-500">
              {scope === 'lifetime' ? 'Everything on record' : year}
              {latest && ` · latest ${MONTH_NAMES[latest.month - 1]} ${latest.year}`}
              {data && ` · ${data.accountCount} account${data.accountCount === 1 ? '' : 's'}`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setManaging(true)}
              className="rounded-lg border border-slate-700 bg-[#1a1f2e] px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-[#232b3b]"
            >
              Accounts
            </button>
            <button
              onClick={() =>
                setEntryFor(
                  due ? { year: due.year, month: due.month } : { year, month: new Date().getMonth() + 1 },
                )
              }
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
            >
              Record values
            </button>
          </div>
        </div>

        {status && (
          <div className="mb-4 rounded-lg border border-[#232b3b] bg-[#1a1f2e] px-4 py-2.5 text-sm text-slate-300">
            {status}
          </div>
        )}

        {/* The monthly prompt. Shown from the 5th, for the month that has just finished — by
            then statements and valuations have settled, so the figure recorded is a real one. */}
        {due?.isDue && (
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-500/40 bg-indigo-500/10 px-4 py-3">
            <div className="text-sm text-indigo-200">
              <span className="font-semibold">
                Time to record {MONTH_NAMES[due.month - 1]} {due.year}.
              </span>{' '}
              <span className="text-indigo-300/80">
                {due.missingCount} of {due.accountCount} account{due.accountCount === 1 ? '' : 's'} still need a
                value.
              </span>
            </div>
            <button
              onClick={() => setEntryFor({ year: due.year, month: due.month })}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
            >
              Enter values
            </button>
          </div>
        )}

        {/* Period */}
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <span className="mr-1 text-[0.7rem] uppercase tracking-wider text-slate-500">Period</span>
          <select
            value={scope === 'lifetime' ? 'lifetime' : String(year)}
            onChange={(e) =>
              update((p) => {
                if (e.target.value === 'lifetime') {
                  p.set('scope', 'lifetime')
                  p.delete('year')
                } else {
                  p.delete('scope')
                  p.set('year', e.target.value)
                }
              })
            }
            className="rounded-lg border border-slate-700 bg-[#1a1f2e] px-2.5 py-1 text-xs font-medium text-slate-200 outline-none focus:border-indigo-500"
            aria-label="Period"
          >
            {(data?.availableYears ?? [year]).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
            <option value="lifetime">Lifetime</option>
          </select>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
          </div>
        ) : !data?.hasAnyRecords ? (
          <Panel title="Nothing recorded yet">
            <div className="py-8 text-center">
              <div className="mb-2 text-3xl">📈</div>
              <p className="text-slate-400">
                {data?.accountCount === 0
                  ? 'Add the things you own and owe — savings, investments, pension, property, loans — then record what each is worth once a month.'
                  : 'Record what each account is worth and the picture starts here.'}
              </p>
              <button
                onClick={() => (data?.accountCount === 0 ? setManaging(true) : setEntryFor({ year, month: new Date().getMonth() + 1 }))}
                className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
              >
                {data?.accountCount === 0 ? 'Add accounts' : 'Record values'}
              </button>
            </div>
          </Panel>
        ) : (
          <>
            <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Kpi label="Net worth" value={kr(latest?.net ?? 0)} color={NET} />
              <Kpi label="What you own" value={kr(latest?.assets ?? 0)} color={INCOME} />
              <Kpi label="What you owe" value={kr(latest?.liabilities ?? 0)} color={EXPENSE} />
              <Kpi
                label={scope === 'lifetime' ? 'Since records began' : `Change in ${year}`}
                value={latest?.changeInPeriod === null || latest?.changeInPeriod === undefined ? '—' : signed(latest.changeInPeriod)}
                color={(latest?.changeInPeriod ?? 0) >= 0 ? INCOME : EXPENSE}
                sub={
                  latest?.changeLastMonth === null || latest?.changeLastMonth === undefined
                    ? `${latest?.monthsRecorded ?? 0} month${latest?.monthsRecorded === 1 ? '' : 's'} recorded`
                    : `${signed(latest.changeLastMonth)} last month`
                }
              />
            </div>

            <Panel title={`📈 Net worth over time — ${scope === 'lifetime' ? 'all records' : year}`}>
              <NetWorthChart data={series} />
            </Panel>

            {/* The question a single net figure can't answer: net worth can rise while debt
                rises too, so what you own and what you owe are broken out separately. */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Panel title="🟢 What you own">
                <KindList kinds={assetKinds} max={maxKind} color={INCOME} scope={scope} year={year} />
              </Panel>
              <Panel title="🔴 What you owe">
                {liabilityKinds.length === 0 ? (
                  <p className="py-6 text-center text-sm text-slate-600">Nothing owed on record.</p>
                ) : (
                  <KindList kinds={liabilityKinds} max={maxKind} color={EXPENSE} scope={scope} year={year} />
                )}
              </Panel>
            </div>

            <Panel title="🗂️ By account">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#232b3b] text-left text-[0.68rem] uppercase tracking-wider text-slate-600">
                      <th className="py-2 pr-3 font-medium">Account</th>
                      <th className="py-2 pr-3 font-medium">Kind</th>
                      <th className="py-2 pr-3 text-right font-medium">Latest</th>
                      <th className="py-2 pr-3 text-right font-medium">Last month</th>
                      <th className="py-2 pl-3 text-right font-medium">
                        {scope === 'lifetime' ? 'Since start' : `In ${year}`}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byAccount.map((a) => {
                      // For a liability, falling is progress — so the sign that colours the cell
                      // is inverted. Paying down a loan must not read as a loss.
                      const period = a.value - a.since
                      const month = a.value - a.sinceLastMonth
                      // With debts stored negative, up is good for everything: a mortgage going
                      // from -500.000 to -490.000 is a rise of 10.000 and progress either way.
                      const good = (v: number) => v >= 0
                      return (
                        <tr key={a.accountId} className="border-b border-[#1e2535] last:border-none">
                          <td className="py-2 pr-3 text-slate-300">{a.name}</td>
                          <td className="py-2 pr-3 text-slate-500">{KIND_LABELS[a.kind]}</td>
                          <td
                            className="py-2 pr-3 text-right font-semibold tabular-nums"
                            style={{ color: a.value < 0 ? EXPENSE : '#e2e8f0' }}
                          >
                            {kr(a.value)}
                          </td>
                          <td
                            className="py-2 pr-3 text-right tabular-nums"
                            style={{ color: month === 0 ? '#64748b' : good(month) ? INCOME : EXPENSE }}
                          >
                            {month === 0 ? '—' : signed(month)}
                          </td>
                          <td
                            className="py-2 pl-3 text-right tabular-nums"
                            style={{ color: period === 0 ? '#64748b' : good(period) ? INCOME : EXPENSE }}
                          >
                            {period === 0 ? '—' : signed(period)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-[0.68rem] text-slate-600">
                Green is movement in your favour — assets up, debt down.
              </p>
            </Panel>
          </>
        )}
      </div>

      {entryFor && (
        <NetWorthEntryDialog
          year={entryFor.year}
          month={entryFor.month}
          onClose={() => setEntryFor(null)}
          onSaved={(m) => {
            setStatus(m)
            qc.invalidateQueries({ queryKey: ['networth-dashboard'] })
          }}
        />
      )}
      {managing && <ManageAccountsDialog onClose={() => setManaging(false)} onChanged={setStatus} />}
    </div>
  )
}

function KindList({
  kinds,
  max,
  color,
  scope,
  year,
}: {
  kinds: { kind: NetWorthKind; value: number; since: number; sinceLastMonth: number }[]
  max: number
  color: string
  scope: 'year' | 'lifetime'
  year: number
}) {
  if (kinds.length === 0) return <p className="py-6 text-center text-sm text-slate-600">Nothing on record.</p>
  return (
    <div className="space-y-1.5">
      {kinds.map((k) => {
        const change = k.value - k.since
        // Up is good for everything now that debts are negative.
        const good = change >= 0
        return (
          <BarRow
            key={k.kind}
            labelWidth="w-32"
            label={KIND_LABELS[k.kind]}
            // Magnitude: a debt of -487.907 draws a bar 487.907 long.
            fraction={Math.abs(k.value) / max}
            amount={kr(k.value)}
            color={color}
            metaWidth="w-28"
            meta={
              change === 0 ? (
                <span className="text-slate-600">no change</span>
              ) : (
                <span style={{ color: good ? INCOME : EXPENSE }} title={scope === 'lifetime' ? 'Since records began' : `Change in ${year}`}>
                  {signed(change)}
                </span>
              )
            }
          />
        )
      })}
    </div>
  )
}

// Managing what gets tracked. Archive is the default way to retire an account; deleting is
// offered but warns, because removing an account silently rewrites every past month.
function ManageAccountsDialog({ onClose, onChanged }: { onClose: () => void; onChanged: (m: string) => void }) {
  const qc = useQueryClient()
  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['networth-accounts'],
    queryFn: () => getNetWorthAccounts(true),
  })

  const [name, setName] = useState('')
  const [kind, setKind] = useState<NetWorthKind>('Savings')

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['networth-accounts'] })
    qc.invalidateQueries({ queryKey: ['networth-dashboard'] })
    qc.invalidateQueries({ queryKey: ['networth-due'] })
    qc.invalidateQueries({ queryKey: ['networth-entry'] })
  }

  const { mutate: add, isPending: adding } = useMutation({
    mutationFn: () => createNetWorthAccount({ name: name.trim(), kind }),
    onSuccess: () => {
      refresh()
      onChanged(`Added ${name.trim()}.`)
      setName('')
    },
  })
  const { mutate: setArchived } = useMutation({
    mutationFn: (a: { id: string; name: string; kind: NetWorthKind; isArchived: boolean }) =>
      updateNetWorthAccount(a.id, { name: a.name, kind: a.kind, isArchived: a.isArchived }),
    onSuccess: refresh,
  })
  const { mutate: remove } = useMutation({
    mutationFn: (id: string) => deleteNetWorthAccount(id),
    onSuccess: () => {
      refresh()
      onChanged('Account and its history removed.')
    },
  })

  // Bulk import from a file produced by scripts/parse-networth-xlsx.mjs. Kept behind a file
  // picker rather than parsing a spreadsheet in the browser: the parsing needs checking against
  // the workbook's own totals, and that check belongs somewhere it can be re-run, not in a
  // one-shot upload.
  const { mutate: runImport, isPending: importing } = useMutation({
    mutationFn: async (file: File) => {
      const payload = JSON.parse(await file.text())
      if (!Array.isArray(payload?.accounts) || !Array.isArray(payload?.snapshots))
        throw new Error('That file does not look like a net worth export.')
      return importNetWorth(payload)
    },
    onSuccess: (result) => {
      refresh()
      onChanged(result.message)
    },
    onError: (e: Error) => onChanged(e.message ?? 'Import failed.'),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="flex max-h-[88vh] w-full max-w-2xl flex-col rounded-xl border border-[#232b3b] bg-[#1a1f2e] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-[#232b3b] px-6 py-4">
          <h2 className="text-base font-semibold text-slate-100">What are we tracking?</h2>
          <p className="mt-1 text-sm text-slate-500">
            Anything with a value worth following — savings, investments, pension, property, and what
            you owe on them. The kind is what makes "are the loans going down" answerable.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-3">
          {isLoading ? (
            <div className="flex justify-center py-10">
              <div className="h-6 w-6 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
            </div>
          ) : (
            <div className="space-y-1">
              {accounts.map((a) => (
                <div
                  key={a.id}
                  className={`flex items-center gap-3 rounded px-2 py-2 ${a.isArchived ? 'opacity-50' : ''}`}
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ background: a.isLiability ? EXPENSE : INCOME }}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-200">{a.name}</span>
                  <span className="shrink-0 text-[0.68rem] text-slate-500">{KIND_LABELS[a.kind]}</span>
                  <button
                    onClick={() => setArchived({ id: a.id, name: a.name, kind: a.kind, isArchived: !a.isArchived })}
                    className="shrink-0 rounded border border-slate-700 px-2 py-0.5 text-[0.65rem] text-slate-400 hover:bg-[#232b3b]"
                    title={
                      a.isArchived
                        ? 'Start asking for this account again'
                        : "Stop asking for it, but keep the months it's already in"
                    }
                  >
                    {a.isArchived ? 'Unarchive' : 'Archive'}
                  </button>
                  <button
                    onClick={() => {
                      if (
                        confirm(
                          `Delete "${a.name}" and every value ever recorded for it?\n\nThis changes what past months were worth. Archiving keeps the history and just stops asking.`,
                        )
                      )
                        remove(a.id)
                    }}
                    className="shrink-0 rounded border border-red-900 px-2 py-0.5 text-[0.65rem] text-red-400 hover:bg-red-950"
                  >
                    Delete
                  </button>
                </div>
              ))}
              {accounts.length === 0 && (
                <p className="py-6 text-center text-sm text-slate-500">Nothing tracked yet.</p>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-[#232b3b] px-6 py-4">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (name.trim()) add()
            }}
            className="flex flex-wrap items-center gap-2"
          >
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Account name"
              maxLength={120}
              className="min-w-40 flex-1 rounded border border-slate-700 bg-[#111620] px-2.5 py-1.5 text-sm text-slate-200 outline-none focus:border-indigo-500"
            />
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as NetWorthKind)}
              className="rounded border border-slate-700 bg-[#111620] px-2.5 py-1.5 text-sm text-slate-200 outline-none focus:border-indigo-500"
            >
              <optgroup label="What you own">
                {ASSET_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABELS[k]}
                  </option>
                ))}
              </optgroup>
              <optgroup label="What you owe">
                {LIABILITY_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABELS[k]}
                  </option>
                ))}
              </optgroup>
            </select>
            <button
              type="submit"
              disabled={adding || !name.trim()}
              className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              Add
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-700 px-4 py-1.5 text-sm text-slate-300 hover:bg-[#232b3b]"
            >
              Done
            </button>
          </form>

          <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-slate-500">
            <input
              type="file"
              accept="application/json,.json"
              disabled={importing}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) runImport(file)
                e.target.value = ''
              }}
              className="hidden"
            />
            <span className="rounded border border-slate-700 px-2.5 py-1 text-slate-400 hover:bg-[#232b3b]">
              {importing ? 'Importing…' : 'Import history…'}
            </span>
            <span>a JSON export of an existing spreadsheet. Safe to run twice.</span>
          </label>
        </div>
      </div>
    </div>
  )
}

function Kpi({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-[#232b3b] bg-[#1a1f2e] px-4 py-3.5">
      <div className="mb-1.5 text-[0.68rem] uppercase tracking-wider text-slate-600">{label}</div>
      <div className="text-xl font-bold tabular-nums" style={color ? { color } : undefined}>
        {value}
      </div>
      {sub && <div className="mt-1 text-[0.68rem] text-slate-600">{sub}</div>}
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5 rounded-xl border border-[#232b3b] bg-[#1a1f2e] p-4 md:p-5">
      <div className="mb-4 text-[0.7rem] font-bold uppercase tracking-wider text-slate-600">{title}</div>
      {children}
    </div>
  )
}

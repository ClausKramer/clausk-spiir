import { useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import {
  getNetWorthDashboard,
  getNetWorthDue,
  getNetWorthAccounts,
  createNetWorthAccount,
  updateNetWorthAccount,
  deleteNetWorthAccount,
  importNetWorth,
  saveNetWorthEntry,
  KIND_LABELS,
  ASSET_KINDS,
  LIABILITY_KINDS,
  type NetWorthKind,
} from '../api/networth'
import { NetWorthChart } from '../components/NetWorthChart'
import { NetWorthEntryDialog } from '../components/NetWorthEntryDialog'
import { BarRow } from '../components/BarRow'
import { INCOME, EXPENSE } from '../lib/chartColors'
import { BUTTON_PRIMARY, BUTTON_SECONDARY, BUTTON_SMALL, INPUT, Kpi, LoadError, Modal, Notice, PageHeader, Panel, Spinner } from '../components/ui'
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

  const {
    data,
    isLoading,
    isError,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ['networth-dashboard', scope, year],
    queryFn: () => getNetWorthDashboard(scope, scope === 'lifetime' ? undefined : year),
    placeholderData: (prev) => prev,
  })
  const { data: due } = useQuery({ queryKey: ['networth-due'], queryFn: getNetWorthDue })

  const { mutate: runImport, isPending: importing } = useMutation({
    mutationFn: async (file: File) => {
      const payload = JSON.parse(await file.text())
      if (!Array.isArray(payload?.accounts) || !Array.isArray(payload?.snapshots))
        throw new Error('That file does not look like a net worth export.')
      return importNetWorth(payload)
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['networth-dashboard'] })
      qc.invalidateQueries({ queryKey: ['networth-due'] })
      qc.invalidateQueries({ queryKey: ['networth-accounts'] })
      qc.invalidateQueries({ queryKey: ['networth-entry'] })
      setStatus(result.message)
      setManaging(false)
    },
    // Surfaced rather than swallowed: an import that fails silently looks exactly like an
    // import that was never started, which is the confusing case.
    onError: (e: Error) => setStatus(e.message || 'Import failed.'),
  })

  const latest = data?.latest
  const series = data?.series ?? []

  // Corrects one account's figure for the latest month on screen, straight from the table. Only
  // the one value is sent: the entry endpoint touches just the accounts it is given, so the rest
  // of the month is left exactly as it was.
  const { mutateAsync: saveOne } = useMutation({
    mutationFn: (v: { accountId: string; value: number }) =>
      saveNetWorthEntry({
        year: latest!.year,
        month: latest!.month,
        values: [{ accountId: v.accountId, value: v.value }],
      }),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['networth-dashboard'] })
      qc.invalidateQueries({ queryKey: ['networth-due'] })
      qc.invalidateQueries({ queryKey: ['networth-entry'] })
      setStatus(result.message)
    },
    // Surfaced on the page: a failed save that quietly reverts looks exactly like one that worked.
    onError: () => setStatus("Couldn't save that figure — the request failed, so nothing was changed."),
  })

  const assetKinds = (data?.byKind ?? []).filter((k) => !k.isLiability)
  const liabilityKinds = (data?.byKind ?? []).filter((k) => k.isLiability)
  // Bars are scaled on magnitude, since a debt's value is negative but its bar still has length.
  const maxKind = Math.max(...(data?.byKind ?? []).map((k) => Math.abs(k.value)), 1)

  return (
    <div>
      <div>
        <PageHeader
          title="Net worth"
          sub={
            <>
              {scope === 'lifetime' ? 'Everything on record' : year}
              {latest && `, latest ${MONTH_NAMES[latest.month - 1]} ${latest.year}`}
            </>
          }
          aside={
            <div className="flex flex-wrap items-center gap-2">
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
                className={INPUT}
                aria-label="Period"
              >
                {(data?.availableYears ?? [year]).map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
                <option value="lifetime">Lifetime</option>
              </select>
              <button onClick={() => setManaging(true)} className={BUTTON_SECONDARY}>
                Accounts
              </button>
              <button
                onClick={() =>
                  setEntryFor(
                    due ? { year: due.year, month: due.month } : { year, month: new Date().getMonth() + 1 },
                  )
                }
                className={BUTTON_PRIMARY}
              >
                Record values
              </button>
            </div>
          }
        />

        {status && <Notice onDismiss={() => setStatus(null)}>{status}</Notice>}

        {/* The monthly prompt. Shown from the 5th, for the month that has just finished — by
            then statements and valuations have settled, so the figure recorded is a real one. */}
        {due?.isDue && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-500/40 bg-indigo-500/10 px-4 py-3">
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
              className={BUTTON_PRIMARY}
            >
              Enter values
            </button>
          </div>
        )}

                {isLoading ? (
          <Spinner large />
        ) : isError && !data ? (
          <LoadError what="your net worth" onRetry={() => refetch()} retrying={isRefetching} />
        ) : !data?.hasAnyRecords ? (
          <Panel title="Nothing recorded yet">
            <div className="py-8 text-center">
              <p className="text-slate-400">
                {data?.accountCount === 0
                  ? 'Add the things you own and owe — savings, investments, pension, property, loans — then record what each is worth once a month.'
                  : 'Record what each account is worth and the picture starts here.'}
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                <button
                  onClick={() => (data?.accountCount === 0 ? setManaging(true) : setEntryFor({ year, month: new Date().getMonth() + 1 }))}
                  className={BUTTON_PRIMARY}
                >
                  {data?.accountCount === 0 ? 'Add accounts' : 'Record values'}
                </button>
                <ImportButton
                  importing={importing}
                  onPick={(f) => runImport(f)}
                  label="Import from a file"
                  className={BUTTON_SECONDARY}
                />
              </div>
              <p className="mt-3 text-xs text-slate-400">
                Already keep this in a spreadsheet? Import the exported JSON — it's safe to run twice.
              </p>
            </div>
          </Panel>
        ) : (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
              <Kpi prominent label="Net worth" value={kr(latest?.net ?? 0)} valueClass="text-slate-50" />
              <Kpi label="What you own" value={kr(latest?.assets ?? 0)} valueClass="text-emerald-400" />
              <Kpi label="What you owe" value={kr(latest?.liabilities ?? 0)} valueClass="text-red-400" />
              <Kpi
                label={scope === 'lifetime' ? 'Since records began' : `Change in ${year}`}
                value={latest?.changeInPeriod === null || latest?.changeInPeriod === undefined ? '—' : signed(latest.changeInPeriod)}
                wide
                valueClass={(latest?.changeInPeriod ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}
                sub={
                  latest?.changeLastMonth === null || latest?.changeLastMonth === undefined
                    ? `${latest?.monthsRecorded ?? 0} month${latest?.monthsRecorded === 1 ? '' : 's'} recorded`
                    : `${signed(latest.changeLastMonth)} last month`
                }
              />
            </div>

            <Panel title={`Net worth over time — ${scope === 'lifetime' ? 'all records' : year}`}>
              <NetWorthChart data={series} onSelect={(p) => setEntryFor({ year: p.year, month: p.month })} />
              <p className="mt-2 text-center text-xs text-slate-400">
                Tap a month to see and correct its figures.
              </p>
            </Panel>

            {/* The question a single net figure can't answer: net worth can rise while debt
                rises too, so what you own and what you owe are broken out separately. */}
            <div className="grid grid-cols-1 gap-x-4 lg:grid-cols-2">
              <Panel title="What you own">
                <KindList kinds={assetKinds} max={maxKind} color={INCOME} scope={scope} year={year} />
              </Panel>
              <Panel title="What you owe">
                {liabilityKinds.length === 0 ? (
                  <p className="py-6 text-center text-sm text-slate-400">Nothing owed on record.</p>
                ) : (
                  <KindList kinds={liabilityKinds} max={maxKind} color={EXPENSE} scope={scope} year={year} />
                )}
              </Panel>
            </div>

            <Panel title="By account">
              <div className="hidden grid-cols-[minmax(0,1fr)_8rem_9rem_8rem_8rem] gap-x-3 border-b border-[#232b3b] pb-2 text-xs font-medium text-slate-400 md:grid">
                <div>Account</div>
                <div>Kind</div>
                <div className="text-right">
                  {MONTH_NAMES[latest!.month - 1]} {latest!.year}
                </div>
                <div className="text-right">Last month</div>
                <div className="text-right">{scope === 'lifetime' ? 'Since start' : `In ${year}`}</div>
              </div>
              <ul>
                {data.byAccount.map((a) => {
                  const period = a.value - a.since
                  const month = a.value - a.sinceLastMonth
                  // With debts stored negative, up is good for everything: a mortgage going from
                  // -500.000 to -490.000 is a rise of 10.000 and progress either way.
                  const change = (v: number) => (v === 0 ? 'text-slate-400' : v > 0 ? 'text-emerald-400' : 'text-red-400')
                  return (
                    <li
                      key={a.accountId}
                      className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 border-b border-[#1e2535] py-2.5 text-sm last:border-none md:grid-cols-[minmax(0,1fr)_8rem_9rem_8rem_8rem] md:items-center"
                    >
                      <div className="min-w-0 break-words text-slate-200">{a.name}</div>
                      <div className="row-start-2 text-xs text-slate-400 md:row-start-auto md:text-sm">{KIND_LABELS[a.kind]}</div>
                      <div className="col-start-2 row-start-1 text-right md:col-start-auto md:row-start-auto">
                        <EditableValue
                          value={a.value}
                          label={`${a.name} for ${MONTH_NAMES[latest!.month - 1]} ${latest!.year}`}
                          className={a.value < 0 ? 'text-red-400' : 'text-slate-200'}
                          onSave={(value) => saveOne({ accountId: a.accountId, value })}
                        />
                      </div>
                      <div className={`col-start-2 row-start-2 text-right text-xs tabular-nums md:col-start-auto md:row-start-auto md:text-sm ${change(month)}`}>
                        {month === 0 ? '—' : signed(month)}
                        <span className="text-slate-400 md:hidden"> last month</span>
                      </div>
                      <div className={`col-start-2 row-start-3 text-right text-xs tabular-nums md:col-start-auto md:row-start-auto md:text-sm ${change(period)}`}>
                        {period === 0 ? '—' : signed(period)}
                        <span className="text-slate-400 md:hidden"> {scope === 'lifetime' ? 'since start' : `in ${year}`}</span>
                      </div>
                    </li>
                  )
                })}
              </ul>
              <p className="mt-3 text-xs text-slate-400">
                Green is movement in your favour: assets up, debt down. Tap a figure to correct it; to
                clear a month’s figure altogether, use Record values.
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
      {managing && (
        <ManageAccountsDialog
          onClose={() => setManaging(false)}
          onChanged={setStatus}
          runImport={runImport}
          importing={importing}
        />
      )}
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
  if (kinds.length === 0) return <p className="py-6 text-center text-sm text-slate-400">Nothing on record.</p>
  return (
    <div className="space-y-1.5">
      {kinds.map((k) => {
        const change = k.value - k.since
        // Up is good for everything now that debts are negative.
        const good = change >= 0
        return (
          <BarRow
            key={k.kind}
            labelWidth="sm:w-28"
            label={KIND_LABELS[k.kind]}
            // Magnitude: a debt of -487.907 draws a bar 487.907 long.
            fraction={Math.abs(k.value) / max}
            amount={kr(k.value)}
            color={color}
            metaWidth="w-28"
            meta={
              change === 0 ? (
                <span className="text-slate-400">no change</span>
              ) : (
                <span className={good ? 'text-emerald-400' : 'text-red-400'} title={scope === 'lifetime' ? 'Since records began' : `Change in ${year}`}>
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
function ManageAccountsDialog({
  onClose,
  onChanged,
  runImport,
  importing,
}: {
  onClose: () => void
  onChanged: (m: string) => void
  // Owned by the page, because the empty state offers it too.
  runImport: (file: File) => void
  importing: boolean
}) {
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


  return (
    <Modal title="What are we tracking?" onClose={onClose}>
        <p className="border-b border-[#232b3b] px-5 pt-1 pb-3 text-sm text-slate-400">
            Anything with a value worth following — savings, investments, pension, property, and what
            you owe on them. The kind is what makes "are the loans going down" answerable.
          </p>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {isLoading ? (
            <Spinner large />
          ) : (
            <div className="space-y-1">
              {accounts.map((a) => (
                <div
                  key={a.id}
                  className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2 ${a.isArchived ? 'opacity-70' : ''}`}
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ background: a.isLiability ? EXPENSE : INCOME }}
                  />
                  <span className="min-w-0 flex-1 text-sm break-words text-slate-200">{a.name}</span>
                  <span className="shrink-0 text-xs text-slate-400">{KIND_LABELS[a.kind]}</span>
                  <span className="basis-full sm:hidden" aria-hidden />
                  <button
                    onClick={() => setArchived({ id: a.id, name: a.name, kind: a.kind, isArchived: !a.isArchived })}
                    className={`${BUTTON_SMALL} ml-auto shrink-0 sm:ml-0`}
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
                    className={`${BUTTON_SMALL} shrink-0 !border-red-900 !text-red-300 enabled:hover:!bg-red-950`}
                  >
                    Delete
                  </button>
                </div>
              ))}
              {accounts.length === 0 && (
                <p className="py-6 text-center text-sm text-slate-400">Nothing tracked yet.</p>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-[#232b3b] px-5 py-3">
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
              aria-label="Account name"
              maxLength={120}
              className={`${INPUT} min-w-40 flex-1`}
            />
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as NetWorthKind)}
              aria-label="Kind"
              className={INPUT}
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
              className={BUTTON_PRIMARY}
            >
              Add
            </button>
            <button
              type="button"
              onClick={onClose}
              className={BUTTON_SECONDARY}
            >
              Done
            </button>
          </form>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <ImportButton
              importing={importing}
              onPick={(f) => runImport(f)}
              label="Import history…"
              className={BUTTON_SMALL}
            />
            <span>a JSON export of an existing spreadsheet. Safe to run twice.</span>
          </div>
        </div>
      </Modal>
  )
}

// The file input is sr-only rather than display:none. A `hidden` input inside a label is
// unreliable on mobile browsers — some refuse to open the picker for an element that isn't
// rendered — and this is exactly the case where the file lives on a phone.
function ImportButton({
  onPick,
  importing,
  className,
  label,
}: {
  onPick: (file: File) => void
  importing: boolean
  className: string
  label: string
}) {
  return (
    <label className={`${className} ${importing ? 'opacity-60' : 'cursor-pointer'}`}>
      <input
        type="file"
        accept="application/json,.json"
        disabled={importing}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onPick(file)
          // Cleared so picking the same file twice still fires a change event.
          e.target.value = ''
        }}
        className="sr-only"
      />
      {importing ? 'Importing…' : label}
    </label>
  )
}

// A figure that turns into a box when clicked. Enter or leaving the box saves, Escape abandons.
//
// An empty, unreadable or unchanged entry leaves the figure alone rather than clearing it: wiping
// a month's value is a deliberate act with its own place (the monthly form), and a stray blur on a
// half-cleared box must not be able to do it.
function EditableValue({
  value,
  label,
  className,
  onSave,
}: {
  value: number
  label: string
  className: string
  onSave: (value: number) => Promise<unknown>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  // Escape unmounts the box, and some browsers still fire a blur as it goes — which would then
  // save what was just abandoned.
  const abandoned = useRef(false)

  const commit = async () => {
    if (saving) return
    if (abandoned.current) {
      abandoned.current = false
      return
    }
    const raw = draft.trim().replace(/\s/g, '').replace(',', '.')
    const parsed = raw === '' ? NaN : Number(raw)
    if (Number.isNaN(parsed) || parsed === value) {
      setEditing(false)
      return
    }
    setSaving(true)
    try {
      await onSave(parsed)
      setEditing(false)
    } catch {
      // The page reports the failure; the box stays open with what was typed so it can be retried.
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          abandoned.current = false
          setDraft(String(value))
          setEditing(true)
        }}
        className={`-mx-1 rounded px-1 font-semibold tabular-nums underline decoration-slate-500 decoration-dotted underline-offset-4 hover:bg-white/[0.06] ${className}`}
        title={`Correct ${label}`}
      >
        {kr(value)}
      </button>
    )
  }

  return (
    <input
      autoFocus
      inputMode="decimal"
      value={draft}
      disabled={saving}
      // Opens with the figure selected, so typing replaces it. Without this, correcting 18000
      // means deleting it first, and typing a new number straight away appends to the old one.
      onFocus={(e) => e.target.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') {
          abandoned.current = true
          setEditing(false)
        }
      }}
      aria-label={label}
      className="w-32 rounded border border-indigo-500 bg-[#111620] px-2 py-1 text-right text-sm tabular-nums text-slate-200 outline-none disabled:opacity-60"
    />
  )
}

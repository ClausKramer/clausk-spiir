import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getTags, attachTag, detachTag } from '../api/tags'

interface Props {
  transactionId: string
  tags: { tagId: string; name: string }[]
  dark?: boolean
}

// Tags on a transaction row: existing ones as removable chips, plus a small add affordance that
// suggests tags already in use. Suggestions matter more than they look — free text with no
// prompting is how you end up with "Padel", "padel " and "Padeltennis" splitting one total.
export function TagEditor({ transactionId, tags, dark = false }: Props) {
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [value, setValue] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  const { data: allTags = [] } = useQuery({ queryKey: ['tags'], queryFn: getTags, staleTime: 60_000 })

  function refresh() {
    qc.invalidateQueries({ queryKey: ['transactions'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
    qc.invalidateQueries({ queryKey: ['by-category'] })
    qc.invalidateQueries({ queryKey: ['tags'] })
  }

  const { mutate: add, isPending: adding_ } = useMutation({
    mutationFn: (name: string) => attachTag(transactionId, name),
    onSuccess: () => {
      refresh()
      setValue('')
      setAdding(false)
    },
  })

  const { mutate: remove } = useMutation({
    mutationFn: (tagId: string) => detachTag(transactionId, tagId),
    onSuccess: refresh,
  })

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setAdding(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const alreadyOn = new Set(tags.map((t) => t.name.toLowerCase()))
  const suggestions = allTags
    .filter((t) => !alreadyOn.has(t.name.toLowerCase()))
    .filter((t) => t.name.toLowerCase().includes(value.trim().toLowerCase()))
    .slice(0, 6)

  const chip = dark
    ? 'bg-violet-500/15 text-violet-300 hover:bg-violet-500/25'
    : 'bg-violet-100 text-violet-700 hover:bg-violet-200'

  return (
    <div ref={ref} className="relative inline-flex flex-wrap items-center gap-1">
      {tags.map((t) => (
        <button
          key={t.tagId}
          onClick={() => remove(t.tagId)}
          className={`rounded-full px-1.5 py-0.5 text-[0.62rem] font-medium transition-colors ${chip}`}
          title={`Remove “${t.name}” from this transaction`}
        >
          {t.name} ✕
        </button>
      ))}

      <button
        onClick={() => setAdding((a) => !a)}
        className={`rounded-full px-1.5 py-0.5 text-[0.62rem] transition-opacity ${
          dark ? 'text-slate-600 hover:text-violet-300' : 'text-slate-300 hover:text-violet-600'
        } ${tags.length === 0 ? 'opacity-0 group-hover/row:opacity-100' : ''}`}
        title="Add a tag"
      >
        + tag
      </button>

      {adding && (
        <div
          className={`absolute left-0 top-full z-30 mt-1 w-52 rounded-lg border py-1 shadow-lg ${
            dark ? 'border-slate-700 bg-[#1a1f2e]' : 'border-slate-200 bg-white'
          }`}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (value.trim()) add(value.trim())
            }}
            className="px-2 pb-1"
          >
            <input
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Tag name…"
              maxLength={60}
              disabled={adding_}
              className={`w-full rounded border px-2 py-1 text-xs outline-none ${
                dark
                  ? 'border-slate-700 bg-[#111620] text-slate-200 focus:border-violet-500'
                  : 'border-slate-200 text-slate-800 focus:border-violet-500'
              }`}
            />
          </form>
          {suggestions.map((s) => (
            <button
              key={s.id}
              onClick={() => add(s.name)}
              className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs ${
                dark ? 'text-slate-300 hover:bg-white/5' : 'text-slate-700 hover:bg-slate-50'
              }`}
            >
              <span>{s.name}</span>
              <span className={dark ? 'text-slate-600' : 'text-slate-400'}>{s.transactionCount}</span>
            </button>
          ))}
          {value.trim() && !allTags.some((t) => t.name.toLowerCase() === value.trim().toLowerCase()) && (
            <button
              onClick={() => add(value.trim())}
              className={`w-full px-3 py-1.5 text-left text-xs ${
                dark ? 'text-violet-300 hover:bg-white/5' : 'text-violet-700 hover:bg-slate-50'
              }`}
            >
              Create “{value.trim()}”
            </button>
          )}
        </div>
      )}
    </div>
  )
}

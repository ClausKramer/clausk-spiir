import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getTags, attachTag, detachTag } from '../api/tags'
import { REVEAL_ON_ROW_HOVER } from './ui'

interface Props {
  transactionId: string
  tags: { tagId: string; name: string }[]
}

// Tags on a transaction row: existing ones as removable chips, plus a small add affordance that
// suggests tags already in use. Suggestions matter more than they look — free text with no
// prompting is how you end up with "Padel", "padel " and "Padeltennis" splitting one total.
export function TagEditor({ transactionId, tags }: Props) {
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

  const chip = 'bg-violet-500/15 text-violet-200 hover:bg-violet-500/25'

  return (
    <div ref={ref} className="relative inline-flex flex-wrap items-center gap-1">
      {tags.map((t) => (
        <button
          key={t.tagId}
          onClick={() => remove(t.tagId)}
          className={`rounded-full px-2 py-0.5 text-xs font-medium transition-colors pointer-coarse:min-h-8 ${chip}`}
          title={`Remove “${t.name}” from this transaction`}
        >
          {t.name} <span aria-hidden>✕</span>
        </button>
      ))}

      <button
        onClick={() => setAdding((a) => !a)}
        className={`rounded-full px-2 py-0.5 text-xs text-slate-400 transition-opacity hover:text-violet-300 pointer-coarse:min-h-9 ${tags.length === 0 && !adding ? REVEAL_ON_ROW_HOVER : ''}`}
        title="Add a tag"
      >
        + tag
      </button>

      {adding && (
        <div
          className="absolute top-full left-0 z-30 mt-1 w-56 rounded-lg border border-slate-700 bg-[#1a1f2e] py-1 shadow-lg"
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
              onKeyDown={(e) => e.key === 'Escape' && setAdding(false)}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Tag name…"
              aria-label="Tag name"
              maxLength={60}
              disabled={adding_}
              className="min-h-8 w-full rounded border border-slate-700 bg-[#111620] px-2 py-1 text-sm text-slate-200 outline-none focus:border-violet-500"
            />
          </form>
          {suggestions.map((s) => (
            <button
              key={s.id}
              onClick={() => add(s.name)}
              className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs text-slate-300 hover:bg-white/5"
            >
              <span>{s.name}</span>
              <span className="text-slate-400">{s.transactionCount}</span>
            </button>
          ))}
          {value.trim() && !allTags.some((t) => t.name.toLowerCase() === value.trim().toLowerCase()) && (
            <button
              onClick={() => add(value.trim())}
              className="w-full px-3 py-1.5 text-left text-xs text-violet-300 hover:bg-white/5"
            >
              Create “{value.trim()}”
            </button>
          )}
        </div>
      )}
    </div>
  )
}

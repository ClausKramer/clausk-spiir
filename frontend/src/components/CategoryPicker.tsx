import { useRef, useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getCategories } from '../api/categories'
import { setTransactionCategory } from '../api/transactions'

interface Props {
  transactionId: string
  categoryId: string | null
  categoryName: string | null
  categoryEmoji: string | null
  dark?: boolean
}

export function CategoryPicker({ transactionId, categoryId, categoryName, categoryEmoji, dark = false }: Props) {
  const [open, setOpen] = useState(false)
  const [alsoUpdated, setAlsoUpdated] = useState<number | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const qc = useQueryClient()

  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: getCategories,
    staleTime: 5 * 60 * 1000,
  })

  const { mutate: pick, isPending } = useMutation({
    mutationFn: (newCategoryId: string | null) => setTransactionCategory(transactionId, newCategoryId),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['transactions'] })
      // The correction also teaches a rule, which can recategorize past transactions from the
      // same merchant — that shifts the spending breakdown, so refresh it too.
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      if (result.alsoUpdated > 0) setAlsoUpdated(result.alsoUpdated)
      setOpen(false)
    },
  })

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Auto-dismiss the "also updated N" note — it's a confirmation, not something to act on.
  useEffect(() => {
    if (alsoUpdated === null) return
    const timer = setTimeout(() => setAlsoUpdated(null), 4000)
    return () => clearTimeout(timer)
  }, [alsoUpdated])

  const label = categoryId
    ? `${categoryEmoji ?? ''} ${categoryName ?? ''}`.trim()
    : '—'

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={isPending}
        className={`rounded px-2 py-0.5 text-left disabled:opacity-50 transition-colors ${
          dark
            ? 'text-slate-300 hover:bg-white/10 hover:text-white'
            : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
        }`}
      >
        {isPending ? '…' : label}
      </button>

      {alsoUpdated !== null && (
        <span
          className={`ml-1.5 whitespace-nowrap text-[0.68rem] ${dark ? 'text-emerald-400' : 'text-emerald-600'}`}
          title="A rule was learned from this correction and applied to matching transactions"
        >
          +{alsoUpdated} matched
        </span>
      )}

      {open && (
        <div
          className={`absolute left-0 top-full z-20 mt-1 w-52 rounded-lg border shadow-lg py-1 max-h-72 overflow-y-auto ${
            dark ? 'border-slate-700 bg-[#1a1f2e]' : 'border-slate-200 bg-white'
          }`}
        >
          <button
            onClick={() => pick(null)}
            className={`w-full px-4 py-2 text-left text-sm ${
              dark ? 'text-slate-500 hover:bg-white/5' : 'text-slate-400 hover:bg-slate-50'
            }`}
          >
            — No category
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => pick(c.id)}
              className={`w-full px-4 py-2 text-left text-sm flex items-center gap-2 ${
                dark ? 'hover:bg-white/5' : 'hover:bg-slate-50'
              } ${
                c.id === categoryId
                  ? 'font-semibold ' + (dark ? 'text-indigo-400' : 'text-indigo-600')
                  : (dark ? 'text-slate-300' : 'text-slate-700')
              }`}
            >
              <span className="w-5 text-center">{c.emoji}</span>
              {c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

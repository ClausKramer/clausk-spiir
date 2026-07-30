import { useRef, useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getCategories } from '../api/categories'
import { setTransactionCategory } from '../api/transactions'

interface Props {
  transactionId: string
  categoryId: string | null
  categoryName: string | null
  categoryEmoji: string | null
}

export function CategoryPicker({ transactionId, categoryId, categoryName, categoryEmoji }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const qc = useQueryClient()

  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: getCategories,
    staleTime: 5 * 60 * 1000,
  })

  const { mutate: pick, isPending } = useMutation({
    mutationFn: (newCategoryId: string | null) => setTransactionCategory(transactionId, newCategoryId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] })
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

  const label = categoryId
    ? `${categoryEmoji ?? ''} ${categoryName ?? ''}`.trim()
    : '—'

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={isPending}
        className="rounded px-2 py-0.5 text-left text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50 transition-colors"
      >
        {isPending ? '…' : label}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-52 rounded-lg border border-slate-200 bg-white shadow-lg py-1 max-h-72 overflow-y-auto">
          <button
            onClick={() => pick(null)}
            className="w-full px-4 py-2 text-left text-sm text-slate-400 hover:bg-slate-50"
          >
            — No category
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => pick(c.id)}
              className={`w-full px-4 py-2 text-left text-sm hover:bg-slate-50 flex items-center gap-2 ${
                c.id === categoryId ? 'font-semibold text-indigo-600' : 'text-slate-700'
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

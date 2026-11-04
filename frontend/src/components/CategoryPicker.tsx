import { useRef, useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getCategories, type Category } from '../api/categories'
import { setTransactionCategory } from '../api/transactions'
import { ApplyToSimilarDialog } from './ApplyToSimilarDialog'

function CategoryOption({
  category,
  selected,
  indent = false,
  onPick,
}: {
  category: Category
  selected: boolean
  indent?: boolean
  onPick: (id: string) => void
}) {
  return (
    <button
      onClick={() => onPick(category.id)}
      className={`flex w-full items-center gap-2 py-2 text-left text-sm hover:bg-white/5 ${indent ? 'pr-4 pl-7' : 'px-4'} ${
        selected ? 'font-semibold text-indigo-300' : 'text-slate-300'
      }`}
    >
      <span className="w-5 text-center">{category.emoji}</span>
      {category.name}
    </button>
  )
}

interface Props {
  transactionId: string
  categoryId: string | null
  categoryName: string | null
  categoryEmoji: string | null
}

export function CategoryPicker({ transactionId, categoryId, categoryName, categoryEmoji }: Props) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [pendingSimilar, setPendingSimilar] = useState<{ categoryId: string; label: string } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const qc = useQueryClient()

  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: getCategories,
    staleTime: 5 * 60 * 1000,
  })

  const { mutate: pick, isPending } = useMutation({
    mutationFn: (newCategoryId: string | null) => setTransactionCategory(transactionId, newCategoryId),
    onSuccess: (_result, newCategoryId) => {
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['by-category'] })
      setOpen(false)
      setFilter('')

      // Offer to extend the change to similar transactions. Only when assigning a category —
      // clearing one means "this was wrong", not "everything from this merchant belongs nowhere".
      if (newCategoryId) {
        const picked = categories.find((c) => c.id === newCategoryId)
        setPendingSimilar({
          categoryId: newCategoryId,
          label: picked ? `${picked.emoji ?? ''} ${picked.name}`.trim() : 'this category',
        })
      }
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
    : 'Add category'

  // Transactions file to leaves, so groups are headers rather than choices. A group with no
  // leaves is itself selectable — that's a top-level category the tree doesn't break down.
  const groups = categories.filter((c) => c.parentCategoryId === null)
  const q = filter.trim().toLowerCase()
  const sections = groups
    .map((g) => {
      const leaves = categories.filter((c) => c.parentCategoryId === g.id)
      const groupMatches = g.name.toLowerCase().includes(q)
      return {
        group: g,
        // A group whose own name matches keeps all its leaves — typing "Bolig" should show
        // everything filed under it, not just the leaf that repeats the word.
        leaves: q && !groupMatches ? leaves.filter((c) => c.name.toLowerCase().includes(q)) : leaves,
        selectableGroup: leaves.length === 0 && (!q || groupMatches),
      }
    })
    .filter((s) => s.leaves.length > 0 || s.selectableGroup)

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={isPending}
        className={`min-h-7 rounded px-2 py-0.5 text-left text-sm pointer-coarse:min-h-9 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50 ${
          categoryId ? 'text-slate-300' : 'text-slate-400 italic'
        }`}
        aria-haspopup="true"
        aria-expanded={open}
      >
        {isPending ? '…' : label}
      </button>

      {pendingSimilar && (
        <ApplyToSimilarDialog
          transactionId={transactionId}
          categoryId={pendingSimilar.categoryId}
          categoryLabel={pendingSimilar.label}
          onClose={() => setPendingSimilar(null)}
        />
      )}

      {open && (
        <div
          className="absolute top-full left-0 z-30 mt-1 w-64 max-w-[calc(100vw-3rem)] rounded-lg border border-slate-700 bg-[#1a1f2e] shadow-lg"
        >
          <div className="border-b border-slate-700 p-2">
            <input
              autoFocus
              value={filter}
              aria-label="Search categories"
              onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search categories…"
              className="min-h-8 w-full rounded border border-slate-700 bg-[#111620] px-2 py-1 text-sm text-slate-200 outline-none focus:border-indigo-500"
            />
          </div>

          <div className="max-h-72 overflow-y-auto py-1">
            <button
              onClick={() => pick(null)}
              className="w-full px-4 py-1.5 text-left text-sm text-slate-400 hover:bg-white/5"
            >
              — No category
            </button>

            {sections.map(({ group, leaves, selectableGroup }) => (
              <div key={group.id}>
                {selectableGroup ? (
                  <CategoryOption
                    category={group}
                    selected={group.id === categoryId}
                    onPick={pick}
                  />
                ) : (
                  <div
                    className="px-3 pb-0.5 pt-2 text-xs font-semibold text-slate-400"
                  >
                    {group.emoji} {group.name}
                  </div>
                )}
                {leaves.map((c) => (
                  <CategoryOption
                    key={c.id}
                    category={c}
                    selected={c.id === categoryId}
                    indent
                    onPick={pick}
                  />
                ))}
              </div>
            ))}

            {sections.length === 0 && (
              <p className="px-4 py-3 text-xs text-slate-400">
                No category matches “{filter.trim()}”.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

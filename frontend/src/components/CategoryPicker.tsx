import { useRef, useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getCategories, type Category } from '../api/categories'
import { setTransactionCategory } from '../api/transactions'
import { ApplyToSimilarDialog } from './ApplyToSimilarDialog'

function CategoryOption({
  category,
  selected,
  dark,
  indent = false,
  onPick,
}: {
  category: Category
  selected: boolean
  dark: boolean
  indent?: boolean
  onPick: (id: string) => void
}) {
  return (
    <button
      onClick={() => onPick(category.id)}
      className={`flex w-full items-center gap-2 py-1.5 text-left text-sm ${indent ? 'pl-7 pr-4' : 'px-4'} ${
        dark ? 'hover:bg-white/5' : 'hover:bg-slate-50'
      } ${
        selected
          ? 'font-semibold ' + (dark ? 'text-indigo-400' : 'text-indigo-600')
          : dark
            ? 'text-slate-300'
            : 'text-slate-700'
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
  dark?: boolean
}

export function CategoryPicker({ transactionId, categoryId, categoryName, categoryEmoji, dark = false }: Props) {
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
    : '—'

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
        className={`rounded px-2 py-0.5 text-left disabled:opacity-50 transition-colors ${
          dark
            ? 'text-slate-300 hover:bg-white/10 hover:text-white'
            : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
        }`}
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
          className={`absolute left-0 top-full z-20 mt-1 w-64 rounded-lg border shadow-lg ${
            dark ? 'border-slate-700 bg-[#1a1f2e]' : 'border-slate-200 bg-white'
          }`}
        >
          <div className={`p-2 ${dark ? 'border-b border-slate-700' : 'border-b border-slate-100'}`}>
            <input
              autoFocus
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search categories…"
              className={`w-full rounded border px-2 py-1 text-xs outline-none ${
                dark
                  ? 'border-slate-700 bg-[#111620] text-slate-200 focus:border-indigo-500'
                  : 'border-slate-200 text-slate-800 focus:border-indigo-500'
              }`}
            />
          </div>

          <div className="max-h-72 overflow-y-auto py-1">
            <button
              onClick={() => pick(null)}
              className={`w-full px-4 py-1.5 text-left text-sm ${
                dark ? 'text-slate-500 hover:bg-white/5' : 'text-slate-400 hover:bg-slate-50'
              }`}
            >
              — No category
            </button>

            {sections.map(({ group, leaves, selectableGroup }) => (
              <div key={group.id}>
                {selectableGroup ? (
                  <CategoryOption
                    category={group}
                    selected={group.id === categoryId}
                    dark={dark}
                    onPick={pick}
                  />
                ) : (
                  <div
                    className={`px-3 pb-0.5 pt-2 text-[0.65rem] font-semibold uppercase tracking-wide ${
                      dark ? 'text-slate-500' : 'text-slate-400'
                    }`}
                  >
                    {group.emoji} {group.name}
                  </div>
                )}
                {leaves.map((c) => (
                  <CategoryOption
                    key={c.id}
                    category={c}
                    selected={c.id === categoryId}
                    dark={dark}
                    indent
                    onPick={pick}
                  />
                ))}
              </div>
            ))}

            {sections.length === 0 && (
              <p className={`px-4 py-3 text-xs ${dark ? 'text-slate-500' : 'text-slate-400'}`}>
                No category matches “{filter.trim()}”.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

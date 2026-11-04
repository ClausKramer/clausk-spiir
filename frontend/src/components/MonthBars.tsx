import { useState } from 'react'
import { MONTH_NAMES } from '../lib/period'

interface Bar {
  year: number
  month: number
  value: number
}

// A small month-by-month column chart. Heights are magnitude, so a month that nets negative still
// draws in proportion to how much moved, in whichever colour `colorOf` gives it.
//
// The value of a bar shows in the line underneath on hover, focus or tap. It used to appear only
// on hover, which a phone doesn't have, so on the device this is mostly read on the bars had no
// numbers at all.
export function MonthBars({
  data,
  colorOf,
  format,
  height = 'h-32',
}: {
  data: Bar[]
  colorOf: (bar: Bar) => string
  format: (value: number) => string
  height?: string
}) {
  const [picked, setPicked] = useState<Bar | null>(null)
  const max = Math.max(...data.map((b) => Math.abs(b.value)), 1)

  return (
    <div>
      {/* The plot row carries a definite height so the bars' percentage heights resolve. */}
      <div className={`flex items-stretch gap-1 sm:gap-1.5 ${height}`} onMouseLeave={() => setPicked(null)}>
        {data.map((b) => (
          <button
            key={`${b.year}-${b.month}`}
            type="button"
            onMouseEnter={() => setPicked(b)}
            onFocus={() => setPicked(b)}
            onClick={() => setPicked(b)}
            aria-label={`${MONTH_NAMES[b.month - 1]} ${b.year}: ${format(b.value)}`}
            className="flex h-full min-w-0 flex-1 flex-col justify-end rounded-t hover:bg-white/[0.04]"
          >
            <span
              className="block w-full rounded-t"
              style={{
                height: `${(Math.abs(b.value) / max) * 100}%`,
                minHeight: b.value !== 0 ? 2 : 0,
                background: colorOf(b),
                opacity: picked && picked !== b ? 0.55 : 1,
              }}
            />
          </button>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1 sm:gap-1.5" aria-hidden>
        {data.map((b) => (
          <div key={`l-${b.year}-${b.month}`} className="min-w-0 flex-1 text-center text-xs text-slate-400">
            <span className="sm:hidden">{MONTH_NAMES[b.month - 1].slice(0, 1)}</span>
            <span className="hidden sm:inline">{MONTH_NAMES[b.month - 1]}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-center text-xs text-slate-400 tabular-nums" aria-live="polite">
        {picked ? (
          <>
            {MONTH_NAMES[picked.month - 1]} {picked.year}:{' '}
            <span className="font-semibold text-slate-200">{format(picked.value)}</span>
          </>
        ) : (
          'Select a month to see its amount'
        )}
      </p>
    </div>
  )
}

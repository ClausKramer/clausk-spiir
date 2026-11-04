import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { TRACK } from '../lib/chartColors'

interface Props {
  /** Left gutter: what the bar is. */
  label: ReactNode
  /** The bar's share of the largest bar in its chart, 0–1. Drawn exactly, never floored. */
  fraction: number
  /** The value, already formatted. Sits inside the bar, or just after it when it won't fit. */
  amount: string
  color: string
  /** Right gutter: counts, averages, and similar supporting detail. */
  meta?: ReactNode
  to?: string
  title?: string
  /** Tailwind width class for the left gutter on wide screens (`sm:w-…`), so a chart's labels line up. */
  labelWidth?: string
  metaWidth?: string
}

// A horizontal bar in a ranked list.
//
// The one rule this component exists to enforce: **length is the value**. Bars previously
// carried an 8–10% minimum width so the amount would fit inside them, which drew a category
// worth 0.5% of the largest at 8% — seventeen times too long, and the reader has no way to
// know. The bar is now drawn at its true fraction and the label moves outside when the bar is
// too narrow to hold it. Padding counts too: it goes on the bar only when the amount is inside
// it, since 20px of padding is itself a minimum width.
//
// On a phone there is no room for gutters beside a bar: they squeezed the track until the amount
// was clipped, so 3.120 kr. read as "120 kr". Label and amount go on a line of their own above a
// full-width track instead. The meta column keeps a fixed width there, because bars are only
// comparable if every track in the chart is the same length.
export function BarRow({
  label,
  fraction,
  amount,
  color,
  meta,
  to,
  title,
  labelWidth = 'sm:w-40',
  metaWidth,
}: Props) {
  const pct = Math.max(0, Math.min(1, fraction)) * 100
  // Below roughly a third of the track the amount no longer fits inside the bar, so it sits
  // just past the end instead — in muted ink, since it is text rather than a mark.
  const inside = pct >= 32

  const body = (
    <>
      <div className={`${labelWidth} min-w-0 truncate text-sm text-slate-300 sm:shrink-0 sm:text-right sm:text-xs`}>{label}</div>
      <div className="text-sm font-semibold whitespace-nowrap text-slate-200 tabular-nums sm:hidden">{amount}</div>
      <div className="col-span-2 flex min-w-0 items-center gap-2.5 sm:flex-1">
        <div className="flex h-2.5 min-w-0 flex-1 items-center overflow-hidden rounded sm:h-[22px]" style={{ background: TRACK }}>
          <div
            className={`flex h-full items-center justify-end rounded ${inside ? 'sm:px-2.5' : ''}`}
            style={{
              width: `${pct}%`,
              // A hairline so a small-but-real value is still visible. Unlike the old percentage
              // floor this is a fixed 2px — under half a percent of the track — so it can't
              // meaningfully misstate a proportion.
              minWidth: pct > 0 ? 2 : 0,
              background: color,
            }}
          >
            {inside && (
              <span className="hidden text-xs font-semibold whitespace-nowrap text-white/95 sm:inline">{amount}</span>
            )}
          </div>
          {!inside && (
            <span className="hidden pl-2 text-xs font-semibold whitespace-nowrap text-slate-300 tabular-nums sm:inline">
              {amount}
            </span>
          )}
        </div>
        {meta !== undefined && (
          <div className={`${metaWidth ?? 'w-24'} shrink-0 text-right text-xs text-slate-400 tabular-nums`}>
            {meta}
          </div>
        )}
      </div>
    </>
  )

  const cls = 'grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-2.5 gap-y-1 rounded sm:flex sm:items-center'
  return to ? (
    <Link to={to} className={`${cls} -mx-1 px-1 py-0.5 hover:bg-white/[0.04]`} title={title}>
      {body}
    </Link>
  ) : (
    <div className={cls} title={title}>
      {body}
    </div>
  )
}

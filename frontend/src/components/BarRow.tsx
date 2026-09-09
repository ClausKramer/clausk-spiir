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
  /** Tailwind width class for the left gutter, so a chart's labels line up with each other. */
  labelWidth?: string
  metaWidth?: string
}

// A horizontal bar in a ranked list.
//
// The one rule this component exists to enforce: **length is the value**. Bars previously
// carried an 8–10% minimum width so the amount would fit inside them, which drew a category
// worth 0.5% of the largest at 8% — seventeen times too long, and the reader has no way to
// know. The bar is now drawn at its true fraction and the label moves outside when the bar is
// too narrow to hold it.
export function BarRow({
  label,
  fraction,
  amount,
  color,
  meta,
  to,
  title,
  labelWidth = 'w-40',
  metaWidth,
}: Props) {
  const pct = Math.max(0, Math.min(1, fraction)) * 100
  // Below roughly a third of the track the amount no longer fits inside the bar, so it sits
  // just past the end instead — in muted ink, since it is text rather than a mark.
  const inside = pct >= 32

  const body = (
    <>
      <div className={`${labelWidth} shrink-0 truncate text-right text-xs text-slate-400`}>{label}</div>
      <div className="flex h-[22px] flex-1 items-center overflow-hidden rounded" style={{ background: TRACK }}>
        <div
          className="flex h-full items-center justify-end rounded px-2.5"
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
            <span className="whitespace-nowrap text-[0.7rem] font-semibold text-white/95">{amount}</span>
          )}
        </div>
        {!inside && (
          <span className="whitespace-nowrap pl-2 text-[0.7rem] font-semibold tabular-nums text-slate-300">
            {amount}
          </span>
        )}
      </div>
      {meta !== undefined && (
        <div className={`${metaWidth ?? 'w-24'} shrink-0 text-right text-[0.7rem] tabular-nums text-slate-500`}>
          {meta}
        </div>
      )}
    </>
  )

  const cls = 'flex items-center gap-2.5 rounded'
  return to ? (
    <Link to={to} className={`${cls} -mx-1 px-1 hover:bg-white/[0.04]`} title={title}>
      {body}
    </Link>
  ) : (
    <div className={cls} title={title}>
      {body}
    </div>
  )
}

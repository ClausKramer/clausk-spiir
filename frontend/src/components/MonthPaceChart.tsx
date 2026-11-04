import { useState } from 'react'
import { EXPENSE, NEUTRAL, SURFACE } from '../lib/chartColors'
import { useChartWidth } from '../lib/useChartWidth'

const H = 230
const PAD = { top: 14, right: 16, bottom: 28, left: 62 }
const PLOT_H = H - PAD.top - PAD.bottom

const kr = (n: number) => Math.round(n).toLocaleString('da-DK')

function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0]
  const raw = max / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag
  const ticks: number[] = []
  for (let v = 0; v <= max + 1e-9; v += step) ticks.push(v)
  return ticks
}

interface Props {
  /** Running total for each day that has happened. */
  cumulative: number[]
  /** Running total of a typical month, one entry per day of the month. Null with no history. */
  typical: number[] | null
  daysInMonth: number
  /** The estimated month end, drawn as a marker on the last day. Null when there isn't one. */
  expectedEnd: number | null
}

// How this month's spending is building up against how a typical month's does.
//
// Both lines are the same quantity in the same unit — kroner spent so far — so they share one
// axis and the gap between them is the answer: ahead of the usual pace or behind it. A lumpy bill
// on the 1st shows up as a step in both, which is why the comparison is fair even early on,
// unlike a daily average that spreads that one step across the month.
export function MonthPaceChart({ cumulative, typical, daysInMonth, expectedEnd }: Props) {
  const [chartRef, W] = useChartWidth()
  const PLOT_W = W - PAD.left - PAD.right
  const [hover, setHover] = useState<number | null>(null)

  const elapsed = cumulative.length
  const maxV = Math.max(...cumulative, ...(typical ?? []), expectedEnd ?? 0, 0)
  const ticks = niceTicks(maxV)
  const domainMax = Math.max(maxV, ticks[ticks.length - 1] ?? 0) || 1

  const y = (v: number) => PAD.top + PLOT_H - (v / domainMax) * PLOT_H
  const band = PLOT_W / daysInMonth
  const x = (day: number) => PAD.left + (day - 1) * band + band / 2

  const thisPoints = cumulative.map((v, i) => `${x(i + 1)},${y(v)}`).join(' ')
  const typicalPoints = typical?.map((v, i) => `${x(i + 1)},${y(v)}`).join(' ')
  const labelDays = Array.from({ length: daysInMonth }, (_, i) => i + 1).filter(
    (d) => d === 1 || d % 5 === 0 || d === daysInMonth,
  )

  const thisAt = hover !== null ? cumulative[hover - 1] : undefined
  const typicalAt = hover !== null ? typical?.[hover - 1] : undefined

  return (
    <div ref={chartRef} className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Spending so far this month against a typical month">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="#2a3346" strokeWidth={1} />
            <text x={PAD.left - 10} y={y(t) + 4} textAnchor="end" className="fill-slate-400" fontSize={12}>
              {kr(t)}
            </text>
          </g>
        ))}

        {typicalPoints && (
          <polyline
            points={typicalPoints}
            fill="none"
            stroke={NEUTRAL}
            strokeWidth={2}
            strokeDasharray="5 4"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}

        {/* From today to the estimated end: dotted, because it is an estimate, not a record. */}
        {expectedEnd !== null && elapsed > 0 && elapsed < daysInMonth && (
          <>
            <line
              x1={x(elapsed)}
              y1={y(cumulative[elapsed - 1])}
              x2={x(daysInMonth)}
              y2={y(expectedEnd)}
              stroke={EXPENSE}
              strokeWidth={2}
              strokeDasharray="1 5"
              strokeLinecap="round"
              opacity={0.8}
            />
            <circle cx={x(daysInMonth)} cy={y(expectedEnd)} r={4.5} fill={SURFACE} stroke={EXPENSE} strokeWidth={2} />
          </>
        )}

        {elapsed > 0 && (
          <>
            <polyline points={thisPoints} fill="none" stroke={EXPENSE} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
            <circle cx={x(elapsed)} cy={y(cumulative[elapsed - 1])} r={4} fill={EXPENSE} stroke={SURFACE} strokeWidth={2} />
          </>
        )}

        {labelDays.map((d) => (
          <text key={`l-${d}`} x={x(d)} y={H - 8} textAnchor="middle" className="fill-slate-400" fontSize={12}>
            {d}
          </text>
        ))}

        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => (
          <rect
            key={`h-${d}`}
            x={PAD.left + (d - 1) * band}
            y={PAD.top}
            width={band}
            height={PLOT_H}
            fill="transparent"
            onMouseEnter={() => setHover(d)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
        {hover !== null && (
          <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + PLOT_H} stroke="#64748b" strokeWidth={1} />
        )}
      </svg>

      {hover !== null && (
        <div
          className="pointer-events-none absolute top-2 rounded-lg border border-slate-700 bg-[#111620] px-3 py-2 text-xs shadow-lg"
          style={{
            left: `${(x(hover) / W) * 100}%`,
            transform: hover > daysInMonth / 2 ? 'translateX(-108%)' : 'translateX(8%)',
          }}
        >
          <div className="mb-1 font-semibold text-slate-200">Day {hover}</div>
          {thisAt !== undefined && (
            <div className="flex items-center gap-2 whitespace-nowrap py-0.5">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: EXPENSE }} />
              <span className="text-slate-400">This month</span>
              <span className="ml-auto tabular-nums text-slate-200">{kr(thisAt)} kr.</span>
            </div>
          )}
          {typicalAt !== undefined && (
            <div className="flex items-center gap-2 whitespace-nowrap py-0.5">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: NEUTRAL }} />
              <span className="text-slate-400">Typical</span>
              <span className="ml-auto tabular-nums text-slate-200">{kr(typicalAt)} kr.</span>
            </div>
          )}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center justify-center gap-4 text-xs text-slate-400">
        <span className="flex items-center gap-1.5">
          <svg width="16" height="4" aria-hidden>
            <line x1="0" y1="2" x2="16" y2="2" stroke={EXPENSE} strokeWidth="2.5" />
          </svg>
          This month
        </span>
        {typical && (
          <span className="flex items-center gap-1.5">
            <svg width="16" height="4" aria-hidden>
              <line x1="0" y1="2" x2="16" y2="2" stroke={NEUTRAL} strokeWidth="2" strokeDasharray="5 3" />
            </svg>
            Typical month
          </span>
        )}
        {expectedEnd !== null && elapsed < daysInMonth && (
          <span className="flex items-center gap-1.5">
            <svg width="16" height="4" aria-hidden>
              <line x1="0" y1="2" x2="16" y2="2" stroke={EXPENSE} strokeWidth="2" strokeDasharray="1 4" strokeLinecap="round" />
            </svg>
            Expected
          </span>
        )}
      </div>
    </div>
  )
}

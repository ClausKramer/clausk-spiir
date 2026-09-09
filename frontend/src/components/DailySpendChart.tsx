import { useState } from 'react'
import { EXPENSE, NET, SURFACE } from '../lib/chartColors'

export interface DailySpend {
  day: number
  amount: number
}

const W = 760
const H = 250
const PAD = { top: 16, right: 14, bottom: 28, left: 62 }
const PLOT_W = W - PAD.left - PAD.right
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
  daily: DailySpend[]
  daysInMonth: number
  /** Days of the month that have actually happened. Equals daysInMonth for a finished month. */
  elapsedDays: number
  onSelectDay?: (day: number) => void
}

// Daily spending for one month, with the running average per day laid over it.
//
// Both series are kroner, so they share one axis. The average sits far below the bars by
// construction — a single 3.000 kr day against a 400 kr/day average — and that gap is the
// point: it shows how much one day moved the rate. A second axis would flatter the average
// into looking comparable to the bars, which is exactly the false reading to avoid.
export function DailySpendChart({ daily, daysInMonth, elapsedDays, onSelectDay }: Props) {
  const [hover, setHover] = useState<number | null>(null)

  if (daily.length === 0) return <p className="py-8 text-center text-sm text-slate-600">No data for this month.</p>

  // Running average: everything spent up to and including day d, divided by d. Only defined
  // over days that have happened — dividing by days still to come would drag it toward zero
  // and understate the rate for the whole rest of the month.
  const elapsed = Math.min(Math.max(elapsedDays, 0), daysInMonth)
  const runningAvg: { day: number; value: number }[] = []
  let cumulative = 0
  for (let d = 1; d <= elapsed; d++) {
    cumulative += daily.find((x) => x.day === d)?.amount ?? 0
    runningAvg.push({ day: d, value: cumulative / d })
  }

  const rateSoFar = elapsed > 0 ? cumulative / elapsed : 0
  const isPartial = elapsed > 0 && elapsed < daysInMonth
  // Projection: the rest of the month spending at the rate established so far. Drawn flat,
  // because that is the assumption — it is what "at this rate" means, not a forecast.
  const projectedTotal = isPartial ? rateSoFar * daysInMonth : cumulative

  const maxBar = Math.max(...daily.map((d) => d.amount), 0)
  const maxV = Math.max(maxBar, ...runningAvg.map((p) => p.value), 0)
  const ticks = niceTicks(maxV)
  const domainMax = Math.max(maxV, ticks[ticks.length - 1] ?? 0) || 1

  const y = (v: number) => PAD.top + PLOT_H - (v / domainMax) * PLOT_H
  const band = PLOT_W / daysInMonth
  const bandX = (day: number) => PAD.left + (day - 1) * band
  const barW = Math.max(3, band - 3)
  const zeroY = y(0)

  const avgPoints = runningAvg.map((p) => `${bandX(p.day) + band / 2},${y(p.value)}`).join(' ')
  const projPoints =
    isPartial && elapsed > 0
      ? `${bandX(elapsed) + band / 2},${y(rateSoFar)} ${bandX(daysInMonth) + band / 2},${y(rateSoFar)}`
      : null

  const active = hover !== null ? daily.find((d) => d.day === hover) : null
  const activeAvg = hover !== null ? runningAvg.find((p) => p.day === hover) : null

  // Label every 5th day plus the last, so a 31-day axis doesn't collide with itself.
  const labelDays = daily.map((d) => d.day).filter((d) => d === 1 || d % 5 === 0 || d === daysInMonth)

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Daily spending and running average per day">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="#2a3346" strokeWidth={1} />
            <text x={PAD.left - 10} y={y(t) + 4} textAnchor="end" className="fill-slate-500" fontSize={11}>
              {kr(t)}
            </text>
          </g>
        ))}
        <line x1={PAD.left} x2={W - PAD.right} y1={zeroY} y2={zeroY} stroke="#475569" strokeWidth={1} />

        {/* Days that haven't happened yet, shaded so the bars' absence reads as "not yet"
            rather than "nothing spent". */}
        {isPartial && (
          <rect
            x={bandX(elapsed + 1)}
            y={PAD.top}
            width={PLOT_W - (bandX(elapsed + 1) - PAD.left)}
            height={PLOT_H}
            fill="#ffffff"
            opacity={0.02}
          />
        )}

        {daily.map((d) => {
          const h = Math.max(0, zeroY - y(d.amount))
          return (
            <g key={d.day}>
              <rect x={bandX(d.day) + 1.5} y={y(d.amount)} width={barW} height={h} fill={EXPENSE} rx={2} />
              {h > 2 && <rect x={bandX(d.day) + 1.5} y={zeroY - 2} width={barW} height={2} fill={EXPENSE} />}
            </g>
          )
        })}

        {/* Running average, over the bars */}
        <polyline points={avgPoints} fill="none" stroke={NET} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {projPoints && (
          <polyline
            points={projPoints}
            fill="none"
            stroke={NET}
            strokeWidth={2}
            strokeDasharray="4 4"
            strokeLinecap="round"
            opacity={0.75}
          />
        )}
        {elapsed > 0 && (
          <circle cx={bandX(elapsed) + band / 2} cy={y(rateSoFar)} r={4} fill={NET} stroke={SURFACE} strokeWidth={2} />
        )}

        {labelDays.map((d) => (
          <text key={`l-${d}`} x={bandX(d) + band / 2} y={H - 8} textAnchor="middle" className="fill-slate-500" fontSize={11}>
            {d}
          </text>
        ))}

        {daily.map((d) => (
          <rect
            key={`h-${d.day}`}
            x={bandX(d.day)}
            y={PAD.top}
            width={band}
            height={PLOT_H}
            fill="transparent"
            onMouseEnter={() => setHover(d.day)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(d.day)}
            onBlur={() => setHover(null)}
            onClick={onSelectDay && d.amount > 0 ? () => onSelectDay(d.day) : undefined}
            onKeyDown={
              onSelectDay && d.amount > 0
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onSelectDay(d.day)
                    }
                  }
                : undefined
            }
            tabIndex={onSelectDay && d.amount > 0 ? 0 : undefined}
            role={onSelectDay && d.amount > 0 ? 'button' : undefined}
            aria-label={`Day ${d.day}: ${kr(d.amount)} kroner spent`}
            className={onSelectDay && d.amount > 0 ? 'cursor-pointer focus:outline-none' : undefined}
          />
        ))}
        {hover !== null && (
          <line
            x1={bandX(hover) + band / 2}
            x2={bandX(hover) + band / 2}
            y1={PAD.top}
            y2={PAD.top + PLOT_H}
            stroke="#64748b"
            strokeWidth={1}
          />
        )}
      </svg>

      {hover !== null && (
        <div
          className="pointer-events-none absolute top-2 rounded-lg border border-slate-700 bg-[#111620] px-3 py-2 text-xs shadow-lg"
          style={{
            left: `${((bandX(hover) + band / 2) / W) * 100}%`,
            transform: hover > daysInMonth / 2 ? 'translateX(-108%)' : 'translateX(8%)',
          }}
        >
          <div className="mb-1 font-semibold text-slate-200">Day {hover}</div>
          <div className="flex items-center gap-2 whitespace-nowrap py-0.5">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: EXPENSE }} />
            <span className="text-slate-400">Spent</span>
            <span className="ml-auto tabular-nums text-slate-200">{kr(active?.amount ?? 0)} kr.</span>
          </div>
          {activeAvg && (
            <div className="flex items-center gap-2 whitespace-nowrap py-0.5">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: NET }} />
              <span className="text-slate-400">Avg. so far</span>
              <span className="ml-auto tabular-nums text-slate-200">{kr(activeAvg.value)} kr./day</span>
            </div>
          )}
          {onSelectDay && (active?.amount ?? 0) > 0 && (
            <div className="mt-1 border-t border-slate-700 pt-1 text-[0.65rem] text-slate-500">
              Click to see the day's transactions
            </div>
          )}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center justify-center gap-4 text-xs text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: EXPENSE }} />
          Spent that day
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="16" height="4" aria-hidden>
            <line x1="0" y1="2" x2="16" y2="2" stroke={NET} strokeWidth="2" />
          </svg>
          Average per day so far
        </span>
        {isPartial && (
          <span className="flex items-center gap-1.5">
            <svg width="16" height="4" aria-hidden>
              <line x1="0" y1="2" x2="16" y2="2" stroke={NET} strokeWidth="2" strokeDasharray="4 3" opacity="0.75" />
            </svg>
            At this rate
          </span>
        )}
      </div>

      {/* The money answer the projection implies. "At this rate" is an assumption, not a
          forecast, so it says so rather than presenting a number as inevitable. */}
      <p className="mt-2 text-center text-[0.72rem] text-slate-500">
        {elapsed === 0 ? (
          'This month hasn’t started yet.'
        ) : isPartial ? (
          <>
            <span className="text-slate-300">{kr(cumulative)} kr.</span> spent over {elapsed} day
            {elapsed === 1 ? '' : 's'} — <span className="text-slate-300">{kr(rateSoFar)} kr./day</span>. At this
            rate the month finishes near <span className="font-semibold text-slate-200">{kr(projectedTotal)} kr.</span>
          </>
        ) : (
          <>
            <span className="text-slate-300">{kr(cumulative)} kr.</span> over {daysInMonth} days —{' '}
            <span className="text-slate-300">{kr(rateSoFar)} kr./day</span>.
          </>
        )}
      </p>
    </div>
  )
}

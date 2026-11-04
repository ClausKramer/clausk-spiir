import { useState } from 'react'
import type { MonthlyFlow } from '../api/transactions'
// This chart's three series are the FLOW set in lib/chartColors — validated together under
// all-pairs against this surface. See that file before changing any of them.
import { INCOME, EXPENSE, NET, SURFACE } from '../lib/chartColors'
import { useChartWidth } from '../lib/useChartWidth'
import { MONTH_NAMES } from '../lib/period'

const H = 280
const PAD = { top: 16, right: 14, bottom: 30, left: 62 }
const PLOT_H = H - PAD.top - PAD.bottom
const MAX_BAR = 24 // never fill the band — the leftover is deliberate air

const kr = (n: number) => Math.round(n).toLocaleString('da-DK')

// Clean tick values (1/2/5 × 10^n) so the axis carries the numbers the marks aren't labelled with.
function niceTicks(min: number, max: number, count = 4): number[] {
  if (max === min) return [min]
  const raw = (max - min) / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag
  const ticks: number[] = []
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) ticks.push(v)
  return ticks
}

export function CashFlowChart({
  data,
  onSelect,
}: {
  data: MonthlyFlow[]
  // Drill-down for one bar. Omitted, the chart stays purely presentational.
  onSelect?: (direction: 'income' | 'expense', month: MonthlyFlow) => void
}) {
  const [chartRef, W] = useChartWidth()
  const PLOT_W = W - PAD.left - PAD.right
  const [hover, setHover] = useState<number | null>(null)

  if (data.length === 0) return <p className="py-8 text-center text-sm text-slate-400">No data for this period.</p>

  // One shared scale for all three series — they're all kroner. A second y-axis would let the
  // reader infer relationships between bars and line that the numbers don't support.
  const maxV = Math.max(...data.map((d) => Math.max(d.income, d.expense, d.net)), 0)
  const minV = Math.min(...data.map((d) => d.net), 0)
  const ticks = niceTicks(minV, maxV)
  const domainMin = Math.min(minV, ticks[0] ?? 0)
  const domainMax = Math.max(maxV, ticks[ticks.length - 1] ?? 0)
  const span = domainMax - domainMin || 1

  const y = (v: number) => PAD.top + PLOT_H - ((v - domainMin) / span) * PLOT_H

  // Cap how wide a single month's band may get and centre the group. Spreading one or two
  // months across the full width leaves the bars marooned in empty space and exaggerates
  // their apparent spacing; the gridlines still span the full plot, so the frame looks intact.
  const plotW = Math.min(PLOT_W, data.length * 110)
  const originX = PAD.left + (PLOT_W - plotW) / 2
  const band = plotW / data.length
  const bandX = (i: number) => originX + i * band
  const barW = Math.min(MAX_BAR, Math.max(6, band / 2 - 6))
  const zeroY = y(0)

  const netPoints = data.map((d, i) => `${bandX(i) + band / 2},${y(d.net)}`).join(' ')
  const active = hover !== null ? data[hover] : null

  return (
    <div ref={chartRef} className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Monthly income, expenses and net">
        {/* Gridlines: hairline, solid, recessive */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="#2a3346" strokeWidth={1} />
            <text x={PAD.left - 10} y={y(t) + 4} textAnchor="end" className="fill-slate-400" fontSize={12}>
              {kr(t)}
            </text>
          </g>
        ))}
        {/* Zero baseline sits above the grid — bars grow from it and net crosses it */}
        <line x1={PAD.left} x2={W - PAD.right} y1={zeroY} y2={zeroY} stroke="#475569" strokeWidth={1} />

        {data.map((d, i) => {
          const cx = bandX(i) + band / 2
          // 2px surface gap between the touching pair, so they read as separate marks
          // without a stroke adding ink that isn't data.
          const incomeX = cx - barW - 1
          const expenseX = cx + 1
          return (
            <g key={`${d.year}-${d.month}`}>
              <rect x={incomeX} y={y(d.income)} width={barW} height={Math.max(0, zeroY - y(d.income))} fill={INCOME} rx={4} />
              <rect x={expenseX} y={y(d.expense)} width={barW} height={Math.max(0, zeroY - y(d.expense))} fill={EXPENSE} rx={4} />
              {/* Square off the rounded corners at the baseline — data-ends round, baseline square.
                  Skipped on bars shorter than the radius, where it would sit above the bar's own top. */}
              {zeroY - y(d.income) > 4 && <rect x={incomeX} y={zeroY - 4} width={barW} height={4} fill={INCOME} />}
              {zeroY - y(d.expense) > 4 && <rect x={expenseX} y={zeroY - 4} width={barW} height={4} fill={EXPENSE} />}
              <text x={cx} y={H - 10} textAnchor="middle" className="fill-slate-400" fontSize={12}>
                {W < 520 ? MONTH_NAMES[d.month - 1].slice(0, 1) : MONTH_NAMES[d.month - 1]}
              </text>
            </g>
          )
        })}

        {/* Net trend, drawn last so it reads on top of the bars */}
        <polyline points={netPoints} fill="none" stroke={NET} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {data.map((d, i) => (
          <circle
            key={`n-${d.year}-${d.month}`}
            cx={bandX(i) + band / 2}
            cy={y(d.net)}
            r={4}
            fill={NET}
            stroke={SURFACE}
            strokeWidth={2}
          />
        ))}

        {/* Hit targets: half a band each, far bigger than the bars they select, and split down
            the middle so income and expenses are separately clickable. Both halves drive the
            same crosshair, so hovering still reads as one month. */}
        {data.flatMap((d, i) =>
          (['income', 'expense'] as const).map((dir, half) => (
            <rect
              key={`h-${dir}-${d.year}-${d.month}`}
              x={bandX(i) + (half * band) / 2}
              y={PAD.top}
              width={band / 2}
              height={PLOT_H}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onClick={onSelect ? () => onSelect(dir, d) : undefined}
              onKeyDown={
                onSelect
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onSelect(dir, d)
                      }
                    }
                  : undefined
              }
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              tabIndex={onSelect ? 0 : undefined}
              role={onSelect ? 'button' : undefined}
              aria-label={
                onSelect
                  ? `${dir === 'income' ? 'Income' : 'Expenses'} for ${MONTH_NAMES[d.month - 1]} ${d.year}: ${kr(
                      dir === 'income' ? d.income : d.expense,
                    )} kroner`
                  : undefined
              }
              className={onSelect ? 'cursor-pointer focus:outline-none focus-visible:stroke-slate-400' : undefined}
            />
          )),
        )}
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

      {active && (
        <div
          className="pointer-events-none absolute top-2 rounded-lg border border-slate-700 bg-[#111620] px-3 py-2 text-xs shadow-lg"
          style={{
            left: `${((bandX(hover!) + band / 2) / W) * 100}%`,
            transform: hover! > data.length / 2 ? 'translateX(-108%)' : 'translateX(8%)',
          }}
        >
          <div className="mb-1 font-semibold text-slate-200">
            {MONTH_NAMES[active.month - 1]} {active.year}
          </div>
          {/* Identity comes from the swatch, never from colouring the text */}
          {[
            { label: 'Income', value: active.income, color: INCOME },
            { label: 'Expenses', value: active.expense, color: EXPENSE },
            { label: 'Net', value: active.net, color: NET },
          ].map((row) => (
            <div key={row.label} className="flex items-center gap-2 whitespace-nowrap py-0.5">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: row.color }} />
              <span className="text-slate-400">{row.label}</span>
              <span className="ml-auto tabular-nums text-slate-200">{kr(row.value)} kr.</span>
            </div>
          ))}
          {onSelect && (
            <div className="mt-1 border-t border-slate-700 pt-1 text-xs text-slate-400">
              Click a bar to break it down
            </div>
          )}
        </div>
      )}

      {/* Legend is always present for 2+ series — identity never rests on colour alone */}
      <div className="mt-2 flex flex-wrap items-center justify-center gap-4 text-xs text-slate-400">
        {[
          { label: 'Income', color: INCOME },
          { label: 'Expenses', color: EXPENSE },
          { label: 'Net', color: NET },
        ].map((s) => (
          <span key={s.label} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  )
}

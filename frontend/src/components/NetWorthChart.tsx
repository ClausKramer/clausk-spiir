import { useState } from 'react'
import { INCOME, EXPENSE, NET, SURFACE } from '../lib/chartColors'
import { MONTH_NAMES } from '../lib/period'

export interface NetWorthPoint {
  year: number
  month: number
  assets: number
  liabilities: number
  net: number
}

const W = 760
const H = 300
const PAD = { top: 16, right: 14, bottom: 32, left: 76 }
const PLOT_W = W - PAD.left - PAD.right
const PLOT_H = H - PAD.top - PAD.bottom
const MAX_BAR = 26

const kr = (n: number) => Math.round(n).toLocaleString('da-DK')

function niceTicks(min: number, max: number, count = 5): number[] {
  if (max === min) return [min]
  const raw = (max - min) / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag
  const ticks: number[] = []
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) ticks.push(v)
  return ticks
}

// Net worth over time: what you own above the line, what you owe below it, and the net as a
// line crossing between them.
//
// Liabilities are drawn downward rather than as a second upward bar because that is what they
// do to the figure — the gap between the two bars is the net, readable without arithmetic.
// Drawing both upward would invite reading them as two kinds of the same thing.
export function NetWorthChart({
  data,
  onSelect,
}: {
  data: NetWorthPoint[]
  /** Opens a month for editing. Optional so the chart stays usable as a plain read-only view. */
  onSelect?: (point: NetWorthPoint) => void
}) {
  const [hover, setHover] = useState<number | null>(null)

  if (data.length === 0)
    return <p className="py-10 text-center text-sm text-slate-600">Nothing recorded for this period yet.</p>

  // One scale, all kroner. Liabilities extend below zero, so the domain has to reach there.
  const maxV = Math.max(...data.map((d) => Math.max(d.assets, d.net)), 0)
  const minV = Math.min(...data.map((d) => Math.min(-d.liabilities, d.net)), 0)
  const ticks = niceTicks(minV, maxV)
  const domainMin = Math.min(minV, ticks[0] ?? 0)
  const domainMax = Math.max(maxV, ticks[ticks.length - 1] ?? 0)
  const span = domainMax - domainMin || 1

  const y = (v: number) => PAD.top + PLOT_H - ((v - domainMin) / span) * PLOT_H

  const plotW = Math.min(PLOT_W, data.length * 110)
  const originX = PAD.left + (PLOT_W - plotW) / 2
  const band = plotW / data.length
  const bandX = (i: number) => originX + i * band
  const barW = Math.min(MAX_BAR, Math.max(6, band / 2 - 6))
  const zeroY = y(0)

  const netPoints = data.map((d, i) => `${bandX(i) + band / 2},${y(d.net)}`).join(' ')
  const active = hover !== null ? data[hover] : null

  // Label every month when there's room, otherwise thin them out so a lifetime view of 40
  // months doesn't collide with itself.
  const labelEvery = Math.max(1, Math.ceil(data.length / 12))

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Net worth over time: assets, liabilities and net">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="#2a3346" strokeWidth={1} />
            <text x={PAD.left - 10} y={y(t) + 4} textAnchor="end" className="fill-slate-500" fontSize={11}>
              {kr(t)}
            </text>
          </g>
        ))}
        <line x1={PAD.left} x2={W - PAD.right} y1={zeroY} y2={zeroY} stroke="#475569" strokeWidth={1} />

        {data.map((d, i) => {
          const cx = bandX(i) + band / 2
          const assetX = cx - barW - 1
          const liabX = cx + 1
          const assetH = Math.max(0, zeroY - y(d.assets))
          const liabH = Math.max(0, y(-d.liabilities) - zeroY)
          return (
            <g key={`${d.year}-${d.month}`}>
              <rect x={assetX} y={y(d.assets)} width={barW} height={assetH} fill={INCOME} rx={4} />
              {assetH > 4 && <rect x={assetX} y={zeroY - 4} width={barW} height={4} fill={INCOME} />}
              <rect x={liabX} y={zeroY} width={barW} height={liabH} fill={EXPENSE} rx={4} />
              {liabH > 4 && <rect x={liabX} y={zeroY} width={barW} height={4} fill={EXPENSE} />}
              {i % labelEvery === 0 && (
                <text x={cx} y={H - 10} textAnchor="middle" className="fill-slate-500" fontSize={11}>
                  {MONTH_NAMES[d.month - 1]}
                  {data.length > 12 && <tspan className="fill-slate-600"> {String(d.year).slice(2)}</tspan>}
                </text>
              )}
            </g>
          )
        })}

        <polyline points={netPoints} fill="none" stroke={NET} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {data.map((d, i) => (
          <circle key={`n-${d.year}-${d.month}`} cx={bandX(i) + band / 2} cy={y(d.net)} r={4} fill={NET} stroke={SURFACE} strokeWidth={2} />
        ))}

        {data.map((d, i) => (
          <rect
            key={`h-${d.year}-${d.month}`}
            x={bandX(i)}
            y={PAD.top}
            width={band}
            height={PLOT_H}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
            onClick={onSelect ? () => onSelect(d) : undefined}
            onKeyDown={
              onSelect
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onSelect(d)
                    }
                  }
                : undefined
            }
            tabIndex={onSelect ? 0 : undefined}
            role={onSelect ? 'button' : undefined}
            aria-label={onSelect ? `Edit ${MONTH_NAMES[d.month - 1]} ${d.year}` : undefined}
            className={onSelect ? 'cursor-pointer focus:outline-none' : undefined}
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
          {[
            { label: 'Own', value: active.assets, color: INCOME },
            { label: 'Owe', value: active.liabilities, color: EXPENSE },
            { label: 'Net', value: active.net, color: NET },
          ].map((row) => (
            <div key={row.label} className="flex items-center gap-2 whitespace-nowrap py-0.5">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: row.color }} />
              <span className="text-slate-400">{row.label}</span>
              <span className="ml-auto tabular-nums text-slate-200">{kr(row.value)} kr.</span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center justify-center gap-4 text-xs text-slate-400">
        {[
          { label: 'What you own', color: INCOME },
          { label: 'What you owe', color: EXPENSE },
          { label: 'Net worth', color: NET },
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

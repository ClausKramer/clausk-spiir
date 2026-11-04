import type { Period } from '../api/transactions'
import { MONTH_NAMES } from '../lib/period'

interface Props {
  // null means "no period filter at all" — only reachable when allowAllYears is set.
  period: Period | null
  onChange: (period: Period | null) => void
  // Years that actually hold transactions. The caller folds the current selection in, so the
  // picker can always represent what it is currently showing.
  availableYears: number[]
  // Adds an "All years" entry to the year select, for views that legitimately show everything
  // on record rather than a chosen period.
  allowAllYears?: boolean
}

// Year + month selects with step-back/step-forward arrows. The arrows move by whatever unit is
// selected — a month at a time when viewing one month, a year at a time on "All year" — because
// that's the unit the reader is looking at. Stepping past December rolls into the next year
// rather than dead-ending, so browsing a long history never needs the year select.
export function PeriodNavigator({
  period,
  onChange,
  availableYears,
  allowAllYears = false,
}: Props) {
  const minYear = Math.min(...availableYears)
  const maxYear = Math.max(...availableYears)

  function step(direction: -1 | 1) {
    if (period === null) return
    if (period.month === null) {
      onChange({ year: period.year + direction, month: null })
      return
    }
    const absolute = period.year * 12 + (period.month - 1) + direction
    onChange({ year: Math.floor(absolute / 12), month: (absolute % 12) + 1 })
  }

  function pickYear(raw: string) {
    if (raw === '') {
      onChange(null)
      return
    }
    onChange({ year: Number(raw), month: period?.month ?? null })
  }

  function pickMonth(raw: string) {
    const month = raw === '' ? null : Number(raw)
    // Choosing a month out of "All years" has to land somewhere: the most recent year with data
    // is the only sensible guess, and it's the one the reader is most likely after.
    onChange({ year: period?.year ?? maxYear, month })
  }

  // Stepping is meaningless with no period selected, and stopping at the edges of recorded
  // history keeps the reader out of empty years they'd have no obvious way back from.
  const stepsByMonth = period !== null && period.month !== null
  const canStepBack =
    period !== null && (stepsByMonth ? period.year > minYear || period.month! > 1 : period.year > minYear)
  const canStepForward =
    period !== null && (stepsByMonth ? period.year < maxYear || period.month! < 12 : period.year < maxYear)

  const unit = stepsByMonth ? 'month' : 'year'

  const selectClass = 'min-h-9 rounded-lg border border-slate-700 bg-[#1a1f2e] px-2.5 py-1 text-sm font-medium text-slate-200 outline-none focus:border-indigo-500'

  const arrowClass = 'min-h-9 min-w-9 rounded-lg border border-slate-700 bg-[#1a1f2e] px-2 py-1 text-sm text-slate-300 enabled:hover:bg-[#232b3b] disabled:opacity-30'

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={() => step(-1)}
        disabled={!canStepBack}
        className={arrowClass}
        aria-label={`Previous ${unit}`}
        title={`Previous ${unit}`}
      >
        ‹
      </button>

      <select
        value={period?.year ?? ''}
        onChange={(e) => pickYear(e.target.value)}
        className={selectClass}
        aria-label="Year"
      >
        {allowAllYears && <option value="">All years</option>}
        {availableYears.map((y) => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>

      <select
        value={period?.month ?? ''}
        onChange={(e) => pickMonth(e.target.value)}
        className={selectClass}
        aria-label="Month"
      >
        <option value="">All year</option>
        {MONTH_NAMES.map((name, i) => (
          <option key={name} value={i + 1}>{name}</option>
        ))}
      </select>

      <button
        onClick={() => step(1)}
        disabled={!canStepForward}
        className={arrowClass}
        aria-label={`Next ${unit}`}
        title={`Next ${unit}`}
      >
        ›
      </button>
    </div>
  )
}

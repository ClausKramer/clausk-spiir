import type { Period } from '../api/transactions'

export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// "Aug 2026" for a single month, "2026" for a whole year — the same wording the picker shows,
// so a panel heading always names the period the reader selected.
export function periodLabel(period: Period) {
  return period.month === null ? String(period.year) : `${MONTH_NAMES[period.month - 1]} ${period.year}`
}

// One URL convention for the period, shared by every page so a link built on one page reads
// the same on another:
//
//   (no year)        → not specified; the page applies its own default
//   ?year=2026       → the whole of 2026
//   ?year=2026&month=3 → March 2026
//
// `year` alone therefore means "all year" explicitly, which is what lets an absent year mean
// "unspecified" rather than colliding with it.
export function readPeriod(search: URLSearchParams): Period | null {
  const year = Number(search.get('year'))
  if (!year) return null
  const month = search.get('month')
  return { year, month: month ? Number(month) : null }
}

export function writePeriod(params: URLSearchParams, period: Period | null) {
  if (period === null) {
    params.delete('year')
    params.delete('month')
    return
  }
  params.set('year', String(period.year))
  if (period.month === null) params.delete('month')
  else params.set('month', String(period.month))
}

export function currentMonth(): Period {
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() + 1 }
}

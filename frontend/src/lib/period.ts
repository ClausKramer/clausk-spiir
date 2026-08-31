import type { Period } from '../api/transactions'

export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// "Aug 2026" for a single month, "2026" for a whole year — the same wording the picker shows,
// so a panel heading always names the period the reader selected.
export function periodLabel(period: Period) {
  return period.month === null ? String(period.year) : `${MONTH_NAMES[period.month - 1]} ${period.year}`
}

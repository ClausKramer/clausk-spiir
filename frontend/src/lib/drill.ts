import type { Period, TransactionQuery } from '../api/transactions'
import { writePeriod } from './period'

// The way back to the dashboard from any detail page, carrying the period and account filter
// the reader was looking at. Returning to a bare /dashboard would silently reset both and land
// them on a different view than the one they drilled out of.
export function dashboardLink(accountIds: string[], period: Period | null): string {
  const p = new URLSearchParams()
  writePeriod(p, period)
  accountIds.forEach((id) => p.append('accountIds', id))
  const qs = p.toString()
  return qs ? `/dashboard?${qs}` : '/dashboard'
}

// Builds the URL behind a calculated figure. Every clickable number on every page goes through
// here, so the link and the aggregation can't drift apart in wording or in which filters travel.
//
// `label` is what the figure was called where it was clicked — the drill-down page shows it as
// its heading, so the reader lands on a page that names the thing they clicked rather than a
// generic list they have to re-identify.
export function drillTo(
  label: string,
  query: TransactionQuery,
  accountIds: string[],
  period: Period,
  opts?: {
    // Which of net/inflow/outflow the figure meant, so the page's headline is the number that
    // was clicked rather than a different one computed from the same rows.
    measure?: Measure
    // A figure about one month links to that month, not the page's whole period.
    month?: { year: number; month: number }
  },
): string {
  const overrideMonth = opts?.month
  const p = new URLSearchParams()
  p.set('label', label)
  if (opts?.measure) p.set('measure', opts.measure)
  p.set('year', String(overrideMonth?.year ?? period.year))
  const month = overrideMonth?.month ?? period.month
  if (month !== null && month !== undefined) p.set('month', String(month))
  accountIds.forEach((id) => p.append('accountIds', id))

  Object.entries(query).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== false) p.set(k, String(v))
  })

  return `/view?${p.toString()}`
}

// Which of net/inflow/outflow a figure meant. A spending bar means money out, an income bar
// means money in, a balance or surplus means the signed difference — showing the wrong one
// would contradict the number the reader clicked.
export type Measure = 'net' | 'inflow' | 'outflow'

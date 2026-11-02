import { client } from './client'
import type { Period } from './transactions'

export interface StillToComeItem {
  merchantKey: string
  displayName: string
  categoryEmoji: string | null
  amount: number
  expectedDate: string
  // The date has passed with no payment seen yet — usually the bank posting a day or two late.
  overdue: boolean
}

// What a typical month looks like, from the twelve before it. Null when there's no history to
// average, rather than zeros that would read as "you usually spend nothing".
export interface TypicalMonth {
  // The months the average is taken over, so one that looks wrong can be checked: a single
  // enormous month, or every month high.
  months: { year: number; month: number; spend: number }[]
  // What an average month is made of, in the dashboard's buckets. "other" is spending filed under
  // an income or transfer category.
  byKind: {
    fixed: number
    variable: number
    savings: number
    debt: number
    uncategorized: number
    other: number
  }
  // The middle month of the twelve, not the mean: one large one-off month would drag a mean up
  // and it is not typical by definition.
  monthSpend: number
  // The mean, kept so the gap between the two shows how lumpy the year was. `byKind` is its split.
  averageMonthSpend: number
  // The same point in the month — a whole month's spend means little on the 3rd.
  spendByNow: number
  everydayByNow: number
  everydayRemaining: number
  income: number
  incomeByNow: number
  // Running total by day, one entry per day of the month.
  cumulative: number[]
}

export interface MonthOutlook {
  year: number
  month: number
  daysInMonth: number
  elapsedDays: number
  isCurrent: boolean
  isFinished: boolean
  hasBaseline: boolean
  baselineMonths: number
  spentSoFar: number
  // Spending on detected recurring bills, and on everything else.
  billsPaid: number
  everydaySoFar: number
  incomeSoFar: number
  // Running total up to today, one entry per elapsed day.
  cumulative: number[]
  typical: TypicalMonth | null
  stillToCome: { total: number; items: StillToComeItem[] }
  // Spent so far, plus bills still due, plus everyday spending at its usual pace. An estimate.
  expectedMonthEnd: number | null
}

export async function getMonthOutlook(accountIds: string[], period: Period): Promise<MonthOutlook> {
  const params = new URLSearchParams()
  params.set('year', String(period.year))
  if (period.month !== null) params.set('month', String(period.month))
  accountIds.forEach((id) => params.append('accountIds', id))
  const { data } = await client.get('/month/outlook', { params })
  return data
}

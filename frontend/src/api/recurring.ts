import { client } from './client'

export type RecurringCadence = 'Weekly' | 'Biweekly' | 'Monthly' | 'Quarterly' | 'Yearly'

export interface RecurringSeries {
  merchantKey: string
  displayName: string
  categoryId: string | null
  categoryName: string | null
  categoryEmoji: string | null
  cadence: RecurringCadence
  occurrenceCount: number
  firstSeen: string
  lastSeen: string
  lastAmount: number
  previousAmount: number
  priceChanged: boolean
  monthlyEquivalentCost: number
  nextExpectedDate: string
}

export interface RecurringResult {
  series: RecurringSeries[]
  totalMonthlyEquivalent: number
  count: number
}

export async function getRecurring(): Promise<RecurringResult> {
  const { data } = await client.get('/recurring')
  return data
}

export interface DismissedSeries {
  merchantKey: string
  dismissedAt: string
}

export async function getDismissedRecurring(): Promise<DismissedSeries[]> {
  const { data } = await client.get('/recurring/dismissed')
  return data
}

export async function dismissRecurring(merchantKey: string): Promise<void> {
  await client.post(`/recurring/${encodeURIComponent(merchantKey)}/dismiss`)
}

export async function undismissRecurring(merchantKey: string): Promise<void> {
  await client.post(`/recurring/${encodeURIComponent(merchantKey)}/undismiss`)
}

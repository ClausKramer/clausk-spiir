import { client } from './client'

// null clears the budget for this category rather than setting it to zero.
export async function setBudget(categoryId: string, limitAmount: number | null): Promise<void> {
  await client.put(`/budgets/${categoryId}`, { limitAmount })
}

export interface BudgetGroup {
  categoryId: string
  categoryName: string
  categoryEmoji: string | null
  limit: number | null
  actual: number
  // Average over the twelve months before this one. Null rather than zero when there's no
  // history to average — "typically nothing" would claim a baseline that doesn't exist yet.
  average: number | null
  remaining: number | null
  // This month runs well above the baseline: usually a quarterly or yearly charge landing in an
  // otherwise ordinary month, which is why it isn't treated as plain overspending.
  unusual: boolean
}

export interface BudgetDashboard {
  year: number
  month: number
  groups: BudgetGroup[]
  totalLimit: number
  totalActual: number
  totalAverage: number
  hasAnyBudgets: boolean
}

export async function getBudgetDashboard(year?: number, month?: number): Promise<BudgetDashboard> {
  const { data } = await client.get('/budgets/dashboard', { params: { year, month } })
  return data
}

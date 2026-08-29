import { client } from './client'

export interface Transaction {
  id: string
  bankAccountId: string
  bookingDate: string
  amount: number
  currency: string
  description: string
  categoryId: string | null
  categoryName: string | null
  categoryEmoji: string | null
  isCategoryManual: boolean
  // Bank-reported payment dated in the future — shown, but left out of every total.
  isFuture: boolean
}

export interface TransactionPage {
  items: Transaction[]
  totalCount: number
  page: number
  pageSize: number
}

// period is optional: the dashboard scopes to its selection, the per-account list shows everything.
export async function getTransactions(
  page = 1,
  pageSize = 50,
  accountIds: string[] = [],
  period?: Period,
): Promise<TransactionPage> {
  const params = new URLSearchParams()
  params.set('page', String(page))
  params.set('pageSize', String(pageSize))
  accountIds.forEach((id) => params.append('accountIds', id))
  if (period) {
    params.set('year', String(period.year))
    if (period.month !== null) params.set('month', String(period.month))
  }
  const { data } = await client.get('/transactions', { params })
  return data
}

export async function setTransactionCategory(
  id: string,
  categoryId: string | null,
): Promise<{ merchantKey: string | null }> {
  // Sets this transaction only. merchantKey is what a rule learned from it would match on —
  // use it with getSimilarTransactions to offer applying the change more broadly.
  const { data } = await client.patch(`/transactions/${id}/category`, { categoryId })
  return data ?? { merchantKey: null }
}

export interface SimilarTransaction {
  id: string
  bookingDate: string
  amount: number
  currency: string
  description: string
  categoryId: string | null
  categoryName: string | null
  categoryEmoji: string | null
}

export async function getSimilarTransactions(
  transactionId: string,
): Promise<{ merchantKey: string; items: SimilarTransaction[] }> {
  const { data } = await client.get('/transactions/similar', { params: { transactionId } })
  return data
}

export async function applyToSimilar(params: {
  categoryId: string
  transactionIds: string[]
  merchantKey: string | null
  createRule: boolean
}): Promise<{ updated: number; ruleCreated: boolean; message: string }> {
  const { data } = await client.post('/transactions/apply-to-similar', params)
  return data
}

export interface SpendingRow {
  categoryId: string | null
  categoryName: string | null
  categoryEmoji: string | null
  total: number
}

// The dashboard's period: a calendar year, or one month of it when month is set.
export interface Period {
  year: number
  month: number | null
}

function periodParams(period: Period, accountIds: string[]): URLSearchParams {
  const params = new URLSearchParams()
  params.set('year', String(period.year))
  if (period.month !== null) params.set('month', String(period.month))
  accountIds.forEach((id) => params.append('accountIds', id))
  return params
}

export interface MonthlyFlow {
  year: number
  month: number
  income: number
  expense: number
  net: number
}

export interface DashboardData {
  from: string
  to: string
  year: number
  month: number | null
  months: number
  availableYears: number[]
  monthlyFlow: MonthlyFlow[]
  categoryBreakdown: SpendingRow[]
  excludedTransfers: number
  excludedFuture: number
  kpis: {
    avgMonthlyIncome: number
    avgMonthlyExpense: number
    avgMonthlySurplus: number
    netBalance: number
  }
}

export interface RecategorizeResult {
  examined: number
  updated: number
  message: string
}

export async function recategorize(onlyUncategorized = true): Promise<RecategorizeResult> {
  const { data } = await client.post('/transactions/recategorize', null, {
    params: { onlyUncategorized },
  })
  return data
}

export interface CategoryTransactions {
  categoryId: string | null
  from: string
  to: string
  total: number
  items: Transaction[]
}

export async function getTransactionsByCategory(
  categoryId: string | null,
  accountIds: string[],
  period: Period,
): Promise<CategoryTransactions> {
  const params = periodParams(period, accountIds)
  if (categoryId) params.set('categoryId', categoryId)
  const { data } = await client.get('/transactions/by-category', { params })
  return data
}

export async function getDashboard(accountIds: string[], period: Period): Promise<DashboardData> {
  const { data } = await client.get('/transactions/dashboard', {
    params: periodParams(period, accountIds),
  })
  return data
}

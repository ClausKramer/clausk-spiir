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
}

export interface TransactionPage {
  items: Transaction[]
  totalCount: number
  page: number
  pageSize: number
}

export async function getTransactions(page = 1, pageSize = 50, accountIds: string[] = []): Promise<TransactionPage> {
  const params = new URLSearchParams()
  params.set('page', String(page))
  params.set('pageSize', String(pageSize))
  accountIds.forEach((id) => params.append('accountIds', id))
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

export interface MonthlySummary {
  year: number
  month: number
  categories: SpendingRow[]
}

export async function getMonthlySummary(year?: number, month?: number): Promise<MonthlySummary> {
  const { data } = await client.get('/transactions/summary', { params: { year, month } })
  return data
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
  months: number
  monthlyFlow: MonthlyFlow[]
  categoryBreakdown: SpendingRow[]
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

export async function getDashboard(accountIds: string[] = [], months = 6): Promise<DashboardData> {
  const params = new URLSearchParams()
  params.set('months', String(months))
  accountIds.forEach((id) => params.append('accountIds', id))
  const { data } = await client.get('/transactions/dashboard', { params })
  return data
}

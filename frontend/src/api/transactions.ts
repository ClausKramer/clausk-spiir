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
  // Paired against an opposite leg in another of your accounts, so left out of income/expense.
  isTransfer: boolean
  // Set by hand rather than matched — overrides the automatic detection either way.
  isManualTransfer: boolean
  // Marked as a duplicate copy — excluded from every total.
  isDuplicate: boolean
  // Free-form labels, orthogonal to the category: a transaction is filed under exactly one
  // category but can carry any number of tags.
  tags: { tagId: string; name: string }[]
}

export interface DuplicateGroup {
  bankAccountId: string
  bookingDate: string
  amount: number
  currency: string
  suggestedIds: string[]
  items: { id: string; description: string; source: 'csv' | 'bank'; isDuplicate: boolean; createdAt: string }[]
}

export interface DuplicateReport {
  groupCount: number
  extraCount: number
  alreadyMarked: number
  groups: DuplicateGroup[]
}

export async function getDuplicates(): Promise<DuplicateReport> {
  const { data } = await client.get('/transactions/duplicates')
  return data
}

export async function markDuplicate(
  transactionIds: string[],
  isDuplicate: boolean,
): Promise<{ updated: number; message: string }> {
  const { data } = await client.post('/transactions/mark-duplicate', { transactionIds, isDuplicate })
  return data
}

export async function getCounterpartCandidates(transactionId: string): Promise<{ items: Transaction[] }> {
  const { data } = await client.get('/transactions/counterpart-candidates', { params: { transactionId } })
  return data
}

export async function markTransfer(
  transactionIds: string[],
  isTransfer: boolean,
): Promise<{ updated: number; message: string }> {
  const { data } = await client.post('/transactions/mark-transfer', { transactionIds, isTransfer })
  return data
}

export interface TransactionPage {
  items: Transaction[]
  totalCount: number
  page: number
  pageSize: number
  // Years holding transactions for this account filter, ignoring the current period — what the
  // period picker offers, so it can always get back out of a year it stepped into.
  availableYears: number[]
}

// period and includeFuture are optional: the dashboard scopes to its selection and hides
// bank-scheduled payments, while the per-account list shows an account's full history as-is.
export async function getTransactions(
  page = 1,
  pageSize = 50,
  accountIds: string[] = [],
  period?: Period,
  includeFuture = true,
): Promise<TransactionPage> {
  const params = new URLSearchParams()
  params.set('page', String(page))
  params.set('pageSize', String(pageSize))
  accountIds.forEach((id) => params.append('accountIds', id))
  if (period) {
    params.set('year', String(period.year))
    if (period.month !== null) params.set('month', String(period.month))
  }
  if (!includeFuture) params.set('includeFuture', 'false')
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
  // Months of the period that actually saw spending — the divisor for per-month averages, so a
  // half-elapsed year isn't averaged against months that haven't happened.
  monthsWithData: number
  monthlyFlow: MonthlyFlow[]
  // Rolled up to top-level groups; the category page breaks a group back into its leaves.
  categoryBreakdown: SpendingRow[]
  // Committed vs discretionary, from each category's declared kind rather than from how
  // often it recurs.
  spendingByKind: {
    fixed: number
    variable: number
    savings: number
    debt: number
    uncategorized: number
  }
  tagBreakdown: { tagId: string; name: string; total: number; count: number }[]
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

export interface CategoryMerchant {
  merchant: string
  total: number
  count: number
  average: number
  largest: number
  refundTotal: number
  monthsPresent: number
  isRecurring: boolean
}

export interface CategoryTransactions {
  categoryId: string | null
  from: string
  to: string
  year: number
  month: number | null
  // total is net: charges minus refunds carrying this category.
  total: number
  spendTotal: number
  refundTotal: number
  monthlyTotals: { year: number; month: number; total: number }[]
  merchants: CategoryMerchant[]
  byAccount: { bankAccountId: string; total: number; count: number }[]
  // A transaction can carry several tags, so these deliberately don't sum to `total`.
  tagBreakdown: { tagId: string; name: string; total: number; count: number }[]
  stats: {
    transactionCount: number
    refundCount: number
    averagePerMonth: number
    averageTransaction: number
    largest: number
    shareOfSpending: number
    recurringTotal: number
    monthsWithData: number
  }
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

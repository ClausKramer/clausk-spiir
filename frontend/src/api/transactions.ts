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

export async function getTransactions(page = 1, pageSize = 50): Promise<TransactionPage> {
  const { data } = await client.get('/transactions', { params: { page, pageSize } })
  return data
}

export async function setTransactionCategory(id: string, categoryId: string | null): Promise<void> {
  await client.patch(`/transactions/${id}/category`, { categoryId })
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

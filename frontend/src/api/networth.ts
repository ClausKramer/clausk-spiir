import { client } from './client'

// What an account is. Which side of the balance it falls on is derived from the kind on the
// server — the client never asserts it, so a mortgage can't be filed as an asset.
export const ASSET_KINDS = ['Cash', 'Savings', 'Investment', 'Pension', 'Property', 'OtherAsset'] as const
export const LIABILITY_KINDS = ['Mortgage', 'Loan', 'Credit'] as const
export type NetWorthKind = (typeof ASSET_KINDS)[number] | (typeof LIABILITY_KINDS)[number]

export const KIND_LABELS: Record<NetWorthKind, string> = {
  Cash: 'Cash',
  Savings: 'Savings',
  Investment: 'Investments',
  Pension: 'Pension',
  Property: 'Property',
  OtherAsset: 'Other assets',
  Mortgage: 'Mortgage',
  Loan: 'Loans',
  Credit: 'Credit',
}

export interface NetWorthAccount {
  id: string
  name: string
  kind: NetWorthKind
  isLiability: boolean
  currency: string
  bankAccountId: string | null
  isArchived: boolean
  sortOrder: number
}

export async function getNetWorthAccounts(includeArchived = false): Promise<NetWorthAccount[]> {
  const { data } = await client.get('/networth/accounts', { params: { includeArchived } })
  return data
}

export async function createNetWorthAccount(body: {
  name: string
  kind: NetWorthKind
  bankAccountId?: string | null
}): Promise<NetWorthAccount> {
  const { data } = await client.post('/networth/accounts', body)
  return data
}

export async function updateNetWorthAccount(
  id: string,
  body: { name: string; kind: NetWorthKind; bankAccountId?: string | null; isArchived?: boolean },
): Promise<void> {
  await client.patch(`/networth/accounts/${id}`, body)
}

export async function deleteNetWorthAccount(id: string): Promise<void> {
  await client.delete(`/networth/accounts/${id}`)
}

export interface NetWorthDue {
  year: number
  month: number
  // True once the 5th has passed and at least one account still has no figure for that month.
  isDue: boolean
  accountCount: number
  missingCount: number
  missing: { id: string; name: string; kind: NetWorthKind; isLiability: boolean }[]
}

export async function getNetWorthDue(): Promise<NetWorthDue> {
  const { data } = await client.get('/networth/due')
  return data
}

export interface EntryForm {
  year: number
  month: number
  items: {
    id: string
    name: string
    kind: NetWorthKind
    isLiability: boolean
    currency: string
    // Already recorded for this month, if it has been.
    value: number | null
    // The last figure recorded before this month — the starting point for the form.
    previousValue: number | null
    // For a linked bank account, a figure to start from. A suggestion only — the recorded
    // snapshot always wins.
    suggestedValue: number | null
    // Where that suggestion came from, which decides how it is labelled. 'bank' is the balance
    // the bank reported, offered only when its own date falls inside the month being recorded.
    // 'transactions' is our running sum as at month end — an estimate, since it covers only the
    // history the bank served.
    suggestedSource: 'bank' | 'transactions' | null
    // The date the suggestion describes.
    suggestedAsOf: string | null
  }[]
}

export async function getNetWorthEntry(year?: number, month?: number): Promise<EntryForm> {
  const { data } = await client.get('/networth/entry', { params: { year, month } })
  return data
}

export async function saveNetWorthEntry(body: {
  year: number
  month: number
  values: { accountId: string; value: number | null; note?: string }[]
}): Promise<{ saved: number; cleared: number; message: string }> {
  const { data } = await client.post('/networth/entry', body)
  return data
}

export interface NetWorthDashboard {
  scope: 'year' | 'lifetime'
  year: number | null
  availableYears: number[]
  hasAnyRecords: boolean
  accountCount: number
  series: { year: number; month: number; assets: number; liabilities: number; net: number }[]
  latest: {
    year: number
    month: number
    assets: number
    liabilities: number
    net: number
    // Null rather than zero when there's nothing to compare against — one data point is not a
    // trend, and "+0" would claim it was flat.
    changeInPeriod: number | null
    changeLastMonth: number | null
    monthsRecorded: number
  } | null
  byKind: { kind: NetWorthKind; isLiability: boolean; value: number; since: number; sinceLastMonth: number }[]
  byAccount: {
    accountId: string
    name: string
    kind: NetWorthKind
    isLiability: boolean
    value: number
    since: number
    sinceLastMonth: number
  }[]
}

export async function getNetWorthDashboard(
  scope: 'year' | 'lifetime',
  year?: number,
): Promise<NetWorthDashboard> {
  const { data } = await client.get('/networth/dashboard', { params: { scope, year } })
  return data
}

export interface ImportPayload {
  accounts: { name: string; kind: NetWorthKind }[]
  snapshots: { account: string; year: number; month: number; value: number }[]
}

// Bulk import, matched on account name. Idempotent: accounts already present are reused and
// snapshots upsert, so running it twice lands the same data rather than doubling it.
export async function importNetWorth(
  payload: ImportPayload,
): Promise<{ createdAccounts: number; written: number; skipped: number; message: string }> {
  const { data } = await client.post('/networth/import', payload)
  return data
}

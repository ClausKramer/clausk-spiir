import { client } from './client'

export interface Institution {
  name: string
  country: string
  bic?: string
  logo?: string
}

export interface BankAccount {
  id: string
  externalAccountId: string
  name: string
  iban?: string
  currency: string
  lastSyncedAt?: string
  createdAt: string
  // The balance the bank itself reported, signed (negative when overdrawn), or absent if it has
  // never been read. This is the account's actual balance — unlike the dashboard's "net balance
  // (tracked)", which only sums the transactions this app holds.
  balance?: number | null
  // Not necessarily the account's own currency: a bank may report the balance in another.
  balanceCurrency?: string | null
  // ISO 20022 balance type (CLBD, ITBD, ITAV, XPCD, …). Booked types describe settled money;
  // available ones can include an overdraft facility and entries still in flight.
  balanceType?: string | null
  // The date the bank says the figure describes.
  balanceReferenceDate?: string | null
  // When it was read. Kept apart from the reference date so a figure fetched today that describes
  // yesterday is never shown as current.
  balanceFetchedAt?: string | null
}

export interface RefreshBalanceResult {
  balance: number
  balanceCurrency: string
  balanceType?: string | null
  isBooked: boolean
  balanceReferenceDate?: string | null
  balanceFetchedAt: string
}

export interface SyncResult {
  synced: number
  skipped: number
  newTransactions: number
  balancesUpdated: number
  message: string
}

export async function getInstitutions(country = 'DK'): Promise<Institution[]> {
  const { data } = await client.get('/institutions', { params: { country } })
  return data
}

export async function getBankAccounts(): Promise<BankAccount[]> {
  const { data } = await client.get('/accounts')
  return data
}

export async function connectBank(aspspName: string, aspspCountry: string): Promise<{ url: string; reference: string }> {
  const { data } = await client.post('/accounts/connect', { aspspName, aspspCountry })
  return data
}

export async function finalizeConnection(ref: string, code: string): Promise<{ accounts: BankAccount[]; count: number }> {
  const { data } = await client.post('/accounts/finalize', { ref, code })
  return data
}

export async function deleteBankAccount(id: string): Promise<void> {
  await client.delete(`/accounts/${id}`)
}

export async function renameBankAccount(id: string, name: string): Promise<void> {
  await client.patch(`/accounts/${id}`, { name })
}

// Asks the bank for the balance now, rather than waiting for the next sync to pick it up.
//
// Sync reads balances on a 12-hour clock to stay inside the PSD2 cap on unattended AISP access.
// That cap is about polling with nobody there; this call is the account holder asking, so it is
// not rationed the same way — which is why the button exists rather than a shorter sync gap.
export async function refreshBalance(id: string): Promise<RefreshBalanceResult> {
  const { data } = await client.post(`/accounts/${id}/refresh-balance`)
  return data
}

export interface ImportCsvResult {
  imported: number
  skipped: number
  errors: string[]
  message: string
}

export async function importCsv(accountId: string, file: File): Promise<ImportCsvResult> {
  const formData = new FormData()
  formData.append('file', file)
  // client's instance default is Content-Type: application/json — axios won't override an
  // already-set header for FormData bodies, so it must be explicitly cleared here for the
  // browser to fill in multipart/form-data with the correct boundary itself.
  const { data } = await client.post(`/accounts/${accountId}/import-csv`, formData, {
    headers: { 'Content-Type': undefined },
  })
  return data
}

// fullHistory asks each bank for the earliest transactions it still exposes, rather than only
// what's new since the last sync. Worth doing once per account — banks generally stop offering
// full history a while after consent is granted.
export async function syncAll(fullHistory = false): Promise<SyncResult> {
  const { data } = await client.post('/sync', null, {
    params: fullHistory ? { fullHistory: true } : {},
  })
  return data
}

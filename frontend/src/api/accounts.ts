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
}

export interface SyncResult {
  synced: number
  skipped: number
  newTransactions: number
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

export async function syncAll(): Promise<SyncResult> {
  const { data } = await client.post('/sync')
  return data
}

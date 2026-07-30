import { client } from './client'

export interface Institution {
  id: string
  name: string
  bic?: string
  logo?: string
}

export interface BankAccount {
  id: string
  goCardlessAccountId: string
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

export async function connectBank(institutionId: string): Promise<{ link: string; reference: string }> {
  const { data } = await client.post('/accounts/connect', { institutionId })
  return data
}

export async function finalizeConnection(ref: string): Promise<{ accounts: BankAccount[]; count: number }> {
  const { data } = await client.post('/accounts/finalize', { ref })
  return data
}

export async function deleteBankAccount(id: string): Promise<void> {
  await client.delete(`/accounts/${id}`)
}

export async function syncAll(): Promise<SyncResult> {
  const { data } = await client.post('/sync')
  return data
}

import { client } from './client'

export interface Category {
  id: string
  name: string
  emoji: string | null
}

export async function getCategories(): Promise<Category[]> {
  const { data } = await client.get('/categories')
  return data
}

export interface SyncDefaultsResult {
  addedCategories: number
  addedRules: number
  message: string
}

export async function syncDefaultCategories(): Promise<SyncDefaultsResult> {
  const { data } = await client.post('/categories/sync-defaults')
  return data
}

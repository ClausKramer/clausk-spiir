import { client } from './client'

export interface Category {
  id: string
  name: string
  emoji: string | null
  // null for a top-level group; set for a leaf that transactions are filed under.
  parentCategoryId: string | null
  kind: 'Income' | 'Fixed' | 'Variable' | 'Savings' | 'Debt' | 'Transfer'
}

export async function getCategories(): Promise<Category[]> {
  const { data } = await client.get('/categories')
  return data
}

export interface SyncDefaultsResult {
  addedCategories: number
  addedRules: number
  removedRules: number
  message: string
}

export async function syncDefaultCategories(): Promise<SyncDefaultsResult> {
  const { data } = await client.post('/categories/sync-defaults')
  return data
}

export async function clearLearnedRules(): Promise<{ deleted: number; message: string }> {
  const { data } = await client.delete('/categories/learned-rules')
  return data
}

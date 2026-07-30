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

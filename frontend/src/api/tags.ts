import { client } from './client'

export interface Tag {
  id: string
  name: string
  transactionCount: number
  total: number
}

export async function getTags(): Promise<Tag[]> {
  const { data } = await client.get('/tags')
  return data
}

// Takes a name, not an id: typing a new tag and choosing an existing one are the same action
// from the user's side, so the server resolves or creates it in one call.
export async function attachTag(transactionId: string, name: string): Promise<{ id: string; name: string }> {
  const { data } = await client.post('/tags/attach', { transactionId, name })
  return data
}

export async function detachTag(transactionId: string, tagId: string): Promise<void> {
  await client.post('/tags/detach', { transactionId, tagId })
}

export async function deleteTag(tagId: string): Promise<void> {
  await client.delete(`/tags/${tagId}`)
}

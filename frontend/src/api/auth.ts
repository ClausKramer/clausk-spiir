import { client } from './client'

export interface UserDto {
  id: string
  email: string
  createdAt: string
}

export async function requestMagicLink(email: string) {
  await client.post('/auth/request-link', { email })
}

export async function verifyToken(token: string): Promise<{ accessToken: string; user: UserDto }> {
  const { data } = await client.post('/auth/verify', { token })
  return data
}

export async function refreshSession(): Promise<{ accessToken: string; user: UserDto }> {
  const { data } = await client.post('/auth/refresh')
  return data
}

export async function logout() {
  await client.post('/auth/logout')
}

export async function getMe(): Promise<UserDto> {
  const { data } = await client.get('/me')
  return data
}

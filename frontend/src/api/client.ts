import axios from 'axios'

export const client = axios.create({
  baseURL: '/api',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
})

client.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// On 401, try to refresh once
let isRefreshing = false
let refreshQueue: Array<(token: string | null) => void> = []

client.interceptors.response.use(
  (r) => r,
  async (error) => {
    const original = error.config
    if (error.response?.status !== 401 || original._retry) return Promise.reject(error)

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        refreshQueue.push((token) => {
          if (!token) return reject(error)
          original.headers.Authorization = `Bearer ${token}`
          resolve(client(original))
        })
      })
    }

    original._retry = true
    isRefreshing = true

    try {
      const { data } = await client.post('/auth/refresh')
      const newToken = data.accessToken
      localStorage.setItem('access_token', newToken)
      refreshQueue.forEach((cb) => cb(newToken))
      refreshQueue = []
      original.headers.Authorization = `Bearer ${newToken}`
      return client(original)
    } catch {
      localStorage.removeItem('access_token')
      refreshQueue.forEach((cb) => cb(null))
      refreshQueue = []
      return Promise.reject(error)
    } finally {
      isRefreshing = false
    }
  },
)

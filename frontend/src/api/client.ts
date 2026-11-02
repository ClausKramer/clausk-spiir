import axios from 'axios'

// Dev: Vite proxies '/api' to the local backend (see vite.config.ts).
// Prod: the frontend is a separately-hosted Static Web App, so it calls the Container App's
// public URL directly (see infra/modules/container-app-api.bicep for the CORS policy that
// allows this origin). VITE_API_BASE_URL is set by scripts/postprovision.sh into the azd
// environment after the first `azd provision`, so subsequent builds pick it up automatically.
const baseURL = import.meta.env.VITE_API_BASE_URL || '/api'

export const client = axios.create({
  baseURL,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
})

client.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// A 401 is the server saying "you are not signed in". Anything else — a 500, a timeout, no
// network — is the server failing to answer, which says nothing about whether you are signed in.
export const isUnauthorized = (err: unknown) => axios.isAxiosError(err) && err.response?.status === 401

// On 401, try to refresh once
let isRefreshing = false
type RefreshResult = { token: string } | { error: unknown }
let refreshQueue: Array<(result: RefreshResult) => void> = []

client.interceptors.response.use(
  (r) => r,
  async (error) => {
    const original = error.config
    // The refresh call itself goes through this same interceptor. If it 401s (no valid refresh
    // cookie), it must reject immediately — otherwise, with isRefreshing already true, it falls
    // into the queueing branch below and deadlocks waiting on itself forever (infinite spinner).
    if (error.response?.status !== 401 || original._retry || original.url === '/auth/refresh') {
      return Promise.reject(error)
    }

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        refreshQueue.push((result) => {
          if ('error' in result) return reject(result.error)
          original.headers.Authorization = `Bearer ${result.token}`
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
      refreshQueue.forEach((cb) => cb({ token: newToken }))
      refreshQueue = []
      original.headers.Authorization = `Bearer ${newToken}`
      return client(original)
    } catch (refreshError) {
      // Only the refresh call itself being refused (401) means the session is over. If it merely
      // failed — the database waking up, a dropped connection — the stored token and the refresh
      // cookie are still good, and throwing the token away would sign you out for a server hiccup.
      const signedOut = isUnauthorized(refreshError)
      if (signedOut) localStorage.removeItem('access_token')
      const failure = signedOut ? error : refreshError
      refreshQueue.forEach((cb) => cb({ error: failure }))
      refreshQueue = []
      return Promise.reject(failure)
    } finally {
      isRefreshing = false
    }
  },
)

import { Navigate } from 'react-router-dom'
import { useMe } from '../hooks/useAuth'
import { isUnauthorized } from '../api/client'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { data, isLoading, isError, error, refetch, isRefetching } = useMe()

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
      </div>
    )
  }

  if (isError) {
    // Only a refusal means signed out. A failure to answer must not look like one, or every
    // hiccup — the database waking up after idle is the common one — sends you to the login page
    // and costs you a magic-link round trip even though your session is perfectly fine.
    if (isUnauthorized(error)) return <Navigate to="/login" replace />

    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 px-4 text-center">
        <div className="text-3xl">⚠️</div>
        <p className="max-w-sm text-sm text-slate-500">
          Couldn't reach the server. You're still signed in — this is usually the database waking
          up after being idle.
        </p>
        <button
          onClick={() => refetch()}
          disabled={isRefetching}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {isRefetching ? 'Retrying…' : 'Try again'}
        </button>
      </div>
    )
  }

  if (!data) return <Navigate to="/login" replace />

  return <>{children}</>
}

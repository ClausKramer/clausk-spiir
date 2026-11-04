import { Navigate } from 'react-router-dom'
import { useMe } from '../hooks/useAuth'
import { isUnauthorized } from '../api/client'
import { BUTTON_PRIMARY, Spinner } from './ui'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { data, isLoading, isError, error, refetch, isRefetching } = useMe()

  if (isLoading) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <Spinner />
      </div>
    )
  }

  if (isError) {
    // Only a refusal means signed out. A failure to answer must not look like one, or every
    // hiccup — the database waking up after idle is the common one — sends you to the login page
    // and costs you a magic-link round trip even though your session is perfectly fine.
    if (isUnauthorized(error)) return <Navigate to="/login" replace />

    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 px-4 text-center" role="alert">
        <p className="max-w-sm text-sm text-slate-300">
          Couldn't reach the server. You're still signed in — this is usually the database waking
          up after being idle.
        </p>
        <button
          onClick={() => refetch()}
          disabled={isRefetching}
          className={BUTTON_PRIMARY}
        >
          {isRefetching ? 'Retrying…' : 'Try again'}
        </button>
      </div>
    )
  }

  if (!data) return <Navigate to="/login" replace />

  return <>{children}</>
}

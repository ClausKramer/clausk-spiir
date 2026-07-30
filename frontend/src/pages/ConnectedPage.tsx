import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { finalizeConnection } from '../api/accounts'

export function ConnectedPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const attempted = useRef(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (attempted.current) return
    attempted.current = true

    const ref = params.get('ref')
    if (!ref) {
      navigate('/accounts', { replace: true })
      return
    }

    finalizeConnection(ref)
      .then(() => navigate('/accounts', { replace: true }))
      .catch((err) => {
        const msg = err?.response?.data?.error ?? 'Failed to link accounts. Please try again.'
        setError(msg)
      })
  }, [])

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="text-center max-w-sm">
          <div className="text-4xl mb-3">⚠️</div>
          <p className="font-medium text-slate-700">Connection failed</p>
          <p className="mt-2 text-sm text-slate-500">{error}</p>
          <button
            onClick={() => navigate('/accounts')}
            className="mt-4 rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Back to accounts
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="text-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent mx-auto" />
        <p className="mt-4 text-sm text-slate-500">Linking your bank accounts…</p>
      </div>
    </div>
  )
}

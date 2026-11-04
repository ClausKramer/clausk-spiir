import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { finalizeConnection } from '../api/accounts'
import { BUTTON_PRIMARY, Spinner } from '../components/ui'

export function ConnectedPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const attempted = useRef(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (attempted.current) return
    attempted.current = true

    // Enable Banking redirects back with ?code=...&state=... — state is the reference we generated
    // when starting the authorization (see ConnectBankPage / AccountEndpoints.ConnectBank).
    const ref = params.get('state')
    const code = params.get('code')
    if (!ref || !code) {
      navigate('/accounts', { replace: true })
      return
    }

    finalizeConnection(ref, code)
      .then(() => navigate('/accounts', { replace: true }))
      .catch((err) => {
        const msg = err?.response?.data?.error ?? 'The bank connection could not be finished. Start again from Accounts.'
        setError(msg)
      })
  }, [])

  if (error) {
    return (
      <div className="mx-auto max-w-sm py-16 text-center" role="alert">
        <p className="font-medium text-slate-200">Couldn't link your bank</p>
        <p className="mt-2 text-sm text-slate-400">{error}</p>
        <button onClick={() => navigate('/accounts')} className={`${BUTTON_PRIMARY} mt-4`}>
          Back to accounts
        </button>
      </div>
    )
  }

  return (
    <div className="py-16 text-center">
      <Spinner />
      <p className="text-sm text-slate-400">Linking your bank accounts…</p>
    </div>
  )
}

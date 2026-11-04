import { useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { verifyToken } from '../api/auth'
import { Spinner } from '../components/ui'

export function VerifyPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const attempted = useRef(false)

  useEffect(() => {
    if (attempted.current) return
    attempted.current = true

    const token = params.get('token')
    if (!token) {
      navigate('/login', { replace: true })
      return
    }

    verifyToken(token)
      .then(({ accessToken }) => {
        localStorage.setItem('access_token', accessToken)
        qc.invalidateQueries({ queryKey: ['me'] })
        navigate('/dashboard', { replace: true })
      })
      .catch(() => navigate('/login?error=invalid_token', { replace: true }))
  }, [])

  return (
    <div className="flex min-h-dvh items-center justify-center">
      <div className="text-center">
        <Spinner />
        <p className="text-sm text-slate-400">Signing you in…</p>
      </div>
    </div>
  )
}

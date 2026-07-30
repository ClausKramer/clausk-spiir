import { useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { verifyToken } from '../api/auth'

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
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="text-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent mx-auto" />
        <p className="mt-4 text-sm text-slate-500">Completing sign-in…</p>
      </div>
    </div>
  )
}

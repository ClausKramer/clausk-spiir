import { useState } from 'react'
import { useRequestMagicLink } from '../hooks/useAuth'

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const { mutate, isPending, error } = useRequestMagicLink()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    mutate(email, { onSuccess: () => setSent(true) })
  }

  if (sent) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-lg text-center">
          <div className="mb-4 text-4xl">📧</div>
          <h2 className="text-xl font-semibold text-slate-800">Check your email</h2>
          <p className="mt-2 text-sm text-slate-500">
            We sent a login link to <span className="font-medium text-slate-700">{email}</span>.
            It expires in 15 minutes.
          </p>
          <button
            className="mt-6 text-sm text-indigo-600 hover:underline"
            onClick={() => setSent(false)}
          >
            Use a different email
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-lg">
        <div className="mb-6 text-center">
          <div className="mb-2 text-3xl font-bold text-indigo-600">Spiir</div>
          <p className="text-sm text-slate-500">Personal finance — sign in with your email</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-slate-700">
              Email address
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600">
              Something went wrong. Please try again.
            </p>
          )}

          <button
            type="submit"
            disabled={isPending}
            className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {isPending ? 'Sending…' : 'Send magic link'}
          </button>
        </form>
      </div>
    </div>
  )
}

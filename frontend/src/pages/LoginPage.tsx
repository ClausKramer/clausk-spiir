import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useRequestMagicLink } from '../hooks/useAuth'
import { BUTTON_PRIMARY, INPUT } from '../components/ui'

export function LoginPage() {
  const [search] = useSearchParams()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const { mutate, isPending, error } = useRequestMagicLink()
  // VerifyPage sends a link that didn't work back here. Saying nothing made it look as if the
  // click had simply landed on the login page for no reason.
  const linkFailed = search.get('error') === 'invalid_token'

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    mutate(email, { onSuccess: () => setSent(true) })
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-3xl font-bold tracking-tight text-slate-50">Spiir</div>

        {sent ? (
          <div className="rounded-xl border border-[#232b3b] bg-[#1a1f2e] p-6">
            <h1 className="text-lg font-semibold text-slate-100">Check your email</h1>
            <p className="mt-2 text-sm text-slate-400">
              We sent a sign-in link to <span className="font-medium text-slate-200">{email}</span>. It
              works once and expires in 15 minutes.
            </p>
            <button className="mt-4 text-sm text-indigo-300 hover:underline" onClick={() => setSent(false)}>
              Use a different email
            </button>
          </div>
        ) : (
          <div className="rounded-xl border border-[#232b3b] bg-[#1a1f2e] p-6">
            <h1 className="text-lg font-semibold text-slate-100">Sign in</h1>
            <p className="mt-1 text-sm text-slate-400">We'll email you a link. There's no password to remember.</p>

            {linkFailed && (
              <p className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200" role="alert">
                That sign-in link has expired or has already been used. Enter your email to get a new one.
              </p>
            )}

            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              <div>
                <label htmlFor="email" className="mb-1 block text-sm text-slate-300">
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
                  className={`${INPUT} w-full`}
                />
              </div>

              {error && (
                <p className="text-sm text-red-400" role="alert">
                  Couldn't send the link. Check your connection and try again.
                </p>
              )}

              <button type="submit" disabled={isPending} className={`${BUTTON_PRIMARY} w-full`}>
                {isPending ? 'Sending…' : 'Email me a sign-in link'}
              </button>
            </form>
          </div>
        )}

        <p className="mt-4 text-center text-xs text-slate-400">
          <Link to="/privacy" className="hover:underline">Privacy Policy</Link>
          {' · '}
          <Link to="/terms" className="hover:underline">Terms of Service</Link>
        </p>
      </div>
    </div>
  )
}

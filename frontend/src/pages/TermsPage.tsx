import { Link } from 'react-router-dom'

export function TermsPage() {
  return (
    <div className="min-h-dvh px-4 py-8">
      <div className="mx-auto max-w-2xl rounded-xl border border-[#232b3b] bg-[#1a1f2e] p-5 sm:p-8">
        <Link to="/login" className="text-sm text-indigo-300 hover:underline">← Back</Link>
        <h1 className="mt-4 text-2xl font-bold text-slate-100">Terms of Service</h1>
        <p className="mt-1 text-sm text-slate-400">Last updated 2026-08-28</p>

        <div className="mt-6 space-y-5 text-sm leading-relaxed text-slate-300">
          <p>
            Spiir is a personal project, built and operated by a single individual for their own
            personal finance tracking. It is provided as-is, with no warranty of any kind, and no
            guarantee of uptime, availability, or continued operation.
          </p>

          <section>
            <h2 className="font-semibold text-slate-100">What this app does and does not do</h2>
            <p className="mt-2">
              This app reads bank account and transaction data through Enable Banking, a regulated
              open banking provider (AISP), and stores it locally to display and categorize it. It
              does not initiate payments, move money, or have any write access to your bank account.
              It is not a financial institution, payment service, or licensed financial advisor, and
              nothing in the app constitutes financial advice.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-slate-100">Acceptable use</h2>
            <p className="mt-2">
              Intended for personal use by the operator and anyone the operator has explicitly
              invited. Bank account connection is restricted to accounts pre-authorized by the
              operator in Enable Banking's control panel — logging in does not, by itself, grant
              access to link an arbitrary bank account.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-slate-100">No warranty, no liability</h2>
            <p className="mt-2">
              The app is provided "as is." The operator makes no guarantees about accuracy of
              displayed data (e.g. automatic categorization), availability, or fitness for any
              particular purpose, and is not liable for any loss or damage arising from its use.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-slate-100">Changes</h2>
            <p className="mt-2">
              These terms may change as the app evolves. Continued use after a change constitutes
              acceptance of the updated terms.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-slate-100">Contact</h2>
            <p className="mt-2">privat@clausk.dk</p>
          </section>
        </div>
      </div>
    </div>
  )
}

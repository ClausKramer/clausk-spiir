import { Link } from 'react-router-dom'

export function PrivacyPage() {
  return (
    <div className="min-h-dvh px-4 py-8">
      <div className="mx-auto max-w-2xl rounded-xl border border-[#232b3b] bg-[#1a1f2e] p-5 sm:p-8">
        <Link to="/login" className="text-sm text-indigo-300 hover:underline">← Back</Link>
        <h1 className="mt-4 text-2xl font-bold text-slate-100">Privacy Policy</h1>
        <p className="mt-1 text-sm text-slate-400">Last updated 2026-08-28</p>

        <div className="mt-6 space-y-5 text-sm leading-relaxed text-slate-300">
          <p>
            Spiir is a personal finance tracker built and operated by a single individual for their
            own personal use. It is not a commercial service, and it is not operated by a company.
          </p>

          <section>
            <h2 className="font-semibold text-slate-100">What data is collected</h2>
            <ul className="mt-2 list-disc pl-5 space-y-1">
              <li>Your email address, used only to send you a passwordless login link.</li>
              <li>
                Bank account and transaction data (account name, IBAN, balances, transaction
                descriptions and amounts), retrieved via the Enable Banking open banking API (PSD2)
                once you explicitly connect a bank account.
              </li>
              <li>Categories you assign to transactions, and rules you create for automatic categorization.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-semibold text-slate-100">How data is used</h2>
            <p className="mt-2">
              Solely to display and categorize your own transactions within the app. Data is never
              sold, shared for advertising, or used for any purpose beyond running the app itself.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-slate-100">Third parties involved</h2>
            <ul className="mt-2 list-disc pl-5 space-y-1">
              <li><strong>Enable Banking</strong> — the regulated open banking provider used to read bank account and transaction data, with your explicit consent given directly to your bank.</li>
              <li><strong>Resend</strong> — sends the login email.</li>
              <li><strong>Anthropic (Claude API)</strong> — may be used to suggest a category for a transaction description that doesn't match an existing rule. No bank account numbers or balances are sent, only transaction description text.</li>
              <li><strong>Microsoft Azure</strong> — hosts the application and database.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-semibold text-slate-100">Bank account access</h2>
            <p className="mt-2">
              This app only reads bank accounts that have been explicitly pre-authorized by the
              operator in the Enable Banking control panel (Restricted Production mode). It cannot
              access any bank account that hasn't been deliberately linked this way, regardless of
              who logs in.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-slate-100">Data deletion</h2>
            <p className="mt-2">
              You can disconnect a bank account at any time from the Accounts page, which removes it
              and its transactions from the database. To delete your account entirely, contact the
              operator (below).
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

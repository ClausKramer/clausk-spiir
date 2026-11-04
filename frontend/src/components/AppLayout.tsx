import { useEffect } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useLogout, useMe } from '../hooks/useAuth'

const SECTIONS = [
  { to: '/dashboard', label: 'Spending', also: ['/spending', '/flow', '/view'] },
  { to: '/budgets', label: 'Budgets', also: [] },
  { to: '/recurring', label: 'Recurring', also: [] },
  { to: '/networth', label: 'Net worth', also: [] },
  { to: '/accounts', label: 'Accounts', also: [] },
]

// The frame around every signed-in page. Top links on a wide screen, tabs along the bottom on a
// phone, where a row of five buttons at the top of the page used to wrap and take a thumb's reach.
//
// A section link goes to the section's default view rather than remembering filters. The "back"
// link on each drill-down page is what carries them, since that one means "where I just was".
export function AppLayout() {
  const { pathname } = useLocation()
  const { data: user } = useMe()
  const { mutate: logout, isPending: loggingOut } = useLogout()

  const isActive = (s: (typeof SECTIONS)[number]) =>
    pathname.startsWith(s.to) || s.also.some((p) => pathname.startsWith(p))
  const current = SECTIONS.find(isActive)

  useEffect(() => {
    document.title = current ? `${current.label} – Spiir` : 'Spiir'
  }, [current])

  return (
    <div className="min-h-dvh pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-8">
      <header className="sticky top-0 z-40 border-b border-[#232b3b] bg-[#0f1117]/95 backdrop-blur">
        <div className="mx-auto flex h-13 max-w-6xl items-center gap-6 px-4 md:px-8">
          <Link to="/dashboard" className="text-lg font-bold tracking-tight text-slate-50">
            Spiir
          </Link>
          <nav className="hidden h-full items-stretch gap-1 md:flex" aria-label="Main">
            {SECTIONS.map((s) => (
              <NavLink
                key={s.to}
                to={s.to}
                className={`flex items-center border-b-2 px-3 text-sm font-medium transition-colors ${
                  isActive(s)
                    ? 'border-indigo-400 text-slate-50'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                {s.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex min-w-0 items-center gap-3">
            <span className="hidden truncate text-xs text-slate-400 lg:inline">{user?.email}</span>
            <button
              onClick={() => logout()}
              disabled={loggingOut}
              className="min-h-9 shrink-0 rounded-lg px-2 text-sm text-slate-400 hover:text-slate-200 disabled:opacity-50"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-5 md:px-8 md:py-6">
        <Outlet />
      </main>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-[#232b3b] bg-[#0f1117] pb-[env(safe-area-inset-bottom)] md:hidden"
        aria-label="Main"
      >
        {SECTIONS.map((s) => (
          <NavLink
            key={s.to}
            to={s.to}
            className={`flex h-14 items-center justify-center border-t-2 px-1 text-center text-xs font-medium ${
              isActive(s) ? 'border-indigo-400 text-slate-50' : 'border-transparent text-slate-400'
            }`}
          >
            {s.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

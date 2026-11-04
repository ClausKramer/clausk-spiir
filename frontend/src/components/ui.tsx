import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

// The pieces every page is built from. They were previously redeclared per page, which is how one
// page's labels ended up 2px smaller than the next one's.
//
// Text on these surfaces is slate-400 or lighter: slate-500 and slate-600 fall below 4.5:1 on the
// panel colour, and the smallest size used anywhere is text-xs.

export const BUTTON_PRIMARY =
  'inline-flex min-h-9 items-center justify-center rounded-lg bg-indigo-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50'
export const BUTTON_SECONDARY =
  'inline-flex min-h-9 items-center justify-center rounded-lg border border-slate-700 bg-[#1a1f2e] px-3.5 py-1.5 text-sm font-medium text-slate-200 enabled:hover:bg-[#232b3b] [a&]:hover:bg-[#232b3b] disabled:opacity-50'
export const BUTTON_SMALL =
  'inline-flex min-h-8 items-center justify-center rounded-md border border-slate-700 px-2.5 py-1 text-xs font-medium text-slate-300 enabled:hover:bg-[#232b3b] disabled:opacity-50'
export const INPUT =
  'min-h-9 rounded-lg border border-slate-700 bg-[#111620] px-2.5 py-1.5 text-sm text-slate-200 outline-none placeholder:text-slate-500 focus:border-indigo-500'

// Secondary row actions: revealed on hover where hovering exists, always visible on touch, and
// visible to a keyboard as soon as it lands on them.
export const REVEAL_ON_ROW_HOVER =
  'pointer-coarse:min-h-9 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/row:opacity-100 focus-visible:opacity-100'

export function PageHeader({
  title,
  sub,
  back,
  aside,
}: {
  title: ReactNode
  sub?: ReactNode
  back?: { to: string; label: string }
  aside?: ReactNode
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        {back && (
          <Link to={back.to} className="mb-1 inline-block text-sm text-slate-400 hover:text-slate-200">
            ← {back.label}
          </Link>
        )}
        <h1 className="text-2xl font-bold tracking-tight text-slate-50">{title}</h1>
        {sub && <p className="mt-0.5 text-sm text-slate-400">{sub}</p>}
      </div>
      {aside}
    </div>
  )
}

export function Panel({
  title,
  action,
  children,
  className = '',
}: {
  title: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`mb-4 rounded-xl border border-[#232b3b] bg-[#1a1f2e] p-4 md:p-5 ${className}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 className="text-sm font-semibold text-slate-200">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

// `to` makes the figure openable: every calculated number links to the rows behind it, so any
// total can be counted rather than taken on trust.
export function Kpi({
  label,
  value,
  valueClass = 'text-slate-100',
  sub,
  loading,
  to,
  prominent,
  wide,
  className = '',
}: {
  label: string
  value: string
  valueClass?: string
  sub?: string
  loading?: boolean
  to?: string
  /** The one figure a page leads with: spans two columns and sets larger. */
  prominent?: boolean
  /** Spans two columns at the usual size, to close a row that would otherwise end short. */
  wide?: boolean
  className?: string
}) {
  const body = (
    <>
      <div className="mb-1 text-xs text-slate-400">{label}</div>
      <div className={`${prominent ? 'text-3xl' : 'text-xl'} font-bold tabular-nums ${valueClass}`}>
        {loading ? '—' : value}
      </div>
      {sub && <div className="mt-1 text-xs text-slate-400">{sub}</div>}
    </>
  )
  const base = `block rounded-xl border border-[#232b3b] bg-[#1a1f2e] px-4 py-3 ${prominent || wide ? 'col-span-2' : ''} ${className}`

  return to ? (
    <Link
      to={to}
      className={`${base} transition-colors hover:border-slate-600 hover:bg-[#1e2433]`}
      title={`Show the transactions behind ${label.toLowerCase()}`}
    >
      {body}
    </Link>
  ) : (
    <div className={base}>{body}</div>
  )
}

export function Spinner({ large }: { large?: boolean }) {
  return (
    <div className={`flex justify-center ${large ? 'py-20' : 'py-8'}`} role="status" aria-label="Loading">
      <div className="h-7 w-7 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
    </div>
  )
}

// A failed load has its own state. Falling through to the empty state tells someone whose server
// hiccuped that they have no transactions, which on a page about their money is the worst thing
// it could say.
export function LoadError({
  what,
  hint = 'It is usually the database waking up after being idle.',
  onRetry,
  retrying,
}: {
  what: string
  hint?: string
  onRetry: () => void
  retrying?: boolean
}) {
  return (
    <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-10 text-center" role="alert">
      <p className="font-medium text-slate-200">Couldn't load {what}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-slate-400">
        The request failed, so nothing here is missing. {hint}
      </p>
      <button onClick={onRetry} disabled={retrying} className={`${BUTTON_PRIMARY} mt-4`}>
        {retrying ? 'Retrying…' : 'Try again'}
      </button>
    </div>
  )
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-2 py-10 text-center">
      <p className="font-medium text-slate-200">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-sm text-slate-400">{children}</div>}
    </div>
  )
}

export function Notice({ children, onDismiss }: { children: ReactNode; onDismiss?: () => void }) {
  return (
    <div
      className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-[#232b3b] bg-[#1a1f2e] px-4 py-2.5 text-sm text-slate-300"
      role="status"
    >
      <span>{children}</span>
      {onDismiss && (
        <button onClick={onDismiss} className="shrink-0 px-1 text-slate-400 hover:text-slate-200" aria-label="Dismiss">
          ✕
        </button>
      )}
    </div>
  )
}

// Every dialog goes through here so each gets the same behaviour: Escape and a click outside
// close it, focus moves in on opening and returns afterwards, and a screen reader is told what it
// is. On a phone it sits against the bottom edge, in reach of a thumb.
export function Modal({
  title,
  onClose,
  size = 'max-w-2xl',
  dismissable = true,
  children,
}: {
  title: ReactNode
  onClose: () => void
  size?: string
  /** False while a request is in flight, so it can't be walked away from half-finished. */
  dismissable?: boolean
  children: ReactNode
}) {
  const titleId = useId()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    // A field that asked for focus keeps it; otherwise the dialog itself takes it.
    if (!ref.current?.contains(document.activeElement)) ref.current?.focus()
    return () => previous?.focus?.()
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center sm:p-4"
      onClick={() => dismissable && onClose()}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && dismissable) {
          e.stopPropagation()
          onClose()
        }
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`flex max-h-[90dvh] w-full ${size} flex-col rounded-t-xl border border-[#232b3b] bg-[#1a1f2e] shadow-xl outline-none sm:rounded-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="px-5 pt-4 text-base font-semibold text-slate-100">
          {title}
        </h2>
        {children}
      </div>
    </div>
  )
}

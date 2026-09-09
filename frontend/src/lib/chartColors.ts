// The app's chart palette, in one place. Five files previously each redeclared these hexes,
// which is how a "same colours everywhere" property quietly stops being true.
//
// Colour here always means direction or kind — never rank. A bar's colour must follow the thing
// it represents, so re-sorting or filtering never repaints it.
//
// Validated with the dataviz checker against both dark surfaces (#1a1f2e panels, #111620 inset
// cards). Validation is per *co-occurring set*, since the checks only make sense between marks
// a reader can actually compare in one chart:
//
//   FLOW  {INCOME, EXPENSE, NET}   cash-flow chart          all-pairs: PASS
//   SPEND {EXPENSE, INCOME}        spend vs refund bars     all-pairs: PASS
//   TAG   {TAG}                    single series            contrast: PASS (3:1+)
//   KIND  the five below           committed vs discretionary  PASS
//
// TAG is deliberately not checked against NET: tags and the net line never share a chart. It
// was moved off violet-600 (#7c3aed) because that failed contrast at 2.88:1 on the panel
// surface. Re-run the checker before changing any of these:
//   node scripts/validate_palette.js "<hex,…>" --mode dark --surface "#1a1f2e" --pairs all

/** Money in. Also the positive side of any net figure. */
export const INCOME = '#059669'
/** Money out. Every spending bar in the app, so magnitude reads the same everywhere. */
export const EXPENSE = '#dc2626'
/** The net trend line — a third series against income and expenses, never a bar fill. */
export const NET = '#2563eb'
/** Tags, matching the violet chips on transaction rows. */
export const TAG = '#8b5cf6'

/** Panel background; marks that overlap need this as their gap or ring colour. */
export const SURFACE = '#1a1f2e'
/** Inset cards and bar tracks sitting inside a panel. */
export const SURFACE_INSET = '#111620'
/** The empty part of a bar track. */
export const TRACK = '#1e2535'

// Committed vs discretionary. A genuine categorical set — four kinds with no order between
// them — so these are assigned by kind and never cycled. "Unfiled" is outside the set: it is
// the absence of a kind, so it stays neutral grey rather than claiming a fifth identity.
export const KIND_FIXED = '#4f46e5'
export const KIND_VARIABLE = '#ea580c'
export const KIND_SAVINGS = '#0d9488'
export const KIND_DEBT = '#e11d48'
export const KIND_NONE = '#475569'

// "The remainder" in a two-part composition — the one-off share against the recurring one.
// Deliberately grey: it is the leftover after the thing being measured, not a second category
// competing for attention. Fails the checker's chroma floor by design (that check exists to
// catch a hue that accidentally reads grey); lightness, CVD separation ΔE 15.1, normal-vision
// ΔE 24.4 and contrast against both surfaces all pass beside EXPENSE.
export const NEUTRAL = '#64748b'

/** Spending bars are red, refunds green: the direction is the point, and a lighter red would
 *  read as "less spending" rather than "money back". */
export const forAmount = (value: number) => (value < 0 ? INCOME : EXPENSE)

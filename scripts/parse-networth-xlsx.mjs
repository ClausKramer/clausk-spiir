#!/usr/bin/env node
// Turns a "Networth" workbook into the JSON the /networth/import endpoint accepts.
//
//   node scripts/parse-networth-xlsx.mjs <file.xlsx> [--out networth.json] [--through 2026-09]
//
// The workbook's shape, which this relies on:
//   row 1            month headers in B..M (Jan..Dec)
//   institution rows a label with no monthly figures (Nordea, Danske Bank, …)
//   account rows     a label plus monthly figures, belonging to the institution above
//   "Total"          the first row of the summary block; nothing after it is an account
//
// Two things the sheet encodes that have to survive the import:
//
// * Sign is meaning, not formatting. A negative figure on a current account is an overdraft —
//   money owed — and a positive one on the same account is money held. Only rows that are
//   always-a-debt (loans, cards) are classified as liabilities; everything else keeps its sign.
//
// * A formula cell is the sheet carrying the last typed figure forward. That is still the
//   user's assertion about that month, so it is imported — but only for months that have
//   actually happened. A projection into the future is not a record of anything.

import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const file = process.argv[2]
if (!file) {
  console.error('usage: parse-networth-xlsx.mjs <file.xlsx> [--out out.json] [--through YYYY-MM]')
  process.exit(1)
}
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`)
  return i > -1 ? process.argv[i + 1] : d
}
const OUT = arg('out', 'networth-import.json')
const now = new Date()
const [THROUGH_Y, THROUGH_M] = arg('through', `${now.getFullYear()}-${now.getMonth() + 1}`)
  .split('-')
  .map(Number)

const dir = mkdtempSync(join(tmpdir(), 'nw-'))
execSync(`unzip -o -q "${file}" -d "${dir}"`)
const read = (p) => readFileSync(join(dir, p), 'utf8')

const decode = (s) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

const shared = [...read('xl/sharedStrings.xml').split('<si>').slice(1)].map((si) =>
  [...si.split('</si>')[0].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''),
)

const rels = new Map(
  [...read('xl/_rels/workbook.xml.rels').matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map((m) => [
    m[1],
    m[2].replace(/^\/?xl\//, ''),
  ]),
)
const sheets = new Map(
  [...read('xl/workbook.xml').matchAll(/<sheet name="([^"]+)"[^>]*r:id="([^"]+)"/g)].map((m) => [
    decode(m[1]),
    rels.get(m[2]),
  ]),
)

function grid(sheetFile) {
  const xml = read(`xl/${sheetFile}`)
  const rows = {}
  for (const m of xml.matchAll(/<c ([^>]*?)\/>|<c ([^>]*?)>([\s\S]*?)<\/c>/g)) {
    const attrs = m[1] ?? m[2]
    const inner = m[3] ?? ''
    const ref = attrs.match(/r="([A-Z]+\d+)"/)?.[1]
    if (!ref) continue
    const type = attrs.match(/t="([^"]+)"/)?.[1]
    let v
    if (type === 's') v = shared[Number(inner.match(/<v>(\d+)<\/v>/)?.[1])] ?? ''
    else {
      const raw = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1]
      if (raw === undefined) continue
      v = Number(raw)
      if (Number.isNaN(v)) v = raw // an error value like #REF!
    }
    if (typeof v === 'string') v = decode(v).trim()
    if (v === '') continue
    const r = Number(ref.match(/\d+$/)[0])
    ;(rows[r] ??= {})[ref.match(/^[A-Z]+/)[0]] = { v, formula: inner.includes('<f') }
  }
  return rows
}

const MONTH_COLS = ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M']
const INSTITUTIONS = /^(nordea|danske bank|vestjysk bank|nordnet|jyske bank|sydbank|lunar|saxo)/i

// Header rows. The older sheets put Excel date serials in the header's month cells, so they
// look exactly like an account row with twelve figures unless named explicitly.
const HEADER = /^(kontonavn|konti[\/].*|konto)$/i

// Everything from the sheet's own grand total down is arithmetic, not an account. Later sheets
// call it "Total"; the 2004–2008 ones call it "I alt".
const SUMMARY_START = /^(total|i alt)$/i

// Subtotal rows that sit *among* the accounts rather than in the summary block. Importing one
// would double everything under it — these are the sheet adding up, not something owned.
const SUBTOTAL = /^(i alt\b.*|.*\bi alt\b.*|samlet\b.*|potentiale|total\b.*)$/i

// The name says what a row is called; the data says which side of the balance it is on.
//
// Name alone isn't enough. A Nordea "Prioritet" is a prioritetskonto — a flexible facility that
// reads like a mortgage but can hold a positive balance, and in this workbook it does. Filing it
// as a liability would flip 75.264 kr of savings into 75.264 kr of debt, a 150.528 kr error in
// the wrong direction. So a liability kind is only accepted for a row that is never positive
// across its whole history; anything that goes into credit is an asset that can be overdrawn.
function kindFor(name, values) {
  const n = name.toLowerCase()
  const everPositive = values.some((v) => v > 0)

  if (!everPositive) {
    if (/boliglån|realkredit|prioritet/.test(n)) return 'Mortgage'
    if (/lån|loan/.test(n)) return 'Loan'
    if (/mastercard|kreditkort|visa|credit|amex|american express/.test(n)) return 'Credit'
  }
  if (/depot|aktie|portefølje|nordnet|bjerget|invest/.test(n)) return 'Investment'
  if (/opsparing|buffer|savings/.test(n)) return 'Savings'
  if (/pension/.test(n)) return 'Pension'
  return 'Cash'
}

const accounts = new Map() // key -> { name, kind }
const snapshots = [] // { account, year, month, value, carried }
const sheetTotals = [] // the workbook's own "Total" row, for reconciliation

for (const [name, sheetFile] of sheets) {
  if (!/^\d{4}$/.test(name) || !sheetFile?.startsWith('worksheets/')) continue
  const year = Number(name)
  const g = grid(sheetFile)
  const rowNums = Object.keys(g).map(Number).sort((a, b) => a - b)

  let institution = ''
  let inSummary = false

  for (const r of rowNums) {
    const label = typeof g[r].A?.v === 'string' ? g[r].A.v : ''
    const monthCells = MONTH_COLS.map((c) => g[r][c])
    const hasNumbers = monthCells.some((c) => c && typeof c.v === 'number')

    if (SUMMARY_START.test(label)) {
      inSummary = true
      // Keep the sheet's own total per month so the import can be checked against it.
      monthCells.forEach((cell, i) => {
        if (cell && typeof cell.v === 'number') sheetTotals.push({ year, month: i + 1, total: cell.v })
      })
      continue
    }
    if (inSummary) continue
    if (!label) continue
    if (HEADER.test(label)) continue

    // An institution row is a header even when it carries a stray figure: the workbook keeps
    // the odd note there, and counting it as an account offsets every month by that amount.
    if (INSTITUTIONS.test(label)) {
      institution = label
      continue
    }
    if (SUBTOTAL.test(label)) continue
    if (!hasNumbers) continue

    // Qualified by institution: "Budget" exists under two different banks, and merging them
    // would silently add two unrelated accounts together.
    const key = institution ? `${institution} · ${label}` : label
    if (!accounts.has(key)) accounts.set(key, { name: key, label, values: [] })

    monthCells.forEach((cell, i) => {
      if (!cell || typeof cell.v !== 'number') return
      const month = i + 1
      // Future months are the sheet's forecast, not a record of anything that happened.
      if (year * 100 + month > THROUGH_Y * 100 + THROUGH_M) return
      accounts.get(key).values.push(cell.v)
      snapshots.push({ account: key, year, month, value: cell.v, carried: cell.formula })
    })
  }
}

// Classification happens once every row's full history is known, so a single month in credit
// is enough to keep an account off the liability side.
const payload = {
  accounts: [...accounts.values()]
    .map((a) => ({ name: a.name, kind: kindFor(a.label, a.values) }))
    .sort((a, b) => a.name.localeCompare(b.name)),
  snapshots,
}
writeFileSync(OUT, JSON.stringify(payload, null, 2), 'utf8')

// --- report -------------------------------------------------------------------------------
const years = [...new Set(snapshots.map((s) => s.year))].sort()
const typed = snapshots.filter((s) => !s.carried).length
console.log(`Accounts   ${payload.accounts.length}`)
for (const a of payload.accounts) console.log(`  ${a.kind.padEnd(11)} ${a.name}`)
console.log(`\nSnapshots  ${snapshots.length} across ${years.length} years (${years[0]}–${years.at(-1)})`)
console.log(`           ${typed} typed, ${snapshots.length - typed} carried forward`)

// Reconciliation: our per-month net against the workbook's own Total row.
console.log('\nAgainst the sheet\'s own "Total" row:')
const byMonth = new Map()
for (const s of snapshots) {
  const k = `${s.year}-${String(s.month).padStart(2, '0')}`
  byMonth.set(k, (byMonth.get(k) ?? 0) + s.value)
}
let checked = 0
let mismatched = 0
for (const t of sheetTotals) {
  const k = `${t.year}-${String(t.month).padStart(2, '0')}`
  if (!byMonth.has(k)) continue
  checked++
  const diff = byMonth.get(k) - t.total
  if (Math.abs(diff) > 1) {
    mismatched++
    if (mismatched <= 8) console.log(`  DIFF ${k}: ours ${Math.round(byMonth.get(k))} vs sheet ${Math.round(t.total)} (${Math.round(diff)})`)
  }
}
console.log(`  ${checked - mismatched}/${checked} months match the sheet exactly`)
console.log(`\nWrote ${OUT}`)

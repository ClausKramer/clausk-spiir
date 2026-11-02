#!/usr/bin/env node
// Checks that a budget's "actual" and its typical-month baseline both agree with the drill-downs
// behind them, and that setting a limit behaves like every other user-entered figure in the app:
// a correction replaces rather than doubling, and a blank value clears it rather than leaving a
// stale number behind.
//
//   node scripts/verify-budgets.mjs [--api http://localhost:5218] [--email dev@test.local]

import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : fallback
}

const API = arg('api', 'http://localhost:5218')
const EMAIL = arg('email', 'dev@test.local')
const BODY = join(tmpdir(), 'spiir-budgets-body.json')

const sh = (cmd) => execSync(cmd, { maxBuffer: 1e8 }).toString()

sh(`curl -s -X POST ${API}/auth/request-link -H "Content-Type: application/json" -d "{\\"email\\":\\"${EMAIL}\\"}"`)
const token = sh(`curl -s ${API}/dev/last-magic-link`).match(/token=([^"&\s]+)/)?.[1]
if (!token) throw new Error('No magic link — is the API running in Development?')
const jwt = JSON.parse(
  sh(`curl -s -X POST ${API}/auth/verify -H "Content-Type: application/json" -d "{\\"token\\":\\"${token}\\"}"`),
).accessToken

const get = (p) => JSON.parse(sh(`curl -s -H "Authorization: Bearer ${jwt}" "${API}${p}"`))
// Written to a file rather than inlined: shell quoting mangles JSON on Windows, and a silently
// empty body makes a passing test that proves nothing.
const put = (p, body) => {
  writeFileSync(BODY, JSON.stringify(body), 'utf8')
  sh(`curl -s -X PUT -H "Authorization: Bearer ${jwt}" -H "Content-Type: application/json" --data-binary @${BODY} "${API}${p}"`)
}

let pass = 0
const failures = []
const check = (name, cond, detail = '') => {
  cond ? pass++ : failures.push(name)
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}
const near = (a, b) => Math.abs(a - b) < 0.01

const today = new Date()
const year = today.getFullYear()
const month = today.getMonth() + 1
const dashboard = () => get(`/budgets/dashboard?year=${year}&month=${month}`)

// Mirrors BudgetEndpoints.BaselineMonths / UnusualMultiplier. Duplicated on purpose: if the
// endpoint's constants drift, this should fail rather than quietly follow them.
const BASELINE_MONTHS = 12
const UNUSUAL_MULTIPLIER = 1.5

const dash = dashboard()
if (dash.groups.length === 0) {
  console.log('No category groups — nothing to check. Seed default categories first.')
  process.exit(0)
}

console.log('Actual reconciles with its own drill-down')
// Every group's actual, not just budgeted ones — this is the exact class of bug that broke the
// category and cash-flow bars before: an aggregation and its drill-down computed independently,
// silently drifting apart.
for (const g of dash.groups) {
  const q = get(`/transactions/query?categoryId=${g.categoryId}&year=${year}&month=${month}&direction=expense`)
  check(`${g.categoryName}: actual matches /transactions/query`, near(g.actual, q.outflow), `${g.actual} vs ${q.outflow}`)
}
check('totalActual sums the groups', near(dash.totalActual, dash.groups.reduce((s, g) => s + g.actual, 0)))
check(
  'totalLimit sums only budgeted groups',
  near(dash.totalLimit, dash.groups.filter((g) => g.limit !== null).reduce((s, g) => s + g.limit, 0)),
)

console.log('Typical month reconciles with twelve single-month drill-downs')
// Recomputed from scratch: for each of the twelve months before this one, a month counts only if
// it has any settled transactions at all (otherwise it's missing data, not a month of zero
// spend), then each group's spend in it is read from the same drill-down the page links to.
const priorMonths = []
for (let i = 1; i <= BASELINE_MONTHS; i++) {
  const d = new Date(year, month - 1 - i, 1)
  const y = d.getFullYear()
  const m = d.getMonth() + 1
  const any = get(`/transactions/query?year=${y}&month=${m}`)
  if (any.count > 0) priorMonths.push({ y, m })
}
check('some history exists to average over', priorMonths.length > 0, `${priorMonths.length} month(s) with data`)

const expectedAverage = {}
for (const g of dash.groups) {
  let sum = 0
  for (const { y, m } of priorMonths) {
    sum += get(`/transactions/query?categoryId=${g.categoryId}&year=${y}&month=${m}&direction=expense`).outflow
  }
  expectedAverage[g.categoryId] = priorMonths.length === 0 ? null : sum / priorMonths.length
}
for (const g of dash.groups) {
  const want = expectedAverage[g.categoryId]
  const ok = want === null ? g.average === null : g.average !== null && near(g.average, want)
  check(`${g.categoryName}: typical month matches`, ok, `${g.average} vs ${want}`)
}
check(
  'totalAverage sums the groups',
  near(dash.totalAverage, dash.groups.reduce((s, g) => s + (g.average ?? 0), 0)),
)

console.log('Unusual flag')
for (const g of dash.groups) {
  const want = g.average !== null && g.average > 0 && g.actual > g.average * UNUSUAL_MULTIPLIER
  check(`${g.categoryName}: flag agrees with actual vs typical`, g.unusual === want, `actual ${g.actual}, typical ${g.average}`)
}
check(
  'a group with no baseline is never called unusual',
  dash.groups.filter((g) => !g.average).every((g) => g.unusual === false),
)

console.log('Setting a limit')
const target = dash.groups[0]
const original = target.limit

put(`/budgets/${target.categoryId}`, { limitAmount: 4321 })
let after = dashboard()
let row = after.groups.find((g) => g.categoryId === target.categoryId)
check('a new limit is accepted', near(row.limit, 4321))
check('remaining = limit − actual', near(row.remaining, row.limit - row.actual))
check('setting a limit leaves the typical month alone', row.average === target.average || near(row.average, target.average))

put(`/budgets/${target.categoryId}`, { limitAmount: 8765 })
after = dashboard()
row = after.groups.find((g) => g.categoryId === target.categoryId)
check('re-setting replaces rather than stacking', near(row.limit, 8765))

put(`/budgets/${target.categoryId}`, { limitAmount: null })
after = dashboard()
row = after.groups.find((g) => g.categoryId === target.categoryId)
check('a null value clears the limit', row.limit === null)
check('remaining is null once there is no limit', row.remaining === null)

// Restored regardless of what the checks above found, so a real budget the user had set doesn't
// get left cleared by a verification run.
if (original !== null) put(`/budgets/${target.categoryId}`, { limitAmount: original })
after = dashboard()
row = after.groups.find((g) => g.categoryId === target.categoryId)
check('original limit restored', original === null ? row.limit === null : near(row.limit, original))

console.log(`\n${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)

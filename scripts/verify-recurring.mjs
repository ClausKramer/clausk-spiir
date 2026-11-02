#!/usr/bin/env node
// Sanity-checks detected recurring series against the underlying transactions, and that
// dismissing/undismissing a series round-trips.
//
//   node scripts/verify-recurring.mjs [--api http://localhost:5218] [--email dev@test.local]

import { execSync } from 'node:child_process'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : fallback
}

const API = arg('api', 'http://localhost:5218')
const EMAIL = arg('email', 'dev@test.local')

const sh = (cmd) => execSync(cmd, { maxBuffer: 1e8 }).toString()

sh(`curl -s -X POST ${API}/auth/request-link -H "Content-Type: application/json" -d "{\\"email\\":\\"${EMAIL}\\"}"`)
const token = sh(`curl -s ${API}/dev/last-magic-link`).match(/token=([^"&\s]+)/)?.[1]
if (!token) throw new Error('No magic link — is the API running in Development?')
const jwt = JSON.parse(
  sh(`curl -s -X POST ${API}/auth/verify -H "Content-Type: application/json" -d "{\\"token\\":\\"${token}\\"}"`),
).accessToken

const get = (p) => JSON.parse(sh(`curl -s -H "Authorization: Bearer ${jwt}" "${API}${p}"`))
const post = (p) => sh(`curl -s -X POST -H "Authorization: Bearer ${jwt}" "${API}${p}"`)

let pass = 0
const failures = []
const check = (name, cond, detail = '') => {
  cond ? pass++ : failures.push(name)
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}
const near = (a, b) => Math.abs(a - b) < 0.01

const result = get('/recurring')
if (result.count === 0) {
  console.log('No recurring charges detected — nothing to check against real data.')
  process.exit(0)
}

console.log('Detected series agree with the underlying transactions')
check('totalMonthlyEquivalent sums the series', near(result.totalMonthlyEquivalent, result.series.reduce((s, x) => s + x.monthlyEquivalentCost, 0)))

// Merchant identity has to be the same notion /transactions/query already filters by — if
// detection grouped on something else, this drill-down would come back empty even though the
// series is real, which is exactly the kind of aggregation/drill-down drift this app has broken
// on before.
for (const s of result.series.slice(0, 10)) {
  const last = new Date(s.lastSeen)
  const q = get(
    `/transactions/query?merchant=${encodeURIComponent(s.merchantKey)}&year=${last.getFullYear()}&month=${last.getMonth() + 1}&direction=expense`,
  )
  const matchesLastAmount = q.items.some((t) => near(Math.abs(t.amount), s.lastAmount))
  check(`${s.displayName}: last charge appears in its own drill-down`, matchesLastAmount, `looked for ${s.lastAmount} in ${q.items.length} row(s)`)
}

console.log('Dismiss / undismiss round-trip')
const target = result.series[0]
post(`/recurring/${encodeURIComponent(target.merchantKey)}/dismiss`)
let after = get('/recurring')
check('a dismissed series disappears from the list', !after.series.some((s) => s.merchantKey === target.merchantKey))
check('it shows up as dismissed', get('/recurring/dismissed').some((d) => d.merchantKey === target.merchantKey))

post(`/recurring/${encodeURIComponent(target.merchantKey)}/undismiss`)
after = get('/recurring')
check('undismissing brings it back', after.series.some((s) => s.merchantKey === target.merchantKey))

console.log(`\n${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)

#!/usr/bin/env node
// Checks the net worth figures add up and that recording a month behaves.
//
// Net worth is entered by hand and kept forever, so the write path matters more than usual:
// a correction that appends instead of replacing would double a month permanently, and a
// cleared value that leaves a stale figure behind would silently assert something untrue.
//
//   node scripts/verify-networth.mjs [--api http://localhost:5218] [--email dev@test.local] [--year 2026]

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
const YEAR = Number(arg('year', String(new Date().getFullYear())))
const BODY = join(tmpdir(), 'spiir-networth-body.json')

const sh = (cmd) => execSync(cmd, { maxBuffer: 1e8 }).toString()

sh(`curl -s -X POST ${API}/auth/request-link -H "Content-Type: application/json" -d "{\\"email\\":\\"${EMAIL}\\"}"`)
const token = sh(`curl -s ${API}/dev/last-magic-link`).match(/token=([^"&\s]+)/)?.[1]
if (!token) throw new Error('No magic link — is the API running in Development?')
const jwt = JSON.parse(
  sh(`curl -s -X POST ${API}/auth/verify -H "Content-Type: application/json" -d "{\\"token\\":\\"${token}\\"}"`),
).accessToken

const get = (p) => JSON.parse(sh(`curl -s -H "Authorization: Bearer ${jwt}" "${API}${p}"`))
const post = (p, body) => {
  // Written to a file rather than inlined: shell quoting mangles JSON on Windows, and a
  // silently-empty body makes a passing test that proves nothing.
  writeFileSync(BODY, JSON.stringify(body), 'utf8')
  return JSON.parse(
    sh(`curl -s -X POST -H "Authorization: Bearer ${jwt}" -H "Content-Type: application/json" --data-binary @${BODY} "${API}${p}"`),
  )
}

let pass = 0
const failures = []
const check = (name, cond, detail = '') => {
  cond ? pass++ : failures.push(name)
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}
const near = (a, b) => Math.abs(a - b) < 0.01

const dash = get(`/networth/dashboard?year=${YEAR}`)
if (!dash.hasAnyRecords) {
  console.log('No net worth records — nothing to check. Add accounts and record a month first.')
  process.exit(0)
}

console.log('Sign convention')
// Values are stored exactly as entered, for every kind of account. The own/owe split is by
// sign, not by classification, so an overdrawn current account counts against you the way it
// really does rather than being filed as an asset because of what it is called.
const life0 = get('/networth/dashboard?scope=lifetime')
check('liabilities are stored negative', life0.byKind.filter((k) => k.isLiability).every((k) => k.value < 0))
check('own and owe are reported as positive magnitudes', life0.series.every((s) => s.assets >= 0 && s.liabilities >= 0))
check('by-kind sums to net', near(life0.byKind.reduce((s, k) => s + k.value, 0), life0.latest.net))
check('by-account sums to net', near(life0.byAccount.reduce((s, a) => s + a.value, 0), life0.latest.net))

console.log('Series')
check('net = own − owe in every month', dash.series.every((s) => near(s.net, s.assets - s.liabilities)))
check('months are in chronological order', dash.series.every((s, i, a) => i === 0 || s.year * 100 + s.month > a[i - 1].year * 100 + a[i - 1].month))

const latest = dash.latest
console.log('Totals reconcile')
// Split by sign, matching the dashboard: what you own is what is in credit this month, not
// everything that happens to be classified as an asset.
const positives = dash.byAccount.filter((a) => a.value > 0).reduce((s, a) => s + a.value, 0)
const negatives = -dash.byAccount.filter((a) => a.value < 0).reduce((s, a) => s + a.value, 0)
check('accounts in credit sum to the latest "own"', near(positives, latest.assets))
check('accounts in debit sum to the latest "owe"', near(negatives, latest.liabilities))
check('by-account sums to net for the period view', near(dash.byAccount.reduce((s, a) => s + a.value, 0), latest.net))
check('change in period = latest − first', near(latest.changeInPeriod ?? 0, dash.series.at(-1).net - dash.series[0].net))
check('change last month = latest − previous', dash.series.length < 2 || near(latest.changeLastMonth, dash.series.at(-1).net - dash.series.at(-2).net))

console.log('Lifetime')
const life = get('/networth/dashboard?scope=lifetime')
check('lifetime reports no single year', life.year === null && life.scope === 'lifetime')
check('lifetime covers at least the year view', life.series.length >= dash.series.length, `${life.series.length} >= ${dash.series.length}`)

console.log('Recording a month')
const target = dash.series.at(-1)
const account = dash.byAccount[0]
const originally = account.value

let r = post('/networth/entry', { year: target.year, month: target.month, values: [{ accountId: account.accountId, value: 999 }] })
check('a correction is accepted', r.saved === 1, r.message)
let after = get(`/networth/dashboard?year=${YEAR}`)
const expected = account.isLiability ? target.liabilities - originally + 999 : target.assets - originally + 999
check(
  'correcting replaces rather than appending',
  near(account.isLiability ? after.series.at(-1).liabilities : after.series.at(-1).assets, expected),
)
check('no extra month appears', after.series.length === dash.series.length)

r = post('/networth/entry', { year: target.year, month: target.month, values: [{ accountId: account.accountId, value: null }] })
check('a blank value clears the figure', r.cleared === 1, r.message)
check('and the month becomes due again', get('/networth/due').missingCount >= 1)

post('/networth/entry', { year: target.year, month: target.month, values: [{ accountId: account.accountId, value: originally }] })
after = get(`/networth/dashboard?year=${YEAR}`)
check('restoring returns the original total', near(after.series.at(-1).net, target.net))

console.log('Entry form')
const form = get(`/networth/entry?year=${target.year}&month=${target.month}`)
check('the recorded month comes back with its values', form.items.some((i) => i.value !== null))
const next = target.month === 12 ? { y: target.year + 1, m: 1 } : { y: target.year, m: target.month + 1 }
const blank = get(`/networth/entry?year=${next.y}&month=${next.m}`)
check('an unrecorded month starts empty', blank.items.every((i) => i.value === null))
check('but is prefilled from the last known figure', blank.items.every((i) => i.previousValue !== null))

console.log(`\n${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)

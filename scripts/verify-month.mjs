#!/usr/bin/env node
// Checks the month outlook against the rows behind it. The outlook is a second aggregation of
// the same transactions the dashboard sums, which is exactly how drill-downs have drifted
// before, so every figure that has rows to open is compared to those rows, and the "typical
// month" baseline is recomputed from scratch rather than trusted.
//
//   node scripts/verify-month.mjs [--api http://localhost:5218] [--email dev@test.local]

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

let pass = 0
const failures = []
const check = (name, cond, detail = '') => {
  cond ? pass++ : failures.push(name)
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}
const near = (a, b) => Math.abs(a - b) < 0.01
const sum = (xs) => xs.reduce((s, x) => s + x, 0)

// Mirrors MonthEndpoints.BaselineMonths. Duplicated on purpose: if the endpoint's constant
// drifts, this should fail rather than quietly follow it.
const BASELINE_MONTHS = 12

const today = new Date()
const monthsToCheck = [0, 1].map((back) => {
  const d = new Date(today.getFullYear(), today.getMonth() - back, 1)
  return { y: d.getFullYear(), m: d.getMonth() + 1, back }
})

const recurring = get('/recurring')

for (const { y, m, back } of monthsToCheck) {
  console.log(`\n${y}-${String(m).padStart(2, '0')} (${back === 0 ? 'current month' : 'finished month'})`)
  const o = get(`/month/outlook?year=${y}&month=${m}`)
  const q = (extra) => get(`/transactions/query?year=${y}&month=${m}&${extra}`)

  console.log('Figures reconcile with their rows')
  check('spent so far = all spending', near(o.spentSoFar, q('direction=expense').outflow))
  const bills = q('direction=expense&recurring=only').outflow
  const everyday = q('direction=expense&recurring=excluded').outflow
  check('bills paid = the recurring rows', near(o.billsPaid, bills), `${o.billsPaid} vs ${bills}`)
  check('everyday = the non-recurring rows', near(o.everydaySoFar, everyday), `${o.everydaySoFar} vs ${everyday}`)
  check('bills + everyday = spent', near(bills + everyday, o.spentSoFar))
  check('income so far = all income', near(o.incomeSoFar, q('direction=income').inflow))

  console.log('Running total')
  check('one point per elapsed day', o.cumulative.length === o.elapsedDays, `${o.cumulative.length} vs ${o.elapsedDays}`)
  check('never goes down', o.cumulative.every((v, i, a) => i === 0 || v >= a[i - 1]))
  check('ends at spent so far', o.cumulative.length === 0 || near(o.cumulative.at(-1), o.spentSoFar))

  console.log('Typical month recomputed from twelve single-month dashboards')
  const prior = []
  const priorMeta = []
  for (let i = 1; i <= BASELINE_MONTHS; i++) {
    const d = new Date(y, m - 1 - i, 1)
    const py = d.getFullYear()
    const pm = d.getMonth() + 1
    // A month counts only if it has any settled rows at all — missing data is not a zero month.
    if (get(`/transactions/query?year=${py}&month=${pm}`).count === 0) continue
    const dash = get(`/transactions/dashboard?year=${py}&month=${pm}`)
    const daily = Array(32).fill(0)
    for (const x of dash.dailySpending) daily[x.day] = x.amount
    prior.push(daily)
    priorMeta.push({ y: py, m: pm, kinds: dash.spendingByKind, total: sum(daily) })
  }
  check('baseline uses the months that have data', o.baselineMonths === prior.length, `${o.baselineMonths} vs ${prior.length}`)

  if (prior.length === 0) {
    check('no history means no baseline', o.hasBaseline === false && o.typical === null)
  } else {
    const throughDay = (daily, n) => sum(daily.slice(1, Math.min(31, n) + 1))
    const avg = (f) => sum(prior.map(f)) / prior.length
    // "Typical" is the middle month, so a single one-off month can't drag it. Recomputed here
    // independently: sort, take the middle (or the mean of the two middle values).
    const median = (f) => {
      const v = prior.map(f).sort((a, b) => a - b)
      const mid = Math.floor(v.length / 2)
      return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2
    }
    check('typical month spend is the middle month', near(o.typical.monthSpend, median((d) => throughDay(d, 31))))
    check('the average is kept alongside it', near(o.typical.averageMonthSpend, avg((d) => throughDay(d, 31))))
    check('typical spend by this day', near(o.typical.spendByNow, median((d) => throughDay(d, o.elapsedDays))))
    const everyPoint = o.typical.cumulative.every((v, i) => near(v, median((d) => throughDay(d, i + 1))))
    check('typical running total, every day', everyPoint && o.typical.cumulative.length === o.daysInMonth)
    check('typical running total never goes down', o.typical.cumulative.every((v, i, a) => i === 0 || v >= a[i - 1] - 0.01))

    // The breakdown exists so a typical month that looks wrong can be checked rather than argued
    // with, so it must itself be right: each listed month against that month's own dashboard.
    const months = o.typical.months
    check('the months behind the average are listed', months.length === o.baselineMonths, `${months.length}`)
    check(
      'each listed month matches its own dashboard',
      priorMeta.every((p) => months.some((x) => x.year === p.y && x.month === p.m && near(x.spend, p.total))),
    )
    check('the average is the mean of those months', near(o.typical.averageMonthSpend, sum(months.map((x) => x.spend)) / months.length))
    const sortedSpend = months.map((x) => x.spend).sort((a, b) => a - b)
    const midIdx = Math.floor(sortedSpend.length / 2)
    const middle = sortedSpend.length % 2 ? sortedSpend[midIdx] : (sortedSpend[midIdx - 1] + sortedSpend[midIdx]) / 2
    check('the typical month is the middle of those months', near(o.typical.monthSpend, middle))

    const k = o.typical.byKind
    for (const key of ['fixed', 'variable', 'savings', 'debt', 'uncategorized']) {
      const want = sum(priorMeta.map((p) => p.kinds[key])) / priorMeta.length
      check(`typical ${key} matches the dashboard's split`, near(k[key], want), `${k[key]} vs ${want}`)
    }
    check('the kinds add up to the average month', near(sum(Object.values(k)), o.typical.averageMonthSpend))
  }

  console.log('Bills still to come')
  if (o.isFinished) {
    check('a finished month has nothing left to come', o.stillToCome.items.length === 0 && o.stillToCome.total === 0)
    check('and its end is simply what was spent', near(o.expectedMonthEnd, o.spentSoFar))
  } else {
    const items = o.stillToCome.items
    check('total is the sum of the items', near(o.stillToCome.total, sum(items.map((i) => i.amount))))
    const known = new Map(recurring.series.map((s) => [s.merchantKey, s]))
    check(
      'every item is a bill the recurring page lists, at its last amount',
      items.every((i) => known.has(i.merchantKey) && near(known.get(i.merchantKey).lastAmount, i.amount)),
    )
    const inMonth = (d) => d.startsWith(`${y}-${String(m).padStart(2, '0')}`)
    check('every expected date falls in this month', items.every((i) => inMonth(i.expectedDate)))
    check(
      'a bill already paid this month is not expected again',
      items.every((i) => known.get(i.merchantKey).lastSeen < `${y}-${String(m).padStart(2, '0')}-01`),
    )
    if (o.hasBaseline) {
      check(
        'expected month end = spent + bills due + usual everyday spending for the days left',
        near(o.expectedMonthEnd, o.spentSoFar + o.stillToCome.total + o.typical.everydayRemaining),
      )
    } else {
      check('without a baseline there is no estimate', o.expectedMonthEnd === null)
    }
  }
}

console.log('\nAccount filter')
const accounts = get('/accounts')
if (accounts.length > 1) {
  const one = accounts[0].id
  const { y, m } = monthsToCheck[1]
  const o = get(`/month/outlook?year=${y}&month=${m}&accountIds=${one}`)
  const q = get(`/transactions/query?year=${y}&month=${m}&direction=expense&accountIds=${one}`)
  check('the outlook honours the account filter', near(o.spentSoFar, q.outflow), `${o.spentSoFar} vs ${q.outflow}`)
} else {
  console.log('  (only one account — nothing to filter)')
}

console.log(`\n${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)

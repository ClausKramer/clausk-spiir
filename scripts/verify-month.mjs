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

console.log('\nA single account')
const accounts = get('/accounts')
if (accounts.length > 1) {
  // The most recent finished month that actually has transactions: against an empty month every
  // one of these comparisons is 0 = 0 and proves nothing.
  // Preferably one with transfers between the accounts — that is the case this section is about —
  // otherwise the most recent with any data.
  const pick = (needsTransfers) => {
    for (let back = 1; back <= 12; back++) {
      const d = new Date(today.getFullYear(), today.getMonth() - back, 1)
      const c = { y: d.getFullYear(), m: d.getMonth() + 1 }
      const scope = needsTransfers ? '&scope=transfers' : ''
      if (get(`/transactions/query?year=${c.y}&month=${c.m}${scope}`).count > 0) return c
    }
    return null
  }
  const withTransfers = pick(true)
  const found = withTransfers ?? pick(false)
  const { y, m } = found ?? monthsToCheck[1]
  console.log(
    `  (using ${y}-${String(m).padStart(2, '0')}` +
      (withTransfers ? ', which has transfers between accounts)' : found ? ' — no month with transfers, so the transfer case is not exercised)' : ' — no data found, so these are vacuous)'),
  )
  for (const a of accounts) {
    const o = get(`/month/outlook?year=${y}&month=${m}&accountIds=${a.id}`)
    const q = get(`/transactions/query?year=${y}&month=${m}&direction=expense&accountIds=${a.id}`)
    check(`${a.name}: the outlook honours the account filter`, near(o.spentSoFar, q.outflow), `${o.spentSoFar} vs ${q.outflow}`)

    // Looking at one account, a transfer to or from another is real money in or out of it: a
    // budget account fed by a transfer on payday has income, not none. So with one account
    // selected nothing nets out, and its income and spending are simply the sum of its own
    // settled rows — read here from the account's own transaction list, a path that knows
    // nothing about transfers, so this cannot agree with the outlook by sharing its mistake.
    const rows = get(
      `/transactions?accountIds=${a.id}&year=${y}&month=${m}&page=1&pageSize=200&includeFuture=false`,
    ).items
    const ownIncome = sum(rows.filter((t) => t.amount > 0).map((t) => t.amount))
    const ownSpend = sum(rows.filter((t) => t.amount < 0).map((t) => -t.amount))
    check(`${a.name}: income is everything that came in`, near(o.incomeSoFar, ownIncome), `${o.incomeSoFar} vs ${ownIncome}`)
    check(`${a.name}: spending is everything that went out`, near(o.spentSoFar, ownSpend), `${o.spentSoFar} vs ${ownSpend}`)
  }

  // And across every account the same transfers do net out, so a transfer can't be both income
  // for the account that received it and spending for the one that sent it in the same total.
  const all = get(`/month/outlook?year=${y}&month=${m}`)
  const parts = accounts.map((a) => get(`/month/outlook?year=${y}&month=${m}&accountIds=${a.id}`))
  const sumIncome = sum(parts.map((p) => p.incomeSoFar))
  const sumSpend = sum(parts.map((p) => p.spentSoFar))
  check('income summed over accounts is at least the all-account income', sumIncome >= all.incomeSoFar - 0.01)
  check(
    'the surplus is the same either way (transfers add equally to both sides)',
    near(sumIncome - sumSpend, all.incomeSoFar - all.spentSoFar),
    `${sumIncome - sumSpend} vs ${all.incomeSoFar - all.spentSoFar}`,
  )

  console.log('Expected balance')
  const now = get(`/month/outlook?year=${monthsToCheck[0].y}&month=${monthsToCheck[0].m}`)
  for (const a of [null, ...accounts]) {
    const filter = a ? `&accountIds=${a.id}` : ''
    const label = a ? a.name : 'all accounts'
    const o = get(`/month/outlook?year=${monthsToCheck[0].y}&month=${monthsToCheck[0].m}${filter}`)
    const dash = get(`/transactions/dashboard?year=${monthsToCheck[0].y}&month=${monthsToCheck[0].m}${filter}`)
    check(`${label}: the balance now is the dashboard's tracked balance`, near(o.balance.current, dash.kpis.netBalance), `${o.balance.current} vs ${dash.kpis.netBalance}`)
    if (o.balance.expectedEnd !== null) {
      check(
        `${label}: expected = now + income to come − bills − everyday`,
        near(o.balance.expectedEnd, o.balance.current + o.balance.incomeStillToCome - o.balance.billsStillToCome - o.balance.everydayStillToCome),
      )
      check(`${label}: income to come is never negative`, o.balance.incomeStillToCome >= 0)
      check(`${label}: bills to come match the bills list`, near(o.balance.billsStillToCome, o.stillToCome.total))
    }
  }
  check('a finished month has no balance estimate', get(`/month/outlook?year=${monthsToCheck[1].y}&month=${monthsToCheck[1].m}`).balance === null)
  void now
} else {
  console.log('  (only one account — nothing to filter)')
}

console.log(`\n${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)

#!/usr/bin/env node
// Checks the URL period convention every page shares, so a link built on one page reads the
// same on another and a bookmarked view comes back as the view that was bookmarked.
//
//   node scripts/verify-url-state.mjs
//
// Pure functions, no server needed.

import { readPeriod, writePeriod, currentMonth } from '../frontend/src/lib/period.ts'

let pass = 0
let fail = 0

const eq = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  ok ? pass++ : fail++
  console.log(
    `  ${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(48)} ${JSON.stringify(actual)}${ok ? '' : ` != ${JSON.stringify(expected)}`}`,
  )
}

console.log('readPeriod')
// An absent year is what lets each page keep its own default — the dashboard opens on this
// month, the account list on all history — while `year` alone still means "all of that year".
eq('no params -> null (page applies its default)', readPeriod(new URLSearchParams('')), null)
eq('year only -> whole year', readPeriod(new URLSearchParams('year=2026')), { year: 2026, month: null })
eq('year+month -> that month', readPeriod(new URLSearchParams('year=2026&month=3')), { year: 2026, month: 3 })
eq('month without year -> null', readPeriod(new URLSearchParams('month=3')), null)

console.log('writePeriod round-trips')
for (const p of [
  { year: 2026, month: null },
  { year: 2026, month: 1 },
  { year: 2026, month: 12 },
  { year: 1999, month: 7 },
]) {
  const u = new URLSearchParams()
  writePeriod(u, p)
  eq(`round-trip ${JSON.stringify(p)}`, readPeriod(new URLSearchParams(u.toString())), p)
}

console.log('writePeriod clears stale values')
{
  // Switching from a month to the whole year must drop `month`, or the URL would keep saying
  // March while the page shows the year.
  const u = new URLSearchParams('year=2026&month=5&other=keep')
  writePeriod(u, { year: 2027, month: null })
  eq('all-year drops month', readPeriod(u), { year: 2027, month: null })
  eq('unrelated params survive', u.get('other'), 'keep')

  writePeriod(u, null)
  eq('null clears the period', readPeriod(u), null)
  eq('and still keeps the rest', u.toString(), 'other=keep')
}

console.log('currentMonth')
{
  const now = new Date()
  const cm = currentMonth()
  eq('is this year and month', cm, { year: now.getFullYear(), month: now.getMonth() + 1 })
  eq('survives a round-trip', readPeriod(new URLSearchParams(`year=${cm.year}&month=${cm.month}`)), cm)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

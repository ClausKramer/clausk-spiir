#!/usr/bin/env node
// Asserts that every calculated figure on the dashboard reconciles with the drill-down behind it.
//
// This exists because the property is easy to break silently: the figure and the page behind it
// are computed by different code paths, and a change to one (rolling category bars up to groups,
// say) leaves the other quietly answering a different question. Both times that happened here,
// the UI looked fine and the number was wrong.
//
//   node scripts/verify-drilldowns.mjs [--api http://localhost:5218] [--email dev@test.local] [--year 2026]
//
// Uses the dev-only magic-link endpoint, so it runs against a local API, not production.

import { execSync } from 'node:child_process'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : fallback
}

const API = arg('api', 'http://localhost:5218')
const EMAIL = arg('email', 'dev@test.local')
const YEAR = arg('year', String(new Date().getFullYear()))

const sh = (cmd) => execSync(cmd, { maxBuffer: 1e8 }).toString()

function login() {
  sh(`curl -s -X POST ${API}/auth/request-link -H "Content-Type: application/json" -d "{\\"email\\":\\"${EMAIL}\\"}"`)
  const link = sh(`curl -s ${API}/dev/last-magic-link`)
  const token = link.match(/token=([^"&\s]+)/)?.[1]
  if (!token) throw new Error('No magic link returned — is the API running in Development?')
  const res = JSON.parse(
    sh(`curl -s -X POST ${API}/auth/verify -H "Content-Type: application/json" -d "{\\"token\\":\\"${token}\\"}"`),
  )
  return res.accessToken
}

const jwt = login()
const get = (path) => JSON.parse(sh(`curl -s -H "Authorization: Bearer ${jwt}" "${API}${path}"`))

const Y = `year=${YEAR}`
const dash = get(`/transactions/dashboard?${Y}`)
const kpi = dash.kpis

let pass = 0
const failures = []

// A figure and the query it claims to summarise must agree to the øre.
function check(name, expected, path, field) {
  const result = get(path)
  const got = result[field]
  // /query reports a count; the aggregate endpoints only return the rows themselves.
  const rows = result.count ?? result.items?.length ?? 0
  if (Math.abs(got - expected) < 0.01) {
    pass++
    console.log(`  ok   ${name.padEnd(34)} ${String(Math.round(expected)).padStart(9)}  (${rows} rows)`)
  } else {
    failures.push({ name, expected, got })
    console.log(`  FAIL ${name.padEnd(34)} figure ${Math.round(expected)} vs drill ${Math.round(got)}`)
  }
}

function checkCount(name, expected, path) {
  const got = get(path).count
  if (got === expected) {
    pass++
    console.log(`  ok   ${name.padEnd(34)} ${String(expected).padStart(9)} rows`)
  } else {
    failures.push({ name, expected, got })
    console.log(`  FAIL ${name.padEnd(34)} figure ${expected} vs drill ${got}`)
  }
}

console.log('KPIs')
// The KPIs are per-month averages over the period, so the drill-down total is the average
// multiplied back out by the period length.
check('avg monthly income', kpi.avgMonthlyIncome * dash.months, `/transactions/query?${Y}&direction=income`, 'inflow')
check('avg monthly expense', kpi.avgMonthlyExpense * dash.months, `/transactions/query?${Y}&direction=expense`, 'outflow')
check('avg monthly surplus', kpi.avgMonthlySurplus * dash.months, `/transactions/query?${Y}`, 'net')
// Net balance has its own scope: all history to today, transfers included.
check('net balance', kpi.netBalance, `/transactions/query?${Y}&scope=balance`, 'net')

console.log('Committed vs discretionary')
for (const kind of ['Fixed', 'Variable', 'Savings', 'Debt']) {
  const value = dash.spendingByKind[kind.toLowerCase()]
  if (value > 0) check(kind, value, `/transactions/query?${Y}&kind=${kind}&direction=expense`, 'outflow')
}
check('unfiled', dash.spendingByKind.uncategorized, `/transactions/query?${Y}&uncategorized=true&direction=expense`, 'outflow')

console.log('Cash flow bars')
for (const m of dash.monthlyFlow.filter((m) => m.income || m.expense)) {
  const p = `year=${m.year}&month=${m.month}`
  check(`${m.year}-${String(m.month).padStart(2, '0')} income`, m.income, `/transactions/by-flow?${p}&direction=income`, 'total')
  check(`${m.year}-${String(m.month).padStart(2, '0')} expense`, m.expense, `/transactions/by-flow?${p}&direction=expense`, 'total')
  check(`${m.year}-${String(m.month).padStart(2, '0')} net`, m.net, `/transactions/query?${p}`, 'net')
}

console.log('Category bars')
for (const row of dash.categoryBreakdown.filter((r) => r.total > 0)) {
  // A bar is a top-level group; the page behind it must include the group's leaves.
  check(row.categoryName ?? 'uncategorized', row.total, `/transactions/by-category?${Y}&categoryId=${row.categoryId ?? ''}`, 'total')
}

console.log('Tags')
for (const tag of dash.tagBreakdown) {
  check(`tag ${tag.name}`, tag.total, `/transactions/query?${Y}&tagId=${tag.tagId}&direction=expense`, 'outflow')
}

console.log('Exclusion counts')
checkCount('excluded transfers', dash.excludedTransfers, `/transactions/query?${Y}&scope=transfers`)
checkCount('excluded scheduled', dash.excludedFuture, `/transactions/query?${Y}&scope=future`)

console.log('Category page breakdowns')
for (const row of dash.categoryBreakdown.filter((r) => r.total > 0 && r.categoryId)) {
  const detail = get(`/transactions/by-category?${Y}&categoryId=${row.categoryId}`)
  // Leaves must add up to the group they sit under.
  if (detail.childBreakdown.length > 0) {
    const sum = detail.childBreakdown.reduce((s, c) => s + c.total, 0)
    check(`${row.categoryName} leaves sum`, detail.total, `/transactions/by-category?${Y}&categoryId=${row.categoryId}`, 'total')
    if (Math.abs(sum - detail.total) >= 0.01) failures.push({ name: `${row.categoryName} childBreakdown`, expected: detail.total, got: sum })
  }
  for (const m of detail.merchants.slice(0, 3)) {
    check(
      `${row.categoryName}/${m.merchant}`,
      m.total,
      `/transactions/query?${Y}&categoryId=${row.categoryId}&merchant=${encodeURIComponent(m.merchant)}`,
      'outflow',
    )
  }
}

console.log(`\n${pass} passed, ${failures.length} failed`)
if (failures.length > 0) {
  for (const f of failures) console.error(`  ${f.name}: figure ${f.expected}, drill-down ${f.got}`)
  process.exit(1)
}

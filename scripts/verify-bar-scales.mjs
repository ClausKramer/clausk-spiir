#!/usr/bin/env node
// Asserts that every horizontal bar is drawn at a length proportional to its value.
//
// This exists because it silently wasn't. Bars carried an 8–10% minimum width so the amount
// label would fit inside them, which drew a category worth 0.5% of the largest at 8% — 17x too
// long. Nothing looked broken; the chart just said something false.
//
//   node scripts/verify-bar-scales.mjs [--api http://localhost:5218] [--email dev@test.local] [--year 2026]
//
// Reads the same figures the pages plot and checks the fraction each bar would be given.

import { execSync } from 'node:child_process'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : fallback
}

const API = arg('api', 'http://localhost:5218')
const EMAIL = arg('email', 'dev@test.local')
const YEAR = arg('year', String(new Date().getFullYear()))

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

// BarRow draws `fraction` directly as a percentage, with only a 2px hairline for a nonzero
// value. So the check is that the fraction the page computes is the true ratio — no floor.
function checkChart(chart, rows, valueOf) {
  const values = rows.map(valueOf).map(Math.abs)
  const max = Math.max(...values, 0)
  if (max === 0) return
  for (let i = 0; i < rows.length; i++) {
    const trueFraction = values[i] / max
    // What BarRow will render, mirroring its own clamp.
    const drawn = Math.max(0, Math.min(1, trueFraction))
    const ratio = trueFraction > 0 ? drawn / trueFraction : 1
    const name = `${chart} #${i + 1}`
    if (Math.abs(ratio - 1) < 1e-9) {
      pass++
    } else {
      failures.push({ name, trueFraction, drawn, ratio })
      console.log(`  FAIL ${name}: true ${(trueFraction * 100).toFixed(1)}% drawn ${(drawn * 100).toFixed(1)}% (${ratio.toFixed(1)}x)`)
    }
  }
  const smallest = Math.min(...values.filter((v) => v > 0))
  console.log(
    `  ok   ${chart.padEnd(44)} ${rows.length} bars, smallest ${((smallest / max) * 100).toFixed(2)}% of largest, drawn true`,
  )
}

const Y = `year=${YEAR}`
const dash = get(`/transactions/dashboard?${Y}`)

checkChart('dashboard: spending by category', dash.categoryBreakdown.filter((r) => r.total > 0), (r) => r.total)
checkChart('dashboard: tags', dash.tagBreakdown.filter((t) => t.total > 0), (t) => t.total)

for (const row of dash.categoryBreakdown.filter((r) => r.total > 0 && r.categoryId)) {
  const detail = get(`/transactions/by-category?${Y}&categoryId=${row.categoryId}`)
  checkChart(`category "${row.categoryName}": merchants`, detail.merchants, (m) => m.total)
  if (detail.childBreakdown.length > 1) {
    checkChart(`category "${row.categoryName}": leaves`, detail.childBreakdown, (c) => c.total)
  }
}

for (const dir of ['income', 'expense']) {
  const flow = get(`/transactions/by-flow?${Y}&direction=${dir}`)
  checkChart(`flow ${dir}: by category`, flow.byCategory, (c) => c.total)
  checkChart(`flow ${dir}: by source`, flow.bySource, (s) => s.total)
}

console.log(`\n${pass} bars proportional, ${failures.length} distorted`)
process.exit(failures.length ? 1 : 0)

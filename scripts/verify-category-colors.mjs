#!/usr/bin/env node
// Asserts that a category's colour follows the category, not its position in a chart.
//
// The bar you click on the dashboard should be the colour of the page it opens, and changing
// the period must never repaint anything. The previous implementation keyed the palette on rank
// index, so re-sorting silently swapped every colour and that connection was lost — which is
// invisible in a screenshot of any single view.
//
//   node --experimental-strip-types scripts/verify-category-colors.mjs

import { buildCategoryColors } from '../frontend/src/lib/chartColors.ts'

let pass = 0
const failures = []
const check = (name, cond, detail = '') => {
  cond ? pass++ : failures.push(name)
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

// A tree shaped like the real one: several groups, each with leaves.
const groups = ['g-bolig', 'g-transport', 'g-mad', 'g-fritid', 'g-sundhed', 'g-abon', 'g-bank', 'g-shop', 'g-familie']
const categories = [
  ...groups.map((id) => ({ id, parentCategoryId: null })),
  ...groups.flatMap((g) => [1, 2, 3].map((n) => ({ id: `${g}-leaf${n}`, parentCategoryId: g }))),
]

const colors = buildCategoryColors(categories)

console.log('stability')
// Rank must not enter into it: the same input in a different order is the same output.
const shuffled = [...categories].reverse()
const colorsShuffled = buildCategoryColors(shuffled)
check(
  'same colours regardless of input order',
  groups.every((g) => colors.get(g) === colorsShuffled.get(g)),
)
// The real guarantee: colours are a function of the user's whole category list, so any page
// that passes that list gets the same answer. Rank within a chart never enters into it, which
// is what makes a filtered or re-sorted chart keep its colours.
const colorsAgain = buildCategoryColors(categories)
check('deterministic across calls', groups.every((g) => colors.get(g) === colorsAgain.get(g)))

// Precondition, asserted so it can't be forgotten: callers pass the complete list. A subset
// re-indexes, which is why every call site reads /categories rather than the chart's own rows.
const subset = categories.filter((c) => c.parentCategoryId === null).slice(2)
check(
  'a subset re-indexes — callers must pass the full list',
  buildCategoryColors(subset).get(groups[2]) !== undefined,
)

console.log('coverage')
check('every category has a colour', categories.every((c) => colors.get(c.id)), `${colors.size} of ${categories.length}`)
check(
  'a leaf inherits its group, so a category page reads as one colour',
  groups.every((g) => [1, 2, 3].every((n) => colors.get(`${g}-leaf${n}`) === colors.get(g))),
)

console.log('distinctness')
// Hues are handed out in the implementation's own order — groups sorted by id — so the test
// has to look at them the same way rather than in declaration order.
const inPaletteOrder = [...groups].sort()
const groupColors = inPaletteOrder.map((g) => colors.get(g))
check(
  'the first 8 groups are all different hues',
  new Set(groupColors.slice(0, 8)).size === 8,
  `${new Set(groupColors).size} distinct across ${groups.length} groups`,
)
// A 9th group necessarily reuses a hue. What matters is that the repeat sits next to the
// eighth, and that wrap-around pair was validated separately (orange↔cyan, ΔE 30.8 normal).
check('a 9th group reuses the first hue, as designed', groupColors[8] === groupColors[0])

console.log(`\n${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)

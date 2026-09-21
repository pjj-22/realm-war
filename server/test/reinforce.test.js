import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planReinforce } from '../reinforce.js'

const MIN = 60_000
const now = 1_000_000
// distance = |letter gap| minutes
const travel = (a, b) => Math.abs(a.charCodeAt(0) - b.charCodeAt(0)) * MIN

test('takes from the nearest hexes first, up to what is needed', () => {
  const { plan, short } = planReinforce([{ h3: 'm', need: 10, deadline: now + 60 * MIN }], new Map([['n', 6], ['o', 6], ['z', 50]]), travel, now)
  assert.deepEqual(plan.map(p => [p.fromHex, p.quantity]), [['n', 6], ['o', 4]])
  assert.deepEqual(short, [])
})

test('ignores hexes that cannot arrive before the deadline', () => {
  const { plan, short } = planReinforce([{ h3: 'a', need: 10, deadline: now + 3 * MIN }], new Map([['b', 4], ['z', 50]]), travel, now)
  assert.deepEqual(plan.map(p => p.fromHex), ['b'])
  assert.deepEqual(short, [{ h3: 'a', short: 6 }])
})

test('spare troops are not promised twice; the sooner deadline is served first', () => {
  const threats = [{ h3: 'a', need: 5, deadline: now + 60 * MIN }, { h3: 'c', need: 5, deadline: now + 10 * MIN }]
  const { plan } = planReinforce(threats, new Map([['b', 5]]), travel, now)
  assert.equal(plan.length, 1)
  assert.equal(plan[0].toHex, 'c')
})

test('nothing to plan without spare troops', () => {
  const { plan, short } = planReinforce([{ h3: 'a', need: 3, deadline: now + 60 * MIN }], new Map(), travel, now)
  assert.deepEqual(plan, [])
  assert.deepEqual(short, [{ h3: 'a', short: 3 }])
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planFanOut } from '../fanout.js'

// tiny line world: a - b - c - d, neighbours are adjacent letters
const line = 'abcdefg'
const neighbors = h => [line[line.indexOf(h) - 1], line[line.indexOf(h) + 1]].filter(Boolean)

test('each target is served by at most one army, from an adjacent source', () => {
  const plan = planFanOut(new Map([['b', 20]]), [{ h3: 'a', cost: 5, kind: 'claim' }, { h3: 'c', cost: 5, kind: 'claim' }], neighbors)
  assert.equal(plan.length, 2)
  assert.ok(plan.every(p => p.fromHex === 'b'))
})

test('a source never sends more than it has spare', () => {
  const plan = planFanOut(new Map([['b', 7]]), [{ h3: 'a', cost: 5, kind: 'claim' }, { h3: 'c', cost: 5, kind: 'claim' }], neighbors)
  assert.equal(plan.length, 1)
})

test('claims are planned before attacks when troops are scarce', () => {
  const plan = planFanOut(new Map([['b', 6]]), [{ h3: 'a', cost: 6, kind: 'attack' }, { h3: 'c', cost: 5, kind: 'claim' }], neighbors)
  assert.deepEqual(plan.map(p => p.kind), ['claim'])
})

test('a target only one source can reach is not starved by a better-connected one', () => {
  // b can reach a and c; d can only reach c. c should go to d... a is only reachable from b.
  const plan = planFanOut(new Map([['b', 5], ['d', 5]]), [{ h3: 'a', cost: 5, kind: 'claim' }, { h3: 'c', cost: 5, kind: 'claim' }], neighbors)
  assert.equal(plan.length, 2)
  assert.equal(plan.find(p => p.toHex === 'a').fromHex, 'b')
  assert.equal(plan.find(p => p.toHex === 'c').fromHex, 'd')
})

test('targets nobody can afford are skipped', () => {
  assert.deepEqual(planFanOut(new Map([['b', 3]]), [{ h3: 'a', cost: 5, kind: 'claim' }], neighbors), [])
})

test('every army carries exactly the target cost, and a source will not drop below what it can spare', () => {
  // spare is troops minus the player's minimum, so a source with 12 spare and a cost of 5 can only serve two targets
  const plan = planFanOut(new Map([['b', 12]]), [{ h3: 'a', cost: 5, kind: 'claim' }, { h3: 'c', cost: 5, kind: 'claim' }, { h3: 'e', cost: 5, kind: 'claim' }], neighbors)
  assert.ok(plan.every(p => p.quantity === 5))
  assert.equal(plan.length, 2)
})

test('with a reach above 1, the nearest hex that can afford the target sends', () => {
  // a is the target; b (1 away) is too poor, c (2 away) and d (3 away) can afford it
  const reach = h => 'bcd'.split('').map((x, i) => ({ h3: x, d: i + 1 })).filter(() => h === 'a')
  const plan = planFanOut(new Map([['b', 2], ['c', 30], ['d', 90]]), [{ h3: 'a', cost: 20, kind: 'claim' }], reach)
  assert.deepEqual(plan.map(p => p.fromHex), ['c'])
})

test('with a reach above 1, one rich interior hex can supply several targets', () => {
  const reach = () => [{ h3: 'x', d: 3 }]
  const plan = planFanOut(new Map([['x', 65]]), [{ h3: 'a', cost: 20, kind: 'claim' }, { h3: 'b', cost: 20, kind: 'claim' }, { h3: 'c', cost: 20, kind: 'claim' }, { h3: 'd', cost: 20, kind: 'claim' }], reach)
  assert.equal(plan.length, 3)
  assert.ok(plan.every(p => p.fromHex === 'x'))
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planRedistribute } from '../redistribute.js'

// hexes are letters on a line: a - b - c - d ...
const line = 'abcdefgh'
const neighbors = h => [line[line.indexOf(h) - 1], line[line.indexOf(h) + 1]].filter(Boolean)
const apply = (troops, moves) => {
  const t = new Map(troops)
  for (const m of moves) { t.set(m.fromHex, t.get(m.fromHex) - m.quantity); t.set(m.toHex, t.get(m.toHex) + m.quantity) }
  return t
}

test('two neighbours settle at their average', () => {
  const troops = new Map([['a', 60], ['b', 30]])
  const { moves } = planRedistribute(troops, neighbors)
  assert.deepEqual(moves, [{ fromHex: 'a', toHex: 'b', quantity: 15 }])
  assert.deepEqual([...apply(troops, moves).values()], [45, 45])
})

test('a hex in the middle of a slope receives and passes on troops', () => {
  const troops = new Map([['a', 60], ['b', 30], ['c', 20]])
  const { moves, before, after } = planRedistribute(troops, neighbors, { minMove: 1 })
  assert.ok(moves.some(m => m.fromHex === 'a' && m.toHex === 'b'))
  assert.ok(moves.some(m => m.fromHex === 'b' && m.toHex === 'c'))
  assert.ok(after.max - after.min < before.max - before.min)
})

test('troops are conserved and the spread shrinks', () => {
  const troops = new Map(line.split('').map((h, i) => [h, [90, 10, 70, 5, 40, 40, 100, 0][i]]))
  const { moves, before, after } = planRedistribute(troops, neighbors, { minMove: 1 })
  const result = apply(troops, moves)
  assert.equal([...result.values()].reduce((s, v) => s + v, 0), [...troops.values()].reduce((s, v) => s + v, 0))
  assert.ok([...result.values()].every(v => v >= 0))
  assert.ok(after.max - after.min < before.max - before.min)
})

test('a hex is never left below the minimum', () => {
  const troops = new Map([['a', 12], ['b', 0], ['c', 0], ['d', 0]])
  const { moves } = planRedistribute(troops, neighbors, { keep: 8, minMove: 1 })
  assert.ok(apply(troops, moves).get('a') >= 8)
})

test('a hex that must hold sends nothing but can still receive', () => {
  const troops = new Map([['a', 60], ['b', 30]])
  const { moves } = planRedistribute(troops, neighbors, { canSend: h => h !== 'a' })
  assert.deepEqual(moves, [])
  const flipped = planRedistribute(new Map([['a', 30], ['b', 60]]), neighbors, { canSend: h => h !== 'a' })
  assert.deepEqual(flipped.moves.map(m => [m.fromHex, m.toHex]), [['b', 'a']])
})

test('tiny moves are skipped', () => {
  const { moves } = planRedistribute(new Map([['a', 21], ['b', 20]]), neighbors)
  assert.deepEqual(moves, [])
})

test('an already even empire needs no moves', () => {
  const { moves } = planRedistribute(new Map(line.split('').map(h => [h, 30])), neighbors)
  assert.deepEqual(moves, [])
})

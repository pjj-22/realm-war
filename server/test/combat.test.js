// Unit tests for the combat resolution math (extracted from tick.js into combat.js).
// Pure functions - no database, no pg-mem. These guard the balance-critical formulas:
// a regression here is a live-game exploit (invincible defenders, doubled survivors).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defenseMultiplier, resolveRound, survivorCount } from '../combat.js'

// Real balance constants (config.js / strategic.js) - kept explicit so the tests
// document the intended numbers, and break loudly if someone retunes them by accident.
const FORT_BONUS = 0.4
const ENTRENCH_PER = 0.08
const ENTRENCH_MAX = 4
const STRATEGIC = 0.25 // STRATEGIC_DEFENSE_BONUS
const RATE = 0.15

const near = (a, b) => Math.abs(a - b) < 1e-9

test('defenseMultiplier: bare hex has no bonus (x1.0)', () => {
  assert.equal(defenseMultiplier({}), 1)
})

test('defenseMultiplier: each fort adds fortBonus', () => {
  assert.ok(near(defenseMultiplier({ forts: 1, fortBonus: FORT_BONUS }), 1.4))
  assert.ok(near(defenseMultiplier({ forts: 3, fortBonus: FORT_BONUS }), 1 + 1.2))
})

test('defenseMultiplier: strategic bonus stacks additively', () => {
  assert.ok(near(
    defenseMultiplier({ forts: 1, fortBonus: FORT_BONUS, strategicBonus: STRATEGIC }),
    1 + 0.4 + 0.25,
  ))
})

test('defenseMultiplier: entrenchment scales per friendly neighbor', () => {
  assert.ok(near(
    defenseMultiplier({ friendlyNeighbors: 2, entrenchPerNeighbor: ENTRENCH_PER, entrenchMaxNeighbors: ENTRENCH_MAX }),
    1 + 0.16,
  ))
})

test('defenseMultiplier: entrenchment is capped at entrenchMaxNeighbors', () => {
  // 6 friendly neighbors, but the cap is 4 -> +32%, not +48%
  const capped = defenseMultiplier({ friendlyNeighbors: 6, entrenchPerNeighbor: ENTRENCH_PER, entrenchMaxNeighbors: ENTRENCH_MAX })
  assert.ok(near(capped, 1 + 4 * ENTRENCH_PER))
  assert.ok(near(capped, 1.32))
})

test('defenseMultiplier: all bonuses combine additively', () => {
  const m = defenseMultiplier({
    forts: 2, fortBonus: FORT_BONUS,
    strategicBonus: STRATEGIC,
    friendlyNeighbors: 10, entrenchPerNeighbor: ENTRENCH_PER, entrenchMaxNeighbors: ENTRENCH_MAX,
  })
  assert.ok(near(m, 1 + 0.8 + 0.25 + 0.32)) // = 2.37
})

test('resolveRound: simultaneous exchange, both computed from pre-round strengths', () => {
  const r = resolveRound(100, 50, RATE)
  assert.ok(near(r.atkDmg, 15))         // 100 * 0.15
  assert.ok(near(r.defDmg, 7.5))        // 50 * 0.15
  assert.ok(near(r.newAtkStr, 92.5))    // 100 - 7.5
  assert.ok(near(r.newDefStr, 35))      // 50 - 15
  assert.equal(r.over, false)
  assert.equal(r.attackerWon, null)     // undecided while ongoing
})

test('resolveRound: strengths floor at 0, never negative', () => {
  const r = resolveRound(1, 1000, RATE)  // defender massively stronger
  assert.equal(r.newAtkStr, 0)           // max(0, 1 - 150)
  assert.ok(r.over)
  assert.equal(r.attackerWon, false)
})

test('resolveRound: attacker wins when it ends with more strength', () => {
  const r = resolveRound(1000, 3, RATE)
  assert.ok(r.over)
  assert.equal(r.attackerWon, true)
  assert.equal(r.newDefStr, 0)
})

test('survivorCount: proportional to fraction of strength surviving', () => {
  // 100 troops, strength fell 200 -> 150 => 75% survive => 75
  assert.equal(survivorCount(100, 150, 200), 75)
})

test('survivorCount: rounds to whole troops', () => {
  assert.equal(survivorCount(10, 1, 3), 3) // 10 * 1/3 = 3.33 -> 3
  assert.equal(survivorCount(10, 2, 3), 7) // 10 * 2/3 = 6.66 -> 7
})

test('survivorCount: guards return 0 for empty or annihilated stacks', () => {
  assert.equal(survivorCount(0, 50, 100), 0)  // no troops
  assert.equal(survivorCount(100, 0, 100), 0) // no strength left
  assert.equal(survivorCount(100, 50, 0), 0)  // no original strength (avoid /0)
})

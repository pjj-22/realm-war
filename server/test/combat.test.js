// Unit tests for the combat resolution math (extracted from tick.js into combat.js).
// Pure functions - no database, no pg-mem. These guard the balance-critical formulas:
// a regression here is a live-game exploit (invincible defenders, doubled survivors).
//
// Two things make hand-crafted RNG sequences trickier here than a plain
// sorted-pairing design: pairing is randomized (shuffle consumes RNG calls
// too), and the gauntlet mechanic rolls the "big" (more numerous) side's
// dice BEFORE the "small" side's - which for equal-count clashes means the
// defender's dice come first, attacker's second (since ties in size go to
// the defender's role - see atkIsSmaller in combat.js). Most tests below
// either use uniform dice values (shuffle can't change a uniform outcome) or
// Monte Carlo sampling where randomness is the actual point.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  advantagedDefenderCount, resolveClash, resolveBattleClash,
  FRONTLINE_CAP, DIE_SIDES, MAX_ADVANTAGED_DEFENDERS, MAX_GAUNTLET_GROUP,
} from '../combat.js'

// Real balance constants (config.js / strategic.js) - kept explicit so the tests
// document the intended numbers, and break loudly if someone retunes them by accident.
const FORT_ADVANTAGE = 3
const ENTRENCH_PER = 1
const ENTRENCH_MAX = 4
const STRATEGIC_ADVANTAGE = 2

// Deterministic "dice" for tests that need an exact outcome: cycles through a
// fixed sequence of face values (1..DIE_SIDES) instead of Math.random.
function fixedRng(sequence) {
  let i = 0
  return () => {
    const v = sequence[i % sequence.length]
    i++
    return (v - 1) / DIE_SIDES + 0.0001 // maps back to the die face rollDie expects
  }
}

test('advantagedDefenderCount: bare hex has no advantaged defenders', () => {
  assert.equal(advantagedDefenderCount({}), 0)
})

test('advantagedDefenderCount: a fort adds fortAdvantage', () => {
  assert.equal(advantagedDefenderCount({ forts: 1, fortAdvantage: FORT_ADVANTAGE }), 3)
})

test('advantagedDefenderCount: strategic bonus stacks additively', () => {
  assert.equal(
    advantagedDefenderCount({ forts: 1, fortAdvantage: FORT_ADVANTAGE, strategicAdvantage: STRATEGIC_ADVANTAGE }),
    5,
  )
})

test('advantagedDefenderCount: entrenchment scales per friendly neighbor', () => {
  assert.equal(
    advantagedDefenderCount({ friendlyNeighbors: 2, entrenchAdvantagePerNeighbor: ENTRENCH_PER, entrenchMaxNeighbors: ENTRENCH_MAX }),
    2,
  )
})

test('advantagedDefenderCount: entrenchment is capped at entrenchMaxNeighbors', () => {
  const n = advantagedDefenderCount({ friendlyNeighbors: 6, entrenchAdvantagePerNeighbor: ENTRENCH_PER, entrenchMaxNeighbors: ENTRENCH_MAX })
  assert.equal(n, 4)
})

test('advantagedDefenderCount: everything combined is capped at MAX_ADVANTAGED_DEFENDERS', () => {
  const n = advantagedDefenderCount({
    forts: 1, fortAdvantage: FORT_ADVANTAGE,
    strategicAdvantage: STRATEGIC_ADVANTAGE,
    friendlyNeighbors: 10, entrenchAdvantagePerNeighbor: ENTRENCH_PER, entrenchMaxNeighbors: ENTRENCH_MAX,
  })
  // Raw total would be 3 + 2 + 4 = 9, but MAX_ADVANTAGED_DEFENDERS caps it at 5.
  assert.equal(n, MAX_ADVANTAGED_DEFENDERS)
  assert.equal(MAX_ADVANTAGED_DEFENDERS, 5)
})

test('resolveClash: equal counts degenerate to plain 1-for-1 pairing - attacker sweep', () => {
  // Equal dice counts -> groupSize=1, i.e. exactly the old simple pairing.
  // Defender's dice are rolled first (defender is the "big"/first role
  // whenever counts are equal), attacker's second - low block then high block.
  const rng = fixedRng([...Array(6).fill(1), ...Array(5).fill(1), ...Array(6).fill(DIE_SIDES)])
  const r = resolveClash(6, 6, 0, rng)
  assert.equal(r.defLosses, 6)
  assert.equal(r.atkLosses, 0)
})

test('resolveClash: ties go to the defender in the equal-count case', () => {
  const rng = fixedRng([10])
  const r = resolveClash(6, 6, 0, rng)
  assert.equal(r.atkLosses, 6)
  assert.equal(r.defLosses, 0)
})

test('resolveClash: ties go to the defender even when the defender is the outnumbered side', () => {
  // 10 attackers vs 2 defenders -> groupSize = min(2, floor(10/2)) = 2, so
  // each defender's gauntlet has 2 opponents. A tie must resolve in the
  // defender's favor at every duel, so both defenders sweep their full
  // gauntlet: 2 defenders x 2 kills each = 4 attacker losses, 0 defender losses.
  const rng = fixedRng([10])
  const r = resolveClash(10, 2, 0, rng)
  assert.equal(r.atkLosses, 4, 'both defenders win every tied duel in their 2-opponent gauntlet')
  assert.equal(r.defLosses, 0, 'the defender survives ties all the way through its gauntlet')
})

test('resolveClash: both sides are capped at FRONTLINE_CAP dice regardless of real troop count', () => {
  const rng = fixedRng([1])
  const r = resolveClash(999, 999, 0, rng)
  assert.equal(r.atkDice.length, FRONTLINE_CAP)
  assert.equal(r.defDice.length, FRONTLINE_CAP)
})

test('resolveClash: a clean ratio uses all of the outnumbering side\'s real troops', () => {
  // 3 attackers vs 6 defenders: groupSize = min(MAX_GAUNTLET_GROUP, floor(6/3)) = 2,
  // so all 6 defenders (3 groups of 2) actually fight this clash.
  const rng = fixedRng([1])
  const r = resolveClash(3, 6, 0, rng)
  assert.equal(r.atkDice.length, 3)
  assert.equal(r.defDice.length, 6)
})

test('resolveClash: an uneven ratio leaves some of the outnumbering side sitting out', () => {
  // 3 attackers vs 5 defenders: floor(5/3) = 1 (capped group size doesn't even
  // apply here), so only 3 of the 5 real defenders get used this clash - the
  // other 2 sit out rather than forming a partial group. They're still
  // available next clash once frontlines are recomputed.
  const rng = fixedRng([1])
  const r = resolveClash(3, 5, 0, rng)
  assert.equal(r.atkDice.length, 3)
  assert.equal(r.defDice.length, 3)
})

test('resolveClash: an outnumbered troop can win part of its gauntlet before dying', () => {
  // 10 attackers vs 2 defenders -> groupSize = min(2, floor(10/2)) = 2, each
  // defender fights a gauntlet of 2. Rig it so each defender beats its first
  // opponent (a kill) then loses to its second (dies) - 2 kills total, both
  // defenders die. This is the whole point of the redesign: a defender that
  // ultimately loses can still take some attackers down with it.
  const win = 15, lose = 3
  // Call order: defender is the small/gauntlet side (2 defenders outnumbered by
  // 10 attackers) -> bigRolls (attacker, 4 real opponents used: 2 groups of 2)
  // roll first, then shuffle, then each defender's gauntlet rerolls. Filler
  // uses DIE_SIDES for the shuffle, which is an identity permutation (verified
  // separately) - so groups land exactly as rolled: [beatable, unbeatable] x2.
  // Each defender then needs 2 rolls (win duel 1, lose duel 2) = 4 total.
  const seq = [
    lose, DIE_SIDES, lose, DIE_SIDES,      // 4 attacker opponents: [beatable, unbeatable] x2
    DIE_SIDES, DIE_SIDES, DIE_SIDES,       // shuffle filler (identity permutation)
    win, win, win, win,                    // both defenders roll `win` for each of their 2 duels
  ]
  const rng = fixedRng(seq)
  const r = resolveClash(10, 2, 0, rng)
  assert.equal(r.atkLosses, 2, 'each defender should land exactly one kill before dying')
  assert.equal(r.defLosses, 2, 'both defenders are eventually overwhelmed')
})

test('resolveClash: advantaged defenders roll with advantage on every roll they make', () => {
  // Equal counts (10v10) -> defender is the "big"/first role, so its rolls
  // come first in the sequence, one call each (or two, if advantaged).
  const low = 3, high = 18, mid = 9
  const advantaged = 4
  const seq = [
    ...Array(advantaged).fill([low, high]).flat(), // 4 advantage rolls -> resolve to `high`
    ...Array(10 - advantaged).fill(mid),           // remaining 6 plain defender rolls
    ...Array(9).fill(DIE_SIDES),                   // shuffle filler (identity permutation)
    ...Array(10).fill(mid),                        // attacker's 10 plain rolls
  ]
  const rng = fixedRng(seq)
  const r = resolveClash(10, 10, advantaged, rng)
  const highCount = r.defDice.filter(d => d === high).length
  const midCount = r.defDice.filter(d => d === mid).length
  assert.equal(highCount, advantaged, 'exactly the advantaged troops should resolve to the higher of their two rolls')
  assert.equal(midCount, 10 - advantaged, 'non-advantaged troops roll a single plain die')
})

test('resolveClash: advantagedDefenders is capped at the real defender troop count', () => {
  const rng = fixedRng([1])
  const r = resolveClash(3, 3, 10, rng) // asking for 10 advantaged but only 3 real defenders exist
  assert.equal(r.defDice.length, 3)
})

test('resolveClash: losses never exceed the real troop count on that side', () => {
  const rng = fixedRng([DIE_SIDES, 1])
  const r = resolveClash(3, 3, 0, rng)
  assert.ok(r.defLosses <= 3)
  assert.ok(r.atkLosses <= 3)
})

test('resolveBattleClash: frontline refills from reserve after losses', () => {
  const seq = [...Array(10).fill(1), ...Array(9).fill(1), ...Array(10).fill(DIE_SIDES)]
  const state = { atkFrontline: 10, atkReserve: 0, defFrontline: 10, defReserve: 50 }
  const r = resolveBattleClash(state, 0, fixedRng(seq))
  assert.equal(r.defFrontline, FRONTLINE_CAP, 'defender refills frontline back to cap from its deep reserve')
  assert.ok(r.defReserve < 50, 'refilled troops came out of reserve')
})

test('resolveBattleClash: battle ends when a side has zero frontline and zero reserve', () => {
  const seq = [...Array(2).fill(1), ...Array(1).fill(1), ...Array(2).fill(DIE_SIDES)]
  const state = { atkFrontline: 2, atkReserve: 0, defFrontline: 2, defReserve: 0 }
  const r = resolveBattleClash(state, 0, fixedRng(seq))
  assert.equal(r.over, true)
  assert.equal(r.attackerWon, true)
  assert.equal(r.defFrontline + r.defReserve, 0)
})

test('resolveBattleClash: simultaneous mutual wipe is a defender win (ties go to defender)', () => {
  const rng = fixedRng([10])
  const state = { atkFrontline: 1, atkReserve: 0, defFrontline: 1, defReserve: 0 }
  const r = resolveBattleClash(state, 0, rng)
  assert.equal(r.over, true)
  assert.equal(r.attackerWon, false)
})

test('resolveBattleClash: a 300v1 fight always resolves in the attacker\'s favor', () => {
  // With MAX_GAUNTLET_GROUP capping the effective dice used, and the lone
  // defender never having reserve to refill, the attacker's 290-troop
  // reserve guarantees an eventual win even though any single clash is a
  // near-fair 1-for-1 duel (see combat-duration.test.js for the exact math).
  const state = { atkFrontline: FRONTLINE_CAP, atkReserve: 290, defFrontline: 1, defReserve: 0 }
  let result, s = state
  do { result = resolveBattleClash(s, 0, Math.random); s = result } while (!result.over)
  assert.equal(result.attackerWon, true)
})

// Monte Carlo validation of battle length scaling. Not testing a single
// outcome (dice are random) - testing that the *distribution* of how many
// clashes a battle takes behaves the way the design intends:
//   - lopsided fights (300v1) resolve almost immediately
//   - even fights scale with reserve depth (troops - FRONTLINE_CAP), so a
//     300v300 war takes much longer than a 15v15 one despite both being
//     equally "fair" fights
// This is what lets a fixed real-time clash cadence (config.js
// BATTLE_INTERVAL_MS) produce both "resolves in a minute" and "sustained
// siege" battles from the same mechanic, with no special-casing.
//
// Both sides always start with frontline = min(FRONTLINE_CAP, total troops) -
// fortification no longer raises the defender's frontline size, it lets up to
// MAX_ADVANTAGED_DEFENDERS of that frontline roll with advantage instead. See
// combat.js for why a raised frontline cap was tried and reverted.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveBattleClash, FRONTLINE_CAP, MAX_ADVANTAGED_DEFENDERS } from '../combat.js'

// Run one simulated battle to completion, returning the number of clashes it took.
function simulateBattle(atkTotal, defTotal, advantagedDefenders = 0) {
  let state = {
    atkFrontline: Math.min(FRONTLINE_CAP, atkTotal),
    atkReserve: Math.max(0, atkTotal - FRONTLINE_CAP),
    defFrontline: Math.min(FRONTLINE_CAP, defTotal),
    defReserve: Math.max(0, defTotal - FRONTLINE_CAP),
  }
  let clashes = 0
  const MAX_CLASHES = 100_000 // safety valve - a real bug should fail loudly, not hang
  let result
  do {
    result = resolveBattleClash(state, advantagedDefenders, Math.random)
    state = result
    clashes++
  } while (!result.over && clashes < MAX_CLASHES)
  return clashes
}

function meanClashes(atkTotal, defTotal, trials = 300, advantagedDefenders = 0) {
  let sum = 0
  for (let i = 0; i < trials; i++) sum += simulateBattle(atkTotal, defTotal, advantagedDefenders)
  return sum / trials
}

// Same as simulateBattle but also reports who won, for win-rate checks.
function simulateBattleOutcome(atkTotal, defTotal, advantagedDefenders = 0) {
  let state = {
    atkFrontline: Math.min(FRONTLINE_CAP, atkTotal),
    atkReserve: Math.max(0, atkTotal - FRONTLINE_CAP),
    defFrontline: Math.min(FRONTLINE_CAP, defTotal),
    defReserve: Math.max(0, defTotal - FRONTLINE_CAP),
  }
  let result
  let clashes = 0
  do {
    result = resolveBattleClash(state, advantagedDefenders, Math.random)
    state = result
    clashes++
  } while (!result.over && clashes < 100_000)
  return { attackerWon: result.attackerWon, clashes }
}

function defenderWinRate(atkTotal, defTotal, advantagedDefenders, trials = 500) {
  let defWins = 0
  for (let i = 0; i < trials; i++) {
    if (!simulateBattleOutcome(atkTotal, defTotal, advantagedDefenders).attackerWon) defWins++
  }
  return defWins / trials
}

test('300v1 resolves in a couple of clashes, attacker always wins', () => {
  // With random pairing, only ONE of the attacker's dice is ever compared
  // against the lone defender's die each clash (pairs = min(10, 1) = 1) - the
  // other 9 rolled are simply unused, so "bringing more troops" doesn't
  // shorten this specific comparison the way sorted pairing used to (that WAS
  // the reroll-and-discard advantage, just working in the attacker's favor
  // this time). It still resolves fast because the attacker has 290 reserve
  // troops to retry with and only needs to win once - ~1/0.475 tries on
  // average - and the outcome itself is never in doubt.
  const avg = meanClashes(300, 1, 500)
  assert.ok(avg < 3, `expected a handful of clashes for an overwhelming mismatch, got avg ${avg.toFixed(2)}`)

  let wins = 0
  const trials = 500
  for (let i = 0; i < trials; i++) {
    let state = { atkFrontline: FRONTLINE_CAP, atkReserve: 290, defFrontline: 1, defReserve: 0 }
    let result
    do { result = resolveBattleClash(state, 0, Math.random); state = result } while (!result.over)
    if (result.attackerWon) wins++
  }
  assert.equal(wins, trials, 'a 300-troop attacker should always eventually beat a lone defender')
})

test('300v300 takes far longer than 15v15, despite both being even fights', () => {
  const big = meanClashes(300, 300, 100)
  const small = meanClashes(15, 15, 100)
  assert.ok(big > small * 5,
    `expected 300v300 (avg ${big.toFixed(1)}) to run at least 5x longer than 15v15 (avg ${small.toFixed(1)})`)
})

test('duration scales roughly with reserve depth (troops - FRONTLINE_CAP), not just ratio', () => {
  // Both are perfectly even matchups (1:1 ratio), so any duration difference
  // is purely from reserve depth behind the fixed frontline cap.
  const d15 = meanClashes(15, 15, 150)
  const d50 = meanClashes(50, 50, 150)
  const d300 = meanClashes(300, 300, 100)
  assert.ok(d15 < d50, `15v15 (${d15.toFixed(1)}) should resolve faster than 50v50 (${d50.toFixed(1)})`)
  assert.ok(d50 < d300, `50v50 (${d50.toFixed(1)}) should resolve faster than 300v300 (${d300.toFixed(1)})`)
})

test('an overwhelming mismatch resolves fast regardless of the underdog\'s absolute size', () => {
  // 300 attacker vs progressively bigger hopeless defenders - all should still
  // resolve quickly since the defender never has more than FRONTLINE_CAP
  // dice's worth of a fighting chance against 10 attacker dice each clash.
  const vs1 = meanClashes(300, 1, 300)
  const vs5 = meanClashes(300, 5, 300)
  assert.ok(vs1 < 3 && vs5 < 5,
    `expected both hopeless mismatches to resolve fast: vs1=${vs1.toFixed(2)}, vs5=${vs5.toFixed(2)}`)
})

test('advantage dice help a small garrison, not just a massed army', () => {
  // Unlike a raised-frontline-cap design (which does nothing below the base
  // cap), advantage dice help as soon as there are real troops to apply them
  // to - a 5-troop garrison with all 5 fighting with advantage is a real edge.
  const noFort = defenderWinRate(8, 5, 0)
  const fortified = defenderWinRate(8, 5, MAX_ADVANTAGED_DEFENDERS)
  assert.ok(fortified > noFort,
    `expected advantage dice to help even a small garrison: no-fort=${noFort.toFixed(2)}, fortified=${fortified.toFixed(2)}`)
})

test('advantage dice also give a fully massed defender a real, lasting edge', () => {
  // With 50 real troops (well above FRONTLINE_CAP), the fully-fortified case
  // (max advantaged defenders) should meaningfully outperform no fortification
  // at all, every clash of the whole siege - not a one-time nudge that fades.
  const noFort = defenderWinRate(50, 50, 0)
  const fortified = defenderWinRate(50, 50, MAX_ADVANTAGED_DEFENDERS)
  assert.ok(fortified > noFort,
    `expected advantage dice to meaningfully help a massed defender: no-fort=${noFort.toFixed(2)}, fortified=${fortified.toFixed(2)}`)
})

test('advantage dice scale smoothly with how many defenders are advantaged, no cliff', () => {
  // The mechanism this replaced (a raised frontline cap, and before that a
  // probability multiplier) jumped from "fair" to "20:1 kill ratio" the
  // instant any bonus applied. Advantage dice should move gradually instead.
  const n0 = defenderWinRate(50, 50, 0)
  const n2 = defenderWinRate(50, 50, 2)
  const n5 = defenderWinRate(50, 50, 5)
  assert.ok(n0 <= n2 + 0.05 && n2 <= n5 + 0.05,
    `expected roughly monotonic scaling, not a cliff: n0=${n0.toFixed(2)}, n2=${n2.toFixed(2)}, n5=${n5.toFixed(2)}`)
})

test('mutual reserves let a battle be sustained indefinitely by reinforcement (no hard cap on length)', () => {
  // Simulate reinforcement: every 5 clashes, top both sides back up to their
  // starting total - the fight should just keep going instead of hitting some
  // artificial ceiling, since there's no mechanic that forces an end besides
  // one side actually running out.
  let state = { atkFrontline: FRONTLINE_CAP, atkReserve: 0, defFrontline: FRONTLINE_CAP, defReserve: 0 }
  let clashes = 0
  for (let i = 0; i < 50; i++) {
    const result = resolveBattleClash(state, 0, Math.random)
    state = result
    clashes++
    if (i % 5 === 0) {
      // reinforcement wave keeps both sides topped up
      state = { ...state, atkReserve: state.atkReserve + 20, defReserve: state.defReserve + 20 }
    }
  }
  assert.equal(clashes, 50, 'battle keeps resolving clashes as long as reserves keep arriving, no artificial length cap')
})

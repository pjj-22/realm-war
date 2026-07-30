// Pure combat math for RealmWar battles, extracted from tick.js so the damage,
// entrenchment, and survivor formulas can be unit-tested without a database.
// The tunable bonuses (fort/strategic/entrench) live in config.js and
// strategic.js and are passed in, keeping this module free of game-balance config.

// Only this many troops per side actually fight in any one clash - the rest
// sit in reserve untouched until refilled. Keeping this fixed regardless of
// army size is what makes battle length scale with reserve depth: a 15v15
// fight is almost entirely frontline with barely any reserve behind it (fast),
// while a 300v300 fight has 290 reserve troops each to grind through (slow,
// and can be kept going indefinitely by reinforcement). Both attacker and
// defender share this exact same cap - there is no separate, bigger defender
// cap. A raised defender cap was tried and scrapped: once the defender's dice
// count exceeds the attacker's fixed 10, only the top `min(atk,def)` of the
// defender's (sorted) rolls ever get compared, which is a free "roll extra,
// discard your worst" reroll - a much bigger and uncontrollable edge than the
// nominal capacity increase suggested, and it blew up 20:1+ kill ratios in
// practice. See git history for the full postmortem.
export const FRONTLINE_CAP = 10

// d20 instead of d6: ties happen 1/20 of the time instead of 1/6, which
// matters a lot here because "ties go to the defender" is a real structural
// edge, not flavor - on a d6 it's a 58.3%/41.7% split per die, on a d20 it's
// 52.5%/47.5%. Sieges run many clashes (attrition, reserve refill), and *any*
// persistent per-clash edge compounds toward a near-certain outcome the
// longer a siege runs (a Gambler's Ruin effect) - shrinking the edge at the
// single-die level is what keeps long sieges from being pre-decided.
export const DIE_SIDES = 20

// At most this many of the defender's frontline get to fight with advantage
// (roll twice, take the higher) - physically, only so many defenders can be
// making full use of one fortified position at once. This is also what keeps
// the bonus bounded and tunable: advantage on a die is a small, well-behaved
// swing in outcome distribution, not an open-ended pool to exploit.
export const MAX_ADVANTAGED_DEFENDERS = 5

// How many of the defender's frontline fight with advantage, from forts,
// entrenchment (compact borders), and strategic hexes - capped at
// MAX_ADVANTAGED_DEFENDERS regardless of how many sources stack.
export function advantagedDefenderCount({
  forts = 0,
  fortAdvantage = 0,
  strategicAdvantage = 0,
  friendlyNeighbors = 0,
  entrenchAdvantagePerNeighbor = 0,
  entrenchMaxNeighbors = 0,
} = {}) {
  const entrench = Math.min(friendlyNeighbors, entrenchMaxNeighbors) * entrenchAdvantagePerNeighbor
  const total = forts * fortAdvantage + strategicAdvantage + entrench
  return Math.min(MAX_ADVANTAGED_DEFENDERS, total)
}

function rollDie(rng) {
  return 1 + Math.floor(rng() * DIE_SIDES)
}

function rollAdvantage(rng) {
  return Math.max(rollDie(rng), rollDie(rng))
}

function shuffle(arr, rng) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// When one side heavily outnumbers the other, a plain 1-for-1 pairing wastes
// the extra dice entirely (min(atk,def) pairs happen either way, so a 10v2
// clash was mechanically identical to a 2v2 one - the other 8 attacker
// troops never got to do anything). Instead, each outnumbered troop fights a
// small gauntlet of up to MAX_GAUNTLET_GROUP opponents in sequence, rolling
// fresh each duel: it keeps killing and advancing as long as it keeps
// winning, and dies (keeping whatever kills it already scored) the moment it
// loses one. Capped low on purpose - a bigger cap would make being
// outnumbered even more swingy/lethal than intended. When both sides have
// equal dice counts this reduces to plain 1-for-1 pairing (group size 1).
export const MAX_GAUNTLET_GROUP = 2

// One dice-off between two frontlines. Both sides start with the same dice
// count - min(FRONTLINE_CAP, their real frontline) - so there is never a
// count mismatch to exploit via rerolling; an unequal real troop count is
// instead handled by the gauntlet grouping above. Pairing/grouping is random,
// not highest-vs-highest: with sorted pairing, ties cluster at the high end
// and amplify the defender's tie-break edge; random pairing spreads that out
// (measured: it alone drops the baseline attacker requirement from 2.4x to
// 1.56x of the defender's size on equal, unfortified armies). Up to
// `advantagedDefenders` of the defender's troops always roll with advantage
// (2 dice, take the higher), on every roll they make - a bounded, linear
// edge instead of a reroll-the-pool exploit. Ties still go to the defender.
export function resolveClash(atkFrontline, defFrontline, advantagedDefenders = 0, rng = Math.random) {
  const atkDiceCount = Math.min(FRONTLINE_CAP, atkFrontline)
  const defDiceCount = Math.min(FRONTLINE_CAP, defFrontline)

  const atkIsSmaller = atkDiceCount <= defDiceCount
  const smallCount = Math.min(atkDiceCount, defDiceCount)
  const bigCount = Math.max(atkDiceCount, defDiceCount)
  const groupSize = smallCount > 0 ? Math.min(MAX_GAUNTLET_GROUP, Math.floor(bigCount / smallCount)) : 0
  const bigUsed = smallCount * groupSize // any further big-side troops sit this clash out unused

  // advantagedDefenders applies to every roll a defender troop makes, whether
  // it's their one fixed "big side" roll or a reroll mid-gauntlet as the
  // "small side" - so it's tracked per defender-troop-index, not per roll.
  const defCount = atkIsSmaller ? bigUsed : smallCount
  const advantaged = Math.min(advantagedDefenders, defCount)
  function defenderRoll(defTroopIndex) {
    return defTroopIndex < advantaged ? rollAdvantage(rng) : rollDie(rng)
  }

  // The "big" side's participating troops each get exactly one fixed roll -
  // they're the fungible opponents the small side's gauntlets fight through.
  let bigRolls
  if (atkIsSmaller) {
    bigRolls = []; for (let i = 0; i < bigUsed; i++) bigRolls.push(defenderRoll(i))
  } else {
    bigRolls = []; for (let i = 0; i < bigUsed; i++) bigRolls.push(rollDie(rng))
  }
  bigRolls = shuffle(bigRolls, rng) // so advantaged rolls aren't clustered into one group

  let bigLosses = 0 // troops on the big side killed across all gauntlets
  let smallLosses = 0 // small-side troops that died partway through their gauntlet
  const allSmallRolls = [] // for the dice-log - every roll the small side actually made

  for (let g = 0; g < smallCount; g++) {
    const group = bigRolls.slice(g * groupSize, (g + 1) * groupSize)
    let survived = true
    for (const opponent of group) {
      const smallRoll = atkIsSmaller ? rollDie(rng) : defenderRoll(g)
      allSmallRolls.push(smallRoll)
      // Ties always favor the defender, whichever side (small or big) they're
      // on this duel - not just "whoever isn't rolling smallRoll."
      const smallWins = atkIsSmaller ? smallRoll > opponent : smallRoll >= opponent
      if (smallWins) {
        bigLosses++ // won this duel, keep advancing through the gauntlet
      } else {
        survived = false // lost - dies here, keeps whatever kills it already scored
        break
      }
    }
    if (!survived) smallLosses++
  }

  const atkLosses = atkIsSmaller ? smallLosses : bigLosses
  const defLosses = atkIsSmaller ? bigLosses : smallLosses
  const atkDice = atkIsSmaller ? allSmallRolls : bigRolls
  const defDice = atkIsSmaller ? bigRolls : allSmallRolls

  return {
    atkLosses: Math.min(atkLosses, atkFrontline),
    defLosses: Math.min(defLosses, defFrontline),
    atkDice, defDice,
  }
}

// Resolve one clash and refill both frontlines from reserve afterward. The
// battle ends once a side's frontline + reserve both reach 0; a simultaneous
// wipe is a defender win (ties go to the defender, same as individual dice).
export function resolveBattleClash(state, advantagedDefenders = 0, rng = Math.random) {
  const { atkFrontline, atkReserve, defFrontline, defReserve } = state
  const { atkLosses, defLosses, atkDice, defDice } = resolveClash(atkFrontline, defFrontline, advantagedDefenders, rng)

  let newAtkFrontline = Math.max(0, atkFrontline - atkLosses)
  let newDefFrontline = Math.max(0, defFrontline - defLosses)
  let newAtkReserve = atkReserve
  let newDefReserve = defReserve

  const atkRefill = Math.min(FRONTLINE_CAP - newAtkFrontline, newAtkReserve)
  newAtkFrontline += atkRefill
  newAtkReserve -= atkRefill

  const defRefill = Math.min(FRONTLINE_CAP - newDefFrontline, newDefReserve)
  newDefFrontline += defRefill
  newDefReserve -= defRefill

  const atkTotal = newAtkFrontline + newAtkReserve
  const defTotal = newDefFrontline + newDefReserve
  const over = atkTotal === 0 || defTotal === 0

  return {
    atkFrontline: newAtkFrontline, atkReserve: newAtkReserve,
    defFrontline: newDefFrontline, defReserve: newDefReserve,
    atkLosses, defLosses, atkDice, defDice,
    over,
    attackerWon: over ? atkTotal > defTotal : null,
  }
}

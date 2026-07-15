// Pure combat math for RealmWar battles, extracted from tick.js so the damage,
// entrenchment, and survivor formulas can be unit-tested without a database.
// The tunable bonuses (fort/strategic/entrench/damage-rate) live in config.js and
// strategic.js and are passed in, keeping this module free of game-balance config.

// Defensive multiplier applied to a hex's raw troop count when it is attacked.
// Built from forts (+fortBonus each), a strategic-hex bonus, and entrenchment
// (+entrenchPerNeighbor per adjacent friendly hex, capped at entrenchMaxNeighbors).
export function defenseMultiplier({
  forts = 0,
  fortBonus = 0,
  strategicBonus = 0,
  friendlyNeighbors = 0,
  entrenchPerNeighbor = 0,
  entrenchMaxNeighbors = 0,
} = {}) {
  const entrench = Math.min(friendlyNeighbors, entrenchMaxNeighbors) * entrenchPerNeighbor
  return 1 + forts * fortBonus + strategicBonus + entrench
}

// One simultaneous battle round. Each side loses `damageRate` of the *other* side's
// current strength (both computed from the pre-round strengths, so the exchange is
// simultaneous). Returns the raw damage dealt by each side, the new strengths
// (floored at 0), whether the battle ended, and — if it did — whether the attacker won.
export function resolveRound(atkStr, defStr, damageRate) {
  const atkDmg = atkStr * damageRate // damage the attacker deals to the defender
  const defDmg = defStr * damageRate // damage the defender deals to the attacker
  const newAtkStr = Math.max(0, atkStr - defDmg)
  const newDefStr = Math.max(0, defStr - atkDmg)
  const over = newAtkStr <= 0 || newDefStr <= 0
  return { atkDmg, defDmg, newAtkStr, newDefStr, over, attackerWon: over ? newAtkStr > newDefStr : null }
}

// Troops the winning side keeps after a decisive round: proportional to the fraction
// of strength that survived. Guards keep it at 0 for empty/annihilated stacks.
export function survivorCount(totalQty, remainingStr, originalStr) {
  if (totalQty <= 0 || originalStr <= 0 || remainingStr <= 0) return 0
  return Math.round(totalQty * (remainingStr / originalStr))
}

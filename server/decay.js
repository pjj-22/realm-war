// Which of a player's hexes are open to border decay this tick (tick.js
// processDecay). Pure so the rule can be tested: a hex is a candidate when its
// garrison - plus BUILDING_GARRISON_VALUE if it has a finished building - is
// below the empire's required garrison. The capital is never a candidate.
//
//   hexes:   [{ h3_index, garrison }]   troops on each hex the player owns
//   built:   Set<h3>                    hexes with a finished building
export function decayCandidates(hexes, built, { required, buildingValue, capitalHex }) {
  return hexes.filter(h =>
    h.h3_index !== capitalHex &&
    h.garrison + (built.has(h.h3_index) ? buildingValue : 0) < required
  )
}

// Evens out garrisons between neighbouring hexes for "redistribute troops"
// (routes/military.js POST /redistribute). Pure - the route gathers the
// garrisons and sends the armies.
//
// It's diffusion: over a few passes every pair of neighbouring hexes trades
// troops from the fuller one toward the emptier one. The pair share is
// (difference) / (1 + the larger neighbour count of the two), so a hex with
// many lower neighbours can't hand out more than it has - and two lone
// neighbours settle at their average (60 next to 30 -> 45 and 45). Flows are
// summed per pair across the passes, so a hex in the middle of a slope both
// receives and passes on troops in one go (60-30-20: the 30 gets from the 60
// and sends some on to the 20), then each pair becomes one army.
//
//   troops:    Map<h3, number>          garrison of every hex taking part
//   neighbors: (h3) => h3[]             adjacent hexes (non-participants are ignored)
//   options:   keep      - a hex is never left below this
//              canSend   - (h3) => bool, false for hexes that must hold (under attack)
//              passes    - smoothing passes (default 4)
//              minMove   - skip armies smaller than this (default 5)
export function planRedistribute(troops, neighbors, { keep = 1, canSend = () => true, passes = 4, minMove = 5 } = {}) {
  const nodes = [...troops.keys()]
  const adj = new Map(nodes.map(h => [h, neighbors(h).filter(n => troops.has(n) && n !== h)]))
  const q = new Map(troops)
  const net = new Map() // 'a|b' (a < b) -> troops flowing a -> b (negative: b -> a)

  for (let pass = 0; pass < passes; pass++) {
    const delta = new Map()
    for (const a of nodes) {
      for (const b of adj.get(a)) {
        if (a >= b) continue
        const f = (q.get(a) - q.get(b)) / (1 + Math.max(adj.get(a).length, adj.get(b).length))
        if (f === 0) continue
        const key = `${a}|${b}`
        net.set(key, (net.get(key) || 0) + f)
        delta.set(a, (delta.get(a) || 0) - f)
        delta.set(b, (delta.get(b) || 0) + f)
      }
    }
    for (const [h, d] of delta) q.set(h, q.get(h) + d)
  }

  // One army per pair, from the fuller side
  let moves = []
  for (const [key, f] of net) {
    const [a, b] = key.split('|')
    const qty = Math.floor(Math.abs(f))
    if (qty < minMove) continue
    moves.push(f > 0 ? { fromHex: a, toHex: b, quantity: qty } : { fromHex: b, toHex: a, quantity: qty })
  }

  // Armies leave at the same moment, so a hex can only send what it holds now:
  // scale a sender's armies down if together they'd take it below `keep`
  const out = new Map()
  for (const m of moves) out.set(m.fromHex, (out.get(m.fromHex) || 0) + m.quantity)
  moves = moves.map(m => {
    const spare = canSend(m.fromHex) ? Math.max(0, troops.get(m.fromHex) - keep) : 0
    const total = out.get(m.fromHex)
    return total > spare ? { ...m, quantity: Math.floor(m.quantity * spare / total) } : m
  }).filter(m => m.quantity >= minMove)

  // Predicted garrisons once everything has landed
  const after = new Map(troops)
  for (const m of moves) {
    after.set(m.fromHex, after.get(m.fromHex) - m.quantity)
    after.set(m.toHex, after.get(m.toHex) + m.quantity)
  }
  const range = (map) => {
    const v = [...map.values()]
    return v.length ? { min: Math.min(...v), max: Math.max(...v) } : { min: 0, max: 0 }
  }
  return { moves: moves.sort((a, b) => b.quantity - a.quantity), before: range(troops), after: range(after) }
}

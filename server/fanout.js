// Picks which of a player's hexes send troops to which neighbouring target
// hexes for a "fan out" order (routes/military.js POST /fan-out). Pure - the
// route gathers the data (spare troops per source, candidate targets with the
// force each needs) and executes the plan.
//
// Greedy, one army per target: targets with the fewest sources in reach that
// can afford them go first (so a hex only one source can reach isn't starved
// by a well-connected one), and each is served by the NEAREST source that can
// afford it (ties: the one with the most spare troops left). Claims are planned before attacks so spare
// troops go to safe land grabs first.
//
//   spare:     Map<h3, number>            troops each source can send
//   targets:   [{ h3, cost, kind }]       kind is 'claim' | 'attack'
//   neighbors: (h3) => sources in reach of a target, as h3 strings (distance 1)
//              or { h3, d } with d the distance in hexes
export function planFanOut(spare, targets, neighbors) {
  const left = new Map(spare)
  const plan = []
  const norm = x => (typeof x === 'string' ? { h3: x, d: 1 } : x)
  const options = (t) => neighbors(t.h3).map(norm).filter(o => (left.get(o.h3) || 0) >= t.cost)
  for (const kind of ['claim', 'attack']) {
    const ordered = targets
      .filter(t => t.kind === kind)
      .map(t => ({ t, n: options(t).length }))
      .filter(x => x.n > 0)
      .sort((a, b) => a.n - b.n)
      .map(x => x.t)
    for (const t of ordered) {
      const best = options(t).sort((a, b) => a.d - b.d || left.get(b.h3) - left.get(a.h3))[0]
      if (!best) continue
      const from = best.h3
      left.set(from, left.get(from) - t.cost)
      plan.push({ fromHex: from, toHex: t.h3, quantity: t.cost, kind })
    }
  }
  return plan
}

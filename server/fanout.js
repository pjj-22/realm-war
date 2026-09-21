// Picks which of a player's hexes send troops to which neighbouring target
// hexes for a "fan out" order (routes/military.js POST /fan-out). Pure - the
// route gathers the data (spare troops per source, candidate targets with the
// force each needs) and executes the plan.
//
// Greedy, one army per target: targets with the fewest adjacent sources that
// can afford them go first (so a hex only one neighbour can reach isn't
// starved by a well-connected one), and each is served by the adjacent source
// with the most spare troops left. Claims are planned before attacks so spare
// troops go to safe land grabs first.
//
//   spare:     Map<h3, number>            troops each source can send
//   targets:   [{ h3, cost, kind }]       kind is 'claim' | 'attack'
//   neighbors: (h3) => h3[]               grid neighbours of a target
export function planFanOut(spare, targets, neighbors) {
  const left = new Map(spare)
  const plan = []
  const options = (t) => neighbors(t.h3).filter(h => (left.get(h) || 0) >= t.cost)
  for (const kind of ['claim', 'attack']) {
    const ordered = targets
      .filter(t => t.kind === kind)
      .map(t => ({ t, n: options(t).length }))
      .filter(x => x.n > 0)
      .sort((a, b) => a.n - b.n)
      .map(x => x.t)
    for (const t of ordered) {
      const from = options(t).sort((a, b) => left.get(b) - left.get(a))[0]
      if (!from) continue
      left.set(from, left.get(from) - t.cost)
      plan.push({ fromHex: from, toHex: t.h3, quantity: t.cost, kind })
    }
  }
  return plan
}

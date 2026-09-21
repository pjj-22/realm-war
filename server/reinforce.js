// Plans which hexes send troops to which threatened hexes for "reinforce
// threatened" (routes/military.js POST /reinforce). Pure - the route gathers
// threats and spare troops and does the real routing/launching.
//
// Threats are served soonest-deadline first. Each takes troops from the
// nearest hexes that can plausibly arrive before its deadline (travelMs is an
// estimate; the route re-checks against the real path), up to what it still
// needs, at most MAX_SOURCES_PER_THREAT sources so a threat isn't fed by a
// dozen tiny trickles.
//
//   threats:  [{ h3, need, deadline }]   deadline is epoch ms
//   spare:    Map<h3, number>            troops each hex can give
//   travelMs: (from, to) => number       estimated march time
export const MAX_SOURCES_PER_THREAT = 10

export function planReinforce(threats, spare, travelMs, now = Date.now()) {
  const left = new Map(spare)
  const plan = []
  const short = []
  for (const t of [...threats].sort((a, b) => a.deadline - b.deadline)) {
    let need = t.need
    const candidates = [...left.entries()]
      .filter(([, q]) => q > 0)
      .map(([h3, q]) => ({ h3, q, ms: travelMs(h3, t.h3) }))
      .filter(c => now + c.ms <= t.deadline)
      .sort((a, b) => a.ms - b.ms)
      .slice(0, MAX_SOURCES_PER_THREAT)
    for (const c of candidates) {
      if (need <= 0) break
      const send = Math.min(c.q, need)
      left.set(c.h3, c.q - send)
      plan.push({ fromHex: c.h3, toHex: t.h3, quantity: send, deadline: t.deadline })
      need -= send
    }
    if (need > 0) short.push({ h3: t.h3, short: need })
  }
  return { plan, short }
}

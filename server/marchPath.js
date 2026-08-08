import { gridDisk, gridDistance, gridPathCells, cellToLatLng, getResolution, getHexagonEdgeLengthAvg } from 'h3-js'
import { isOcean } from './terrain.js'
import { OCEAN_MARCH_MULTIPLIER } from './config.js'

// Weighted-shortest-path routing: ocean costs OCEAN_MARCH_MULTIPLIER per hex
// instead of 1, so a longer route that stays on land can beat a short cut
// across water when it's actually faster. Standard A* - gridDistance is a
// valid admissible heuristic here since the cheapest possible edge is 1
// (land), so it can never overestimate the true remaining weighted cost.
//
// Bounded by MAX_EXPANDED: a genuinely unavoidable ocean crossing (no land
// route exists at all, e.g. between continents) makes A* explore broadly
// along coastlines hunting for the shortest crossing point, which is
// expensive but still bounded - if it blows past the cap, fall back to the
// old straight-line gridPathCells rather than let one march order hang.
// This runs once per march order (not per tick), so the cost is bounded by
// how often marches are sent, not simulation frequency - but with ~200 bots
// marching continuously, an unbounded search here would still add up fast.
const MAX_EXPANDED = 4000

// h3-js's gridDistance/gridPathCells use a local IJ coordinate system that
// straight-up throws for sufficiently distant cells (confirmed: Paris-Cairo
// (~2900km) succeeds, Paris-Delhi fails) - a real, pre-existing limitation
// the march system already silently depended on before any of this, since
// the old duration formula called gridDistance directly with no fallback at
// all. With bot capitals now spread across every continent, cross-continent
// marches are a real path here, not a hypothetical, so this needs an actual
// fallback rather than just not crashing.
function haversineHexEstimate(hexA, hexB) {
  const [latA, lngA] = cellToLatLng(hexA)
  const [latB, lngB] = cellToLatLng(hexB)
  const toRad = d => d * Math.PI / 180
  const R = 6371
  const dLat = toRad(latB - latA), dLng = toRad(lngB - lngA)
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(latA)) * Math.cos(toRad(latB)) * Math.sin(dLng / 2) ** 2
  const km = 2 * R * Math.asin(Math.sqrt(s))
  const edgeKm = getHexagonEdgeLengthAvg(getResolution(hexA), 'km')
  return Math.max(1, Math.round(km / edgeKm))
}

function safeGridDistance(a, b) {
  try { return gridDistance(a, b) } catch { return haversineHexEstimate(a, b) }
}

function stepCost(hex) {
  return isOcean(hex) ? OCEAN_MARCH_MULTIPLIER : 1
}

function reconstructPath(cameFrom, current) {
  const path = [current]
  while (cameFrom.has(current)) {
    current = cameFrom.get(current)
    path.push(current)
  }
  return path.reverse()
}

function fallbackPath(fromHex, toHex) {
  let path
  try { path = gridPathCells(fromHex, toHex) } catch { path = null }
  if (path) {
    const stepCosts = path.slice(1).map(stepCost)
    return { path, stepCosts, cost: stepCosts.reduce((a, b) => a + b, 0) }
  }
  // h3 can't even compute a straight path between these two (too far apart)
  // - no way to know the real terrain mix along an unrenderable route, so
  // assume land speed throughout rather than guess at an ocean penalty that
  // has no basis. A straight 2-point line is what the client draws; the
  // synthetic per-hex cost is what makes the arrival time still realistic
  // instead of "instant" for a genuinely transcontinental march.
  const estHexes = haversineHexEstimate(fromHex, toHex)
  return { path: [fromHex, toHex], stepCosts: Array(estHexes).fill(1), cost: estHexes }
}

export function findMarchPath(fromHex, toHex) {
  if (fromHex === toHex) return { path: [fromHex], stepCosts: [], cost: 0 }

  // If h3 can't even compute the distance between the endpoints, it can't
  // compute distances for the (many) intermediate nodes A* would visit
  // either - every safeGridDistance call inside the loop would silently
  // fall back to the much slower haversine path, and the degraded heuristic
  // guidance means the search explores far more broadly before giving up.
  // Measured: running A* to its MAX_EXPANDED cap for a pair like this took
  // 4+ seconds. Detecting it upfront and skipping straight to the fallback
  // is <1ms instead - no reason to run a search that's already known to be
  // futile just to discover that 4000 nodes later.
  let startHeuristic
  try { startHeuristic = gridDistance(fromHex, toHex) } catch { return fallbackPath(fromHex, toHex) }

  const open = [fromHex]
  const inOpen = new Set([fromHex])
  const closed = new Set()
  const gScore = new Map([[fromHex, 0]])
  const fScore = new Map([[fromHex, startHeuristic]])
  const cameFrom = new Map()
  let expanded = 0

  while (open.length > 0) {
    // Linear-scan min-extraction - open stays small under MAX_EXPANDED, so a
    // real heap isn't worth the extra code for what's already a bounded loop.
    let bestIdx = 0
    for (let i = 1; i < open.length; i++) {
      if ((fScore.get(open[i]) ?? Infinity) < (fScore.get(open[bestIdx]) ?? Infinity)) bestIdx = i
    }
    const current = open.splice(bestIdx, 1)[0]
    inOpen.delete(current)

    if (current === toHex) {
      const path = reconstructPath(cameFrom, current)
      const stepCosts = path.slice(1).map(stepCost)
      return { path, stepCosts, cost: gScore.get(current) }
    }

    closed.add(current)
    expanded++
    if (expanded > MAX_EXPANDED) return fallbackPath(fromHex, toHex)

    for (const neighbor of gridDisk(current, 1)) {
      if (neighbor === current || closed.has(neighbor)) continue
      const tentativeG = gScore.get(current) + stepCost(neighbor)
      if (tentativeG < (gScore.get(neighbor) ?? Infinity)) {
        cameFrom.set(neighbor, current)
        gScore.set(neighbor, tentativeG)
        fScore.set(neighbor, tentativeG + safeGridDistance(neighbor, toHex))
        if (!inOpen.has(neighbor)) { open.push(neighbor); inOpen.add(neighbor) }
      }
    }
  }
  // Open set exhausted with no path found (shouldn't happen on a connected
  // grid short of the resolution-0 edge cases) - fall back rather than error.
  return fallbackPath(fromHex, toHex)
}

// Per-step costs for an already-known path (e.g. one stored on an army row),
// without re-running the search - just re-derives cost per hop from terrain,
// which is O(path length) and reuses terrain.js's own isOcean cache.
export function pathStepCosts(path) {
  return path.slice(1).map(stepCost)
}

// Mirrors the client's armyPathPos (GameMap.jsx) - same weighted-progress
// math, but snapped to a discrete hex rather than lerped screen position.
// That's the point of this module: make "what hex is this army in right
// now" a real, queryable server-side fact instead of only a rendering
// trick, so future mechanics (interception, a watchtower revealing a
// passing army) have something to hook into.
export function currentMarchHex(army, path, stepCosts) {
  path ??= army.path
  stepCosts ??= path ? pathStepCosts(path) : null
  if (!path || path.length === 0) return army.to_hex
  if (path.length === 1 || !stepCosts?.length) return path[0]

  const total = new Date(army.arrives_at) - new Date(army.departed_at)
  const elapsed = Date.now() - new Date(army.departed_at)
  const progress = total > 0 ? Math.min(1, Math.max(0, elapsed / total)) : 1
  const totalCost = stepCosts.reduce((a, b) => a + b, 0)
  const targetCost = progress * totalCost

  let cum = 0
  for (let i = 0; i < stepCosts.length; i++) {
    if (cum + stepCosts[i] >= targetCost || i === stepCosts.length - 1) return path[i + 1]
    cum += stepCosts[i]
  }
  return path[path.length - 1]
}

import { gridDisk, gridDiskDistances } from 'h3-js'
import { pool } from './db.js'
import { MIN_TROOPS_TO_CLAIM, MASS_MARCH_MAX_SOURCES } from './config.js'
import { isOcean } from './terrain.js'
import { buildVisibleSet, canSeeDetail } from './visibility.js'
import { planFanOut } from './fanout.js'

// Which of `sources` (hexes the player owns) should send troops where, for a
// fan-out. `range` is how many hexes away a target may pull troops from (1 =
// only hexes touching it); the nearest hex that can afford it sends. Every
// army carries exactly `perTarget` troops - the player's number,
// no auto-sizing - and a source only sends if that still leaves it at or above
// `keep`. perTarget goes to each unclaimed neighbour (to claim; it must be at
// least MIN_TROOPS_TO_CLAIM) and, in 'attack'/'both' mode, to each visible enemy
// neighbour, but only where perTarget covers 1.5x the garrison + 2 (a smaller
// force would just die). mode is 'claim' | 'attack' | 'both'. Allies, ocean,
// hexes under siege and hexes one of the player's armies is already heading for
// are skipped. Returns { plan, senders, maxSpare, targets }: the plan (see
// fanout.js planFanOut), how many hexes could afford perTarget, the most any
// one hex could spare, and how many targets qualified - so an empty plan can
// say why. Nothing is sent.
export async function gatherFanOut(me, { sources, keep, mode, perTarget, range = 1 }) {
  const type = 'troop'
  const owned = await pool.query('SELECT h3_index FROM hexes WHERE owner_id=$1', [me])
  const ownedSet = new Set(owned.rows.map(r => r.h3_index))
  const wanted = [...new Set(sources)].filter(h => typeof h === 'string' && ownedSet.has(h)).slice(0, MASS_MARCH_MAX_SOURCES)

  const garrisons = await pool.query(
    'SELECT h3_index, quantity FROM troops WHERE owner_id=$1 AND type=$2 AND h3_index = ANY($3)', [me, type, wanted])
  const allSpare = garrisons.rows.map(r => [r.h3_index, r.quantity - keep])
  const maxSpare = allSpare.reduce((m, [, q]) => Math.max(m, q), 0)
  const spare = new Map(allSpare.filter(([, q]) => q >= perTarget))
  if (spare.size === 0) return { plan: [], senders: 0, maxSpare, targets: 0 }

  // Candidate targets: every non-owned hex next to any hex you own. (Not just
  // next to the sources - with a reach above 1, an interior hex can supply a
  // border target it doesn't touch.)
  const candidates = new Set()
  for (const h of ownedSet) for (const n of gridDisk(h, 1)) if (!ownedSet.has(n)) candidates.add(n)
  const candList = [...candidates].filter(h => !isOcean(h))

  const [hexRows, garr, battles, mine, alliance] = await Promise.all([
    pool.query('SELECT h.h3_index, h.owner_id, p.alliance_id FROM hexes h JOIN players p ON p.id = h.owner_id WHERE h.h3_index = ANY($1)', [candList]),
    pool.query('SELECT h3_index, owner_id, SUM(quantity)::int AS qty FROM troops WHERE h3_index = ANY($1) GROUP BY h3_index, owner_id', [candList]),
    pool.query("SELECT h3_index FROM battles WHERE status='active' AND h3_index = ANY($1)", [candList]),
    pool.query("SELECT DISTINCT to_hex FROM armies WHERE owner_id=$1 AND status='marching' AND to_hex = ANY($2)", [me, candList]),
    pool.query('SELECT alliance_id FROM players WHERE id=$1', [me]),
  ])
  const myAlliance = alliance.rows[0]?.alliance_id
  const ownerOf = new Map(hexRows.rows.map(r => [r.h3_index, r]))
  const defenders = new Map(garr.rows.map(r => [`${r.h3_index}|${r.owner_id}`, r.qty]))
  const besieged = new Set(battles.rows.map(r => r.h3_index))
  const enRoute = new Set(mine.rows.map(r => r.to_hex))
  const visible = await buildVisibleSet(me)
  const now = new Date()

  const targets = []
  for (const h of candList) {
    if (besieged.has(h) || enRoute.has(h)) continue
    const o = ownerOf.get(h)
    if (!o) {
      if (mode !== 'attack') targets.push({ h3: h, cost: perTarget, kind: 'claim' })
    } else if (mode !== 'claim' && !(myAlliance && o.alliance_id === myAlliance) && canSeeDetail(h, visible, false, now)) {
      const needed = Math.ceil((defenders.get(`${h}|${o.owner_id}`) || 0) * 1.5) + 2
      if (perTarget >= needed) targets.push({ h3: h, cost: perTarget, kind: 'attack' })
    }
  }
  // Sources in reach of a target: every hex within `range` steps, with its distance
  const inReach = (h3) => gridDiskDistances(h3, range).flatMap((ring, d) => (d === 0 ? [] : ring.map(cell => ({ h3: cell, d }))))
  return { plan: planFanOut(spare, targets, inReach), senders: spare.size, maxSpare, targets: targets.length }
}

import { gridDisk } from 'h3-js'
import { pool } from './db.js'
import { MIN_TROOPS_TO_CLAIM, MASS_MARCH_MAX_SOURCES } from './config.js'
import { isOcean } from './terrain.js'
import { buildVisibleSet, canSeeDetail } from './visibility.js'
import { planFanOut } from './fanout.js'

// Which of `sources` (hexes the player owns) should send troops where, for a
// fan-out: unclaimed neighbours to claim (MIN_TROOPS_TO_CLAIM each) and/or
// enemy neighbours to attack (1.5x the visible garrison + 2). mode is
// 'claim' | 'attack' | 'both'. Attacks are only planned where the defender's
// garrison is currently visible. Allies, ocean, hexes under siege and hexes one
// of the player's armies is already heading for are skipped. Returns the plan
// (see fanout.js planFanOut); nothing is sent.
export async function gatherFanOut(me, { sources, keep, mode }) {
  const type = 'troop'
  const owned = await pool.query('SELECT h3_index FROM hexes WHERE owner_id=$1', [me])
  const ownedSet = new Set(owned.rows.map(r => r.h3_index))
  const wanted = [...new Set(sources)].filter(h => typeof h === 'string' && ownedSet.has(h)).slice(0, MASS_MARCH_MAX_SOURCES)

  const garrisons = await pool.query(
    'SELECT h3_index, quantity FROM troops WHERE owner_id=$1 AND type=$2 AND h3_index = ANY($3)', [me, type, wanted])
  const spare = new Map(garrisons.rows.map(r => [r.h3_index, r.quantity - keep]).filter(([, q]) => q >= MIN_TROOPS_TO_CLAIM))
  if (spare.size === 0) return []

  // Candidate targets: neighbours of the sources that can actually afford something
  const candidates = new Set()
  for (const h of spare.keys()) for (const n of gridDisk(h, 1)) if (n !== h && !ownedSet.has(n)) candidates.add(n)
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
      if (mode !== 'attack') targets.push({ h3: h, cost: MIN_TROOPS_TO_CLAIM, kind: 'claim' })
    } else if (mode !== 'claim' && !(myAlliance && o.alliance_id === myAlliance) && canSeeDetail(h, visible, false, now)) {
      targets.push({ h3: h, cost: Math.ceil((defenders.get(`${h}|${o.owner_id}`) || 0) * 1.5) + 2, kind: 'attack' })
    }
  }
  return planFanOut(spare, targets, h => gridDisk(h, 1))
}

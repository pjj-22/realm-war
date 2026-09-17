// Real fog-of-war enforcement, server-side. Ported from the client's
// buildVisibleSet (client/src/components/GameMap.jsx) rather than invented
// fresh - own hexes + allies' hexes, expanded by a ring, unioned into a set.
// Until this existed, every hex/army/battle endpoint sent real numbers to
// everyone and the client just chose not to render them - a network-tab
// away from useless. Night darkness (isDark) is a second, independent gate
// on top of the same visibility set, not a separate mechanism.
import { gridDisk, cellToLatLng } from 'h3-js'
import { pool } from './db.js'

export async function buildVisibleSet(playerId, ring = 1, client = pool) {
  const { rows } = await client.query(`
    SELECT h.h3_index
    FROM hexes h
    JOIN players p ON p.id = h.owner_id
    WHERE p.id = $1
       OR (p.alliance_id IS NOT NULL
           AND p.alliance_id = (SELECT alliance_id FROM players WHERE id = $1))
  `, [playerId])

  const visible = new Set()
  for (const { h3_index } of rows) {
    for (const cell of gridDisk(h3_index, ring)) visible.add(cell)
  }
  return visible
}

// Local hour at a hex, from its longitude - a rough UTC-offset approximation
// (15 degrees per hour), not a real timezone lookup. Good enough for a game
// mechanic, and deliberately dependency-free.
const DAY_START_HOUR = 6
const DAY_END_HOUR = 20
export function isDark(h3Index, now = new Date()) {
  const [, lng] = cellToLatLng(h3Index)
  const offsetHours = Math.round(lng / 15)
  const localHour = (now.getUTCHours() + offsetHours + 24) % 24
  return localHour < DAY_START_HOUR || localHour >= DAY_END_HOUR
}

// The single check every endpoint should use before sending real numbers for
// a hex. `projected` carries over unchanged from the existing client concept
// (huge garrisons/empires can't hide, GameMap.jsx buildClaimedPoints) - it
// overrides the visibility-ring check but not darkness. `isOwner` bypasses
// everything, including darkness: hiding a player's own numbers from
// themselves at night is theater, not security - they can already see the
// real number by clicking their own garrison (a different, unredacted query
// - see BottomDrawer's TerritoryPanel), so the map may as well show it too.
export function canSeeDetail(h3Index, visibleSet, projected = false, now = new Date(), isOwner = false) {
  if (isOwner) return true
  return (visibleSet.has(h3Index) || projected) && !isDark(h3Index, now)
}

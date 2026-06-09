import { pool } from './db.js'
import { gridDisk } from 'h3-js'
import { isOcean } from './terrain.js'
import { CAMPS_PER_SPAWN, CAMP_GARRISON_MIN, CAMP_GARRISON_MAX } from './config.js'

// The Wildlands "player" owns all neutral camps. It never trains, marches,
// earns income, or appears on leaderboards - it exists so camps can defend.
export const WILD_USERNAME = 'WILD_Marauders'

let wildId = null

export async function ensureWildlands() {
  try {
    const existing = await pool.query('SELECT id FROM players WHERE username=$1', [WILD_USERNAME])
    if (existing.rows[0]) {
      wildId = existing.rows[0].id
      return wildId
    }
    const result = await pool.query(
      'INSERT INTO players (username, password_hash, color, gold, mana) VALUES ($1,$2,$3,0,0) RETURNING id',
      [WILD_USERNAME, 'WILD_NO_LOGIN', '#6b6354']
    )
    wildId = result.rows[0].id
    console.log(`[wild] Created ${WILD_USERNAME} (id ${wildId})`)
    return wildId
  } catch (err) {
    console.error('[wild] ensure error:', err.message)
    return null
  }
}

export function getWildId() {
  return wildId
}

// Seed a few garrisoned camps near a freshly-claimed capital so new players
// have something to fight in their first session.
export async function seedCampsAround(capitalHex) {
  if (!wildId) await ensureWildlands()
  if (!wildId) return []

  try {
    // Candidates: ring 2-3 around the capital (close enough to find, far enough to march)
    const candidates = gridDisk(capitalHex, 3).filter(h =>
      h !== capitalHex && !gridDisk(capitalHex, 1).includes(h) && !isOcean(h)
    )
    if (candidates.length === 0) return []

    const owned = await pool.query('SELECT h3_index FROM hexes WHERE h3_index = ANY($1)', [candidates])
    const taken = new Set(owned.rows.map(r => r.h3_index))
    const free = candidates.filter(h => !taken.has(h))

    // Shuffle and take the first N
    for (let i = free.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [free[i], free[j]] = [free[j], free[i]]
    }
    const picked = free.slice(0, CAMPS_PER_SPAWN)

    for (const h3 of picked) {
      const garrison = CAMP_GARRISON_MIN + Math.floor(Math.random() * (CAMP_GARRISON_MAX - CAMP_GARRISON_MIN + 1))
      await pool.query(
        'INSERT INTO hexes (h3_index, owner_id, claimed_at) VALUES ($1,$2,NOW()) ON CONFLICT DO NOTHING',
        [h3, wildId]
      )
      await pool.query(
        `INSERT INTO troops (owner_id, h3_index, type, quantity) VALUES ($1,$2,'troop',$3)
         ON CONFLICT (owner_id, h3_index, type) DO UPDATE SET quantity = EXCLUDED.quantity`,
        [wildId, h3, garrison]
      )
    }
    if (picked.length) console.log(`[wild] Seeded ${picked.length} camps near ${capitalHex}`)
    return picked
  } catch (err) {
    console.error('[wild] seed error:', err.message)
    return []
  }
}

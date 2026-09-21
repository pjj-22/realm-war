import { pool, httpError } from './db.js'
import { UNLOCKS, OCEAN_MARCH_MULTIPLIER, OCEAN_MARCH_MULTIPLIER_SEA_POWER } from './config.js'

// The hex count unlocks are judged on: the most hexes held this season, or the
// current count if that's higher (peak_hexes is only written once a harvest).
export async function getUnlockState(playerId, client = pool) {
  const [peakRow, hexRow] = await Promise.all([
    client.query('SELECT peak_hexes FROM players WHERE id=$1', [playerId]),
    client.query('SELECT COUNT(*)::int AS hexes FROM hexes WHERE owner_id=$1', [playerId]),
  ])
  const row = { peak_hexes: peakRow.rows[0]?.peak_hexes ?? 0, hexes: hexRow.rows[0]?.hexes ?? 0 }
  const effective = Math.max(row.hexes, row.peak_hexes)
  return {
    hexes: row.hexes,
    peak: row.peak_hexes,
    effective,
    tiers: UNLOCKS.map(u => ({ ...u, unlocked: effective >= u.hexes })),
  }
}

// Throws a 403 unless `id` is unlocked; returns the state so callers can reuse it.
export async function requireUnlock(playerId, id, client = pool) {
  const state = await getUnlockState(playerId, client)
  const tier = state.tiers.find(t => t.id === id)
  if (!tier) throw new Error(`Unknown unlock: ${id}`)
  if (!tier.unlocked) throw httpError(403, `${tier.name} unlocks at ${tier.hexes} hexes (your best this season: ${state.effective})`)
  return state
}

// Once a harvest: raise each player's season peak and tell them about any
// milestones they just crossed. notify(playerId, type, message) posts the event.
export async function updatePeaks(notify) {
  const rows = await pool.query(`
    SELECT p.id, p.peak_hexes, COUNT(h.h3_index)::int AS hexes
    FROM players p JOIN hexes h ON h.owner_id = p.id
    WHERE p.username NOT LIKE 'WILD_%' AND p.username NOT LIKE 'BOT_%'
    GROUP BY p.id, p.peak_hexes
  `)
  for (const { id, peak_hexes, hexes } of rows.rows) {
    if (hexes <= peak_hexes) continue
    await pool.query('UPDATE players SET peak_hexes=$1 WHERE id=$2', [hexes, id])
    const crossed = UNLOCKS.filter(u => u.hexes > peak_hexes && u.hexes <= hexes)
    if (crossed.length) notify?.(id, 'unlock', `Unlocked at ${hexes} hexes: ${crossed.map(u => u.name).join(', ')}.`)
  }
}

// Per-water-hex march cost for this player (sea_power halves the burden).
export function oceanMultiplierFor(state) {
  return state.tiers.find(t => t.id === 'sea_power')?.unlocked ? OCEAN_MARCH_MULTIPLIER_SEA_POWER : OCEAN_MARCH_MULTIPLIER
}

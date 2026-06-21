import { Router } from 'express'
import { gridDisk, cellToLatLng } from 'h3-js'
import { pool } from '../db.js'
import { requireAuth } from '../auth.js'
import { getIO } from '../socket.js'
import { isOcean } from '../terrain.js'
import { getCountry } from '../countries.js'
import { STARTING_TROOPS, PROJECTION_GARRISON, PROJECTION_EMPIRE } from '../config.js'
import { STRATEGIC_HEXES, STRATEGIC_BONUS_GOLD } from '../strategic.js'
import { seedCampsAround } from '../wild.js'

const router = Router()

// Get all claimed hexes
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      WITH power AS (SELECT owner_id, SUM(quantity)::int AS total FROM troops GROUP BY owner_id)
      SELECT h.h3_index, h.owner_id, h.upgrade_level, h.rally_hex, h.claimed_at, p.color, p.username, p.capital_hex,
        COALESCE(SUM(DISTINCT t.quantity), 0)::integer AS troop_count,
        COALESCE(MAX(power.total), 0)::integer AS owner_power,
        COALESCE(array_agg(DISTINCT b.type) FILTER (WHERE b.type IS NOT NULL), '{}') AS building_types
      FROM hexes h
      JOIN players p ON p.id = h.owner_id
      LEFT JOIN power ON power.owner_id = h.owner_id
      LEFT JOIN troops t ON t.h3_index = h.h3_index
      LEFT JOIN buildings b ON b.h3_index = h.h3_index
      GROUP BY h.h3_index, h.owner_id, h.upgrade_level, h.rally_hex, p.color, p.username, p.capital_hex
    `)
    const rows = result.rows.map(h => {
      const info = getCountry(h.h3_index)
      const strategic = STRATEGIC_HEXES.get(h.h3_index)
      // Power projection: huge garrisons (or huge empires) can't hide in fog
      const projected = h.troop_count >= PROJECTION_GARRISON || h.owner_power >= PROJECTION_EMPIRE
      const { owner_power, ...rest } = h
      return {
        ...rest,
        projected,
        country_name: info?.name || null,
        country_continent: info?.continent || null,
        strategic_name: strategic?.name || null,
        strategic_bonus: strategic ? STRATEGIC_BONUS_GOLD : 0,
        strategic_primary: strategic?.primary || false,
      }
    })
    res.json(rows)
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

// Strategic hexes - all locations with current ownership
router.get('/strategic', async (req, res) => {
  try {
    const indexes = Array.from(STRATEGIC_HEXES.keys())
    const owned = await pool.query(
      'SELECT h.h3_index, p.username, p.color FROM hexes h JOIN players p ON p.id = h.owner_id WHERE h.h3_index = ANY($1)',
      [indexes]
    )
    const ownerMap = new Map(owned.rows.map(r => [r.h3_index, { username: r.username, color: r.color }]))
    const result = indexes.map(h3 => {
      const def = STRATEGIC_HEXES.get(h3)
      const owner = ownerMap.get(h3) || null
      return { h3_index: h3, name: def.name, primary: def.primary, bonus_gold: STRATEGIC_BONUS_GOLD, owner }
    })
    res.json(result)
  } catch { res.status(500).json({ error: 'Server error' }) }
})

// Suggest a starting hex on the active front - near (but not on top of)
// an existing empire, so new players spawn where the war is.
router.get('/suggest-start', async (req, res) => {
  try {
    const anchors = await pool.query(`
      SELECT capital_hex, username FROM players
      WHERE capital_hex IS NOT NULL AND username NOT LIKE 'WILD_%'
      ORDER BY RANDOM() LIMIT 5
    `)
    for (const { capital_hex, username } of anchors.rows) {
      // Ring 5-9 around an existing capital: close enough to matter, far enough to breathe
      const outer = gridDisk(capital_hex, 9)
      const inner = new Set(gridDisk(capital_hex, 4))
      const candidates = outer.filter(h => !inner.has(h) && !isOcean(h))
      if (candidates.length === 0) continue

      const owned = await pool.query('SELECT h3_index FROM hexes WHERE h3_index = ANY($1)', [candidates])
      const taken = new Set(owned.rows.map(r => r.h3_index))
      const free = candidates.filter(h => !taken.has(h))
      if (free.length === 0) continue

      const pick = free[Math.floor(Math.random() * free.length)]
      const [lat, lng] = cellToLatLng(pick)
      return res.json({ h3Index: pick, lat, lng, near: username })
    }
    res.status(404).json({ error: 'No suggestion available' })
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

// Batch terrain check - returns { h3Index: 'ocean' | 'land', ... }
router.post('/terrain', (req, res) => {
  const { h3Indexes } = req.body
  if (!Array.isArray(h3Indexes)) return res.status(400).json({ error: 'h3Indexes required' })
  const result = {}
  for (const h of h3Indexes.slice(0, 1000)) {
    result[h] = isOcean(h) ? 'ocean' : 'land'
  }
  res.json(result)
})

// Claim a hex
router.post('/claim', requireAuth, async (req, res) => {
  const { h3Index } = req.body
  if (!h3Index) return res.status(400).json({ error: 'h3Index required' })

  if (isOcean(h3Index)) {
    return res.status(400).json({ error: 'Cannot claim ocean hexes' })
  }

  try {
    const existing = await pool.query('SELECT owner_id FROM hexes WHERE h3_index = $1', [h3Index])
    if (existing.rows[0]?.owner_id) return res.status(409).json({ error: 'Hex already claimed' })

    const player = await pool.query('SELECT id, capital_hex FROM players WHERE id = $1', [req.player.id])
    const isFirstHex = !player.rows[0].capital_hex

    if (!isFirstHex) {
      const troops = await pool.query(
        'SELECT 1 FROM troops WHERE owner_id=$1 AND h3_index=$2 AND quantity > 0 LIMIT 1',
        [req.player.id, h3Index]
      )
      if (troops.rows.length === 0) {
        return res.status(400).json({ error: 'March troops here first to claim this hex' })
      }
    }

    await pool.query(
      'INSERT INTO hexes (h3_index, owner_id, claimed_at) VALUES ($1, $2, NOW()) ON CONFLICT (h3_index) DO UPDATE SET owner_id = $2, claimed_at = NOW()',
      [h3Index, req.player.id]
    )

    if (isFirstHex) {
      // Claim the capital atomically - only the first of any concurrent (e.g. double-click)
      // requests wins. The losers update 0 rows and skip the one-time starter gifts,
      // so founding can't double the troops/mine/camps.
      const won = await pool.query(
        'UPDATE players SET capital_hex = $1 WHERE id = $2 AND capital_hex IS NULL RETURNING id',
        [h3Index, req.player.id]
      )
      if (won.rows.length > 0) {
        await pool.query(
          `INSERT INTO troops (owner_id, h3_index, type, quantity)
           VALUES ($1, $2, 'troop', $3)
           ON CONFLICT (owner_id, h3_index, type) DO UPDATE SET quantity = troops.quantity + EXCLUDED.quantity`,
          [req.player.id, h3Index, STARTING_TROOPS]
        )
        // Starter mine - guarded insert (buildings has no unique index on h3_index);
        // ::text keeps the param type unambiguous on varchar-h3 databases
        await pool.query(
          `INSERT INTO buildings (h3_index, type) SELECT $1::text, 'mine'
           WHERE NOT EXISTS (SELECT 1 FROM buildings WHERE h3_index = $1::text AND type = 'mine')`,
          [h3Index]
        )
        // PvE on-ramp: garrisoned neutral camps nearby to fight (and plunder)
        seedCampsAround(h3Index)
      }
    }

    getIO()?.emit('hexes:update')
    res.json({ success: true, isCapital: isFirstHex })
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

export default router

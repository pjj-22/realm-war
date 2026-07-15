import { Router } from 'express'
import { pool } from '../db.js'
import { CITY_ZONE_LIST, ZONE_BONUS_PER_HEX } from '../strategic.js'

const router = Router()

// City zones - static ring of influence hexes around each city (for map shading).
// `bonus` ships the server's per-hex gold value so the client never hardcodes it.
router.get('/zones', (req, res) => res.json({ bonus: ZONE_BONUS_PER_HEX, hexes: CITY_ZONE_LIST }))

// The Realm Herald - public global news feed
router.get('/events', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT w.id, w.type, w.message, w.hex_index, w.created_at, p.username, p.color
      FROM world_events w
      LEFT JOIN players p ON p.id = w.player_id
      ORDER BY w.created_at DESC
      LIMIT 50
    `)
    res.json(result.rows)
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

// Current country rulers
router.get('/crowns', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.country, c.crowned_at, p.username, p.color
      FROM country_crowns c
      JOIN players p ON p.id = c.player_id
      ORDER BY c.crowned_at ASC
    `)
    res.json(result.rows)
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

export default router

import { Router } from 'express'
import { pool } from '../db.js'
import { CITY_ZONE_LIST, ZONE_BONUS_PER_HEX } from '../strategic.js'
import { WONDERS } from '../wonders.js'
import { WONDER_INCOME_GOLD } from '../config.js'

const router = Router()

// City zones - static ring of influence hexes around each city (for map shading).
// `bonus` ships the server's per-hex gold value so the client never hardcodes it.
router.get('/zones', (req, res) => res.json({ bonus: ZONE_BONUS_PER_HEX, hexes: CITY_ZONE_LIST }))

// World Wonders - the landmark list, who currently holds each, and each
// wonder's chronicle: the most recent past keepers (permanent wonder_history)
router.get('/wonders', async (req, res) => {
  try {
    const [holders, history] = await Promise.all([
      pool.query(`
        SELECT wh.h3_index, wh.taken_at, p.username, p.color
        FROM wonder_holders wh JOIN players p ON p.id = wh.owner_id
      `),
      // Last 10 seizures per wonder, newest first
      pool.query(`
        SELECT h3_index, username, color, seized_at FROM (
          SELECT *, ROW_NUMBER() OVER (PARTITION BY h3_index ORDER BY seized_at DESC, id DESC) AS rn
          FROM wonder_history
        ) t WHERE rn <= 10 ORDER BY seized_at DESC, id DESC
      `),
    ])
    const byHex = new Map(holders.rows.map(r => [r.h3_index, r]))
    const histByHex = new Map()
    for (const r of history.rows) {
      if (!histByHex.has(r.h3_index)) histByHex.set(r.h3_index, [])
      histByHex.get(r.h3_index).push({ username: r.username, color: r.color, seized_at: r.seized_at })
    }
    res.json(WONDERS.map(w => {
      const h = byHex.get(w.h3)
      return {
        id: w.id, name: w.name, title: w.title, h3: w.h3, lat: w.lat, lng: w.lng,
        income: WONDER_INCOME_GOLD,
        holder: h ? { username: h.username, color: h.color, taken_at: h.taken_at } : null,
        history: histByHex.get(w.h3) || [],
      }
    }))
  } catch (err) {
    console.error('[world] GET /wonders failed:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// Champion's Monuments - permanent, accumulate across all past seasons
router.get('/monuments', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT season_number, username, color, h3_index, created_at FROM monuments ORDER BY season_number DESC'
    )
    res.json(result.rows)
  } catch (err) {
    console.error('[world] GET /monuments failed:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

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
  } catch (err) {
    console.error('[world] GET /events failed:', err.message)
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
  } catch (err) {
    console.error('[world] GET /crowns failed:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

export default router

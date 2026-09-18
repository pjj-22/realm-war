import { Router } from 'express'
import { getNumCells } from 'h3-js'
import { pool } from '../db.js'
import { getCurrentSeason, computeStandings } from '../season.js'
import { createLogger } from '../logger.js'

const log = createLogger('season')

const router = Router()

router.get('/current', async (req, res) => {
  try {
    let season = getCurrentSeason()
    if (!season) {
      const r = await pool.query("SELECT * FROM seasons WHERE status='active' ORDER BY number DESC LIMIT 1")
      season = r.rows[0]
    }
    if (!season) return res.status(404).json({ error: 'No active season' })
    const standings = await computeStandings(10)
    res.json({
      id: season.id,
      number: season.number,
      started_at: season.started_at,
      ends_at: season.ends_at,
      hex_resolution: season.hex_resolution,
      world_hex_count: getNumCells(season.hex_resolution),
      standings,
    })
  } catch (err) {
    log.error('GET /current failed', { err })
    res.status(500).json({ error: 'Server error' })
  }
})

router.get('/history', async (req, res) => {
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20))
  try {
    const r = await pool.query(`
      SELECT s.id, s.number, s.started_at, s.ended_at, s.snapshot, s.hex_resolution, s.stats,
        p.username AS winner_username, p.color AS winner_color
      FROM seasons s
      LEFT JOIN players p ON p.id = s.winner_id
      WHERE s.status = 'ended'
      ORDER BY s.number DESC
      LIMIT $1
    `, [limit])
    res.json(r.rows.map(row => ({ ...row, world_hex_count: getNumCells(row.hex_resolution) })))
  } catch (err) {
    log.error('GET /history failed', { err })
    res.status(500).json({ error: 'Server error' })
  }
})

export default router

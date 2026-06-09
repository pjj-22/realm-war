import { Router } from 'express'
import { pool } from '../db.js'
import { getCurrentSeason, computeStandings } from '../season.js'

const router = Router()

// Current season + live standings (public)
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
      standings,
    })
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

// Hall of fame: past seasons with champion + final standings snapshot (public)
router.get('/history', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT s.id, s.number, s.started_at, s.ended_at, s.snapshot,
        p.username AS winner_username, p.color AS winner_color
      FROM seasons s
      LEFT JOIN players p ON p.id = s.winner_id
      WHERE s.status = 'ended'
      ORDER BY s.number DESC
      LIMIT 20
    `)
    res.json(r.rows)
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

export default router

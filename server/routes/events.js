import { Router } from 'express'
import { pool } from '../db.js'
import { requireAuth } from '../auth.js'

const router = Router()

// Get last 20 events for the player, mark them read
router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, type, message, hex_index, read, created_at
       FROM events WHERE player_id=$1
       ORDER BY created_at DESC LIMIT 20`,
      [req.player.id]
    )
    // Mark all as read
    await pool.query(
      'UPDATE events SET read=true WHERE player_id=$1 AND read=false',
      [req.player.id]
    )
    res.json(result.rows)
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

// Cheap unread count poll
router.get('/count', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT COUNT(*)::integer AS count FROM events WHERE player_id=$1 AND read=false',
      [req.player.id]
    )
    res.json({ count: result.rows[0].count })
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

export default router

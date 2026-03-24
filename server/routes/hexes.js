import { Router } from 'express'
import { pool } from '../db.js'
import { requireAuth } from '../auth.js'

const router = Router()

// Get all claimed hexes (for map rendering)
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT h.h3_index, h.owner_id, p.color, p.username,
        COALESCE(SUM(t.quantity), 0)::integer AS troop_count
      FROM hexes h
      JOIN players p ON p.id = h.owner_id
      LEFT JOIN troops t ON t.h3_index = h.h3_index
      GROUP BY h.h3_index, h.owner_id, p.color, p.username
    `)
    res.json(result.rows)
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

// Claim a hex
router.post('/claim', requireAuth, async (req, res) => {
  const { h3Index } = req.body
  if (!h3Index) return res.status(400).json({ error: 'h3Index required' })

  try {
    // Check if already claimed
    const existing = await pool.query('SELECT owner_id FROM hexes WHERE h3_index = $1', [h3Index])
    if (existing.rows[0]?.owner_id) return res.status(409).json({ error: 'Hex already claimed' })

    const player = await pool.query('SELECT id, capital_hex FROM players WHERE id = $1', [req.player.id])
    const isFirstHex = !player.rows[0].capital_hex

    // After first hex, must have troops stationed on this hex
    if (!isFirstHex) {
      const troops = await pool.query(
        'SELECT 1 FROM troops WHERE owner_id=$1 AND h3_index=$2 AND quantity > 0 LIMIT 1',
        [req.player.id, h3Index]
      )
      if (troops.rows.length === 0) {
        return res.status(400).json({ error: 'March troops here first to claim this hex' })
      }
    }

    // Claim the hex
    await pool.query(
      'INSERT INTO hexes (h3_index, owner_id, claimed_at) VALUES ($1, $2, NOW()) ON CONFLICT (h3_index) DO UPDATE SET owner_id = $2, claimed_at = NOW()',
      [h3Index, req.player.id]
    )

    // If first hex, set as capital
    if (isFirstHex) {
      await pool.query('UPDATE players SET capital_hex = $1 WHERE id = $2', [h3Index, req.player.id])
    }

    res.json({ success: true, isCapital: isFirstHex })
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

export default router

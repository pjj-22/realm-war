import { Router } from 'express'
import { pool } from '../db.js'
import { requireAuth } from '../auth.js'
import { getIO } from '../socket.js'
import { isOcean } from '../terrain.js'

const router = Router()

// Get all claimed hexes
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT h.h3_index, h.owner_id, h.upgrade_level, p.color, p.username, p.capital_hex,
        COALESCE(SUM(DISTINCT t.quantity), 0)::integer AS troop_count,
        COALESCE(array_agg(DISTINCT b.type) FILTER (WHERE b.type IS NOT NULL), '{}') AS building_types
      FROM hexes h
      JOIN players p ON p.id = h.owner_id
      LEFT JOIN troops t ON t.h3_index = h.h3_index
      LEFT JOIN buildings b ON b.h3_index = h.h3_index
      GROUP BY h.h3_index, h.owner_id, h.upgrade_level, p.color, p.username, p.capital_hex
    `)
    res.json(result.rows)
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

// Batch terrain check — returns { h3Index: 'ocean' | 'land', ... }
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
      await pool.query('UPDATE players SET capital_hex = $1 WHERE id = $2', [h3Index, req.player.id])
    }

    getIO()?.emit('hexes:update')
    res.json({ success: true, isCapital: isFirstHex })
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

export default router

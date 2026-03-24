import { Router } from 'express'
import { pool } from '../db.js'
import { requireAuth } from '../auth.js'
import { BUILDING_COSTS } from '../config.js'

const router = Router()

const VALID_TYPES = Object.keys(BUILDING_COSTS)

// Build on a hex
router.post('/', requireAuth, async (req, res) => {
  const { h3Index, type } = req.body
  if (!h3Index || !type) return res.status(400).json({ error: 'h3Index and type required' })
  if (!VALID_TYPES.includes(type)) return res.status(400).json({ error: 'Invalid building type' })

  try {
    // Verify player owns the hex
    const hex = await pool.query('SELECT owner_id FROM hexes WHERE h3_index = $1', [h3Index])
    if (!hex.rows[0] || hex.rows[0].owner_id !== req.player.id) {
      return res.status(403).json({ error: 'You do not own this hex' })
    }

    // Check no building already exists
    const existing = await pool.query('SELECT id FROM buildings WHERE h3_index = $1', [h3Index])
    if (existing.rows.length > 0) return res.status(409).json({ error: 'Building already exists on this hex' })

    // Check player can afford it
    const cost = BUILDING_COSTS[type]
    const player = await pool.query('SELECT gold, mana FROM players WHERE id = $1', [req.player.id])
    const { gold, mana } = player.rows[0]
    if (gold < cost.gold || mana < cost.mana) {
      return res.status(400).json({ error: `Not enough resources. Need ${cost.gold} gold, ${cost.mana} mana.` })
    }

    // Deduct cost and build
    await pool.query(
      'UPDATE players SET gold = gold - $1, mana = mana - $2 WHERE id = $3',
      [cost.gold, cost.mana, req.player.id]
    )
    await pool.query(
      'INSERT INTO buildings (h3_index, type) VALUES ($1, $2)',
      [h3Index, type]
    )

    const updatedPlayer = await pool.query(
      'SELECT gold, mana FROM players WHERE id = $1',
      [req.player.id]
    )

    res.json({ success: true, building: { h3Index, type }, player: updatedPlayer.rows[0] })
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

// Demolish a building
router.delete('/:h3Index', requireAuth, async (req, res) => {
  const { h3Index } = req.params
  try {
    const hex = await pool.query('SELECT owner_id FROM hexes WHERE h3_index = $1', [h3Index])
    if (!hex.rows[0] || hex.rows[0].owner_id !== req.player.id) {
      return res.status(403).json({ error: 'You do not own this hex' })
    }
    await pool.query('DELETE FROM buildings WHERE h3_index = $1', [h3Index])
    res.json({ success: true })
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

// Get building on a hex
router.get('/:h3Index', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM buildings WHERE h3_index = $1', [req.params.h3Index])
    res.json(result.rows[0] || null)
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

export default router

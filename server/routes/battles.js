import { Router } from 'express'
import { pool } from '../db.js'

const router = Router()

// Get active battle at a hex (public — anyone can watch)
router.get('/hex/:h3Index', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT b.*,
        pa.username AS attacker_username, pa.color AS attacker_color,
        pd.username AS defender_username, pd.color AS defender_color
      FROM battles b
      JOIN players pa ON pa.id = b.attacker_id
      JOIN players pd ON pd.id = b.defender_id
      WHERE b.h3_index = $1 AND b.status = 'active'
    `, [req.params.h3Index])

    if (!result.rows[0]) return res.json({ battle: null })

    const parts = await pool.query(`
      SELECT bp.*, p.username, p.color
      FROM battle_participants bp
      JOIN players p ON p.id = bp.player_id
      WHERE bp.battle_id = $1
      ORDER BY bp.joined_at ASC
    `, [result.rows[0].id])

    res.json({ battle: result.rows[0], participants: parts.rows })
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

// Get all active battles (for map overlay)
router.get('/active', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT b.id, b.h3_index, b.round_number, b.attacker_strength, b.defender_strength,
        pa.username AS attacker_username, pa.color AS attacker_color,
        pd.username AS defender_username, pd.color AS defender_color
      FROM battles b
      JOIN players pa ON pa.id = b.attacker_id
      JOIN players pd ON pd.id = b.defender_id
      WHERE b.status = 'active'
    `)
    res.json(result.rows)
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

export default router

import { Router } from 'express'
import { pool } from '../db.js'
import { nextBattleRoundAt } from '../tick.js'

const router = Router()

// Get the battle at a hex - active if one's in progress, otherwise the most
// recently concluded one (briefly) so the client can actually show the
// deciding clash's result instead of the panel just vanishing the instant
// status flips away from 'active'.
router.get('/hex/:h3Index', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT b.*,
        pa.username AS attacker_username, pa.color AS attacker_color,
        pd.username AS defender_username, pd.color AS defender_color
      FROM battles b
      JOIN players pa ON pa.id = b.attacker_id
      JOIN players pd ON pd.id = b.defender_id
      WHERE b.h3_index = $1
        AND (b.status = 'active' OR b.ended_at > NOW() - INTERVAL '20 seconds')
      ORDER BY (b.status = 'active') DESC, b.id DESC
      LIMIT 1
    `, [req.params.h3Index])

    if (!result.rows[0]) return res.json({ battle: null })

    const parts = await pool.query(`
      SELECT bp.*, p.username, p.color
      FROM battle_participants bp
      JOIN players p ON p.id = bp.player_id
      WHERE bp.battle_id = $1
      ORDER BY bp.joined_at ASC
    `, [result.rows[0].id])

    res.json({
      battle: result.rows[0],
      participants: parts.rows,
      next_round_at: new Date(nextBattleRoundAt).toISOString(),
    })
  } catch (err) {
    console.error('[battles] GET /hex/:h3Index failed:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

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
  } catch (err) {
    console.error('[battles] GET /active failed:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

export default router

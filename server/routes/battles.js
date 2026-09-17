import { Router } from 'express'
import { pool } from '../db.js'
import { nextBattleRoundAt } from '../tick.js'
import { requireAuth } from '../auth.js'
import { buildVisibleSet, canSeeDetail } from '../visibility.js'
import { PROJECTION_GARRISON } from '../config.js'

const router = Router()

// Strength/troop numbers are real data, same as a hex's troop_count - hide
// them from anyone who can't see the hex (visibility.js), don't just trust
// the client to render around them. A big enough clash still projects
// through fog, same rule as a hex's own power-projection carve-out.
function redactBattle(battle, visibleSet) {
  const projected = battle.attacker_troops >= PROJECTION_GARRISON || battle.defender_troops >= PROJECTION_GARRISON
  if (canSeeDetail(battle.h3_index, visibleSet, projected)) return battle
  return {
    ...battle,
    attacker_strength: null, defender_strength: null,
    attacker_troops: null, defender_troops: null,
    attacker_losses: null, defender_losses: null,
    attacker_frontline: null, defender_frontline: null,
    attacker_reserve: null, defender_reserve: null,
  }
}

// Get the battle at a hex - active if one's in progress, otherwise the most
// recently concluded one (briefly) so the client can actually show the
// deciding clash's result instead of the panel just vanishing the instant
// status flips away from 'active'.
router.get('/hex/:h3Index', requireAuth, async (req, res) => {
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

    const visibleSet = await buildVisibleSet(req.player.id)
    const battle = redactBattle(result.rows[0], visibleSet)
    const canSee = battle.attacker_strength !== null

    const parts = await pool.query(`
      SELECT bp.*, p.username, p.color
      FROM battle_participants bp
      JOIN players p ON p.id = bp.player_id
      WHERE bp.battle_id = $1
      ORDER BY bp.joined_at ASC
    `, [result.rows[0].id])

    res.json({
      battle,
      participants: canSee ? parts.rows : parts.rows.map(p => ({ ...p, quantity: null })),
      next_round_at: new Date(nextBattleRoundAt).toISOString(),
    })
  } catch (err) {
    console.error('[battles] GET /hex/:h3Index failed:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

router.get('/active', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT b.id, b.h3_index, b.round_number, b.attacker_strength, b.defender_strength,
        b.attacker_troops, b.defender_troops,
        pa.username AS attacker_username, pa.color AS attacker_color,
        pd.username AS defender_username, pd.color AS defender_color
      FROM battles b
      JOIN players pa ON pa.id = b.attacker_id
      JOIN players pd ON pd.id = b.defender_id
      WHERE b.status = 'active'
    `)
    const visibleSet = await buildVisibleSet(req.player.id)
    res.json(result.rows.map(b => redactBattle(b, visibleSet)))
  } catch (err) {
    console.error('[battles] GET /active failed:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

export default router

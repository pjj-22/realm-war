import { Router } from 'express'
import crypto from 'crypto'
import { pool } from '../db.js'
import { requireAuth } from '../auth.js'
import { ALLIANCE_CREATE_COST } from '../config.js'

const router = Router()

// Current player's alliance + roster (null if unaffiliated)
router.get('/mine', requireAuth, async (req, res) => {
  try {
    const me = await pool.query('SELECT alliance_id FROM players WHERE id=$1', [req.player.id])
    const allianceId = me.rows[0]?.alliance_id
    if (!allianceId) return res.json(null)

    const [alliance, members] = await Promise.all([
      pool.query('SELECT id, name, tag, code, created_by FROM alliances WHERE id=$1', [allianceId]),
      pool.query('SELECT id, username, color, capital_hex FROM players WHERE alliance_id=$1 ORDER BY username', [allianceId]),
    ])
    if (!alliance.rows[0]) return res.json(null)
    const a = alliance.rows[0]
    // Only the founder sees the invite code
    if (a.created_by !== req.player.id) delete a.code
    res.json({ ...a, members: members.rows })
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

// Found a new alliance
router.post('/create', requireAuth, async (req, res) => {
  const { name, tag } = req.body
  if (!name || name.length < 3 || name.length > 24) return res.status(400).json({ error: 'Name must be 3-24 characters' })
  if (!tag || !/^[A-Za-z0-9]{2,4}$/.test(tag)) return res.status(400).json({ error: 'Tag must be 2-4 letters/numbers' })

  try {
    const me = await pool.query('SELECT alliance_id, gold FROM players WHERE id=$1', [req.player.id])
    if (me.rows[0]?.alliance_id) return res.status(400).json({ error: 'Leave your current alliance first' })
    if (me.rows[0].gold < ALLIANCE_CREATE_COST) {
      return res.status(400).json({ error: `Founding an alliance costs ${ALLIANCE_CREATE_COST}g` })
    }

    const code = crypto.randomBytes(3).toString('hex').toUpperCase()
    const result = await pool.query(
      'INSERT INTO alliances (name, tag, code, created_by) VALUES ($1,$2,$3,$4) RETURNING id, name, tag, code',
      [name.trim(), tag.toUpperCase(), code, req.player.id]
    )
    await pool.query('UPDATE players SET alliance_id=$1, gold=gold-$2 WHERE id=$3',
      [result.rows[0].id, ALLIANCE_CREATE_COST, req.player.id])
    res.json(result.rows[0])
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Name or tag already taken' })
    res.status(500).json({ error: 'Server error' })
  }
})

// Join by invite code
router.post('/join', requireAuth, async (req, res) => {
  const { code } = req.body
  if (!code) return res.status(400).json({ error: 'Invite code required' })
  try {
    const me = await pool.query('SELECT alliance_id FROM players WHERE id=$1', [req.player.id])
    if (me.rows[0]?.alliance_id) return res.status(400).json({ error: 'Leave your current alliance first' })

    const alliance = await pool.query('SELECT id, name, tag FROM alliances WHERE code=$1', [code.trim().toUpperCase()])
    if (!alliance.rows[0]) return res.status(404).json({ error: 'Invalid invite code' })

    await pool.query('UPDATE players SET alliance_id=$1 WHERE id=$2', [alliance.rows[0].id, req.player.id])
    res.json(alliance.rows[0])
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

// Leave alliance
router.post('/leave', requireAuth, async (req, res) => {
  try {
    await pool.query('UPDATE players SET alliance_id=NULL WHERE id=$1', [req.player.id])
    res.json({ success: true })
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

export default router

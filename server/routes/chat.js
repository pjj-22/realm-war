import { Router } from 'express'
import { pool } from '../db.js'
import { requireAuth } from '../auth.js'
import { getIO } from '../socket.js'
import { CHAT_MAX_LENGTH } from '../config.js'

const router = Router()

// Last 50 messages in a channel ('global' or 'alliance')
router.get('/', requireAuth, async (req, res) => {
  const channel = req.query.channel === 'alliance' ? 'alliance' : 'global'
  try {
    let result
    if (channel === 'alliance') {
      const me = await pool.query('SELECT alliance_id FROM players WHERE id=$1', [req.player.id])
      const allianceId = me.rows[0]?.alliance_id
      if (!allianceId) return res.json([])
      result = await pool.query(`
        SELECT c.id, c.text, c.created_at, p.username, p.color
        FROM chat_messages c JOIN players p ON p.id = c.player_id
        WHERE c.alliance_id = $1
        ORDER BY c.created_at DESC LIMIT 50
      `, [allianceId])
    } else {
      result = await pool.query(`
        SELECT c.id, c.text, c.created_at, p.username, p.color, a.tag
        FROM chat_messages c
        JOIN players p ON p.id = c.player_id
        LEFT JOIN alliances a ON a.id = p.alliance_id
        WHERE c.alliance_id IS NULL
        ORDER BY c.created_at DESC LIMIT 50
      `)
    }
    res.json(result.rows.reverse())
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

// Send a message
router.post('/', requireAuth, async (req, res) => {
  const { channel, text } = req.body
  const trimmed = (text || '').trim()
  if (!trimmed) return res.status(400).json({ error: 'Message required' })
  if (trimmed.length > CHAT_MAX_LENGTH) return res.status(400).json({ error: `Max ${CHAT_MAX_LENGTH} characters` })

  try {
    let allianceId = null
    if (channel === 'alliance') {
      const me = await pool.query('SELECT alliance_id FROM players WHERE id=$1', [req.player.id])
      allianceId = me.rows[0]?.alliance_id
      if (!allianceId) return res.status(400).json({ error: 'You are not in an alliance' })
    }
    await pool.query(
      'INSERT INTO chat_messages (player_id, alliance_id, text) VALUES ($1,$2,$3)',
      [req.player.id, allianceId, trimmed]
    )
    getIO()?.emit('chat:new', { channel: allianceId ? 'alliance' : 'global', allianceId })
    res.json({ success: true })
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

export default router

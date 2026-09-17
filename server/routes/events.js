import { Router } from 'express'
import { pool } from '../db.js'
import { requireAuth } from '../auth.js'
import { isDark } from '../visibility.js'

const router = Router()

const HIDDEN_QUANTITY_PHRASE = 'a force of unknown size'

// incoming_attack events store `{quantity}` literally in `message` (see
// notify.js) - substitute it here, using visibility *now*, not whatever it
// was when the event fired. Own hex is always in range, so darkness is the
// only thing that can hide it for this event type.
function renderEvent(row) {
  if (row.type !== 'incoming_attack' || row.quantity == null) return row
  const shown = isDark(row.hex_index) ? HIDDEN_QUANTITY_PHRASE : `${row.quantity} troops`
  return { ...row, message: row.message.replace('{quantity}', shown) }
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, type, message, hex_index, quantity, read, created_at
       FROM events WHERE player_id=$1
       ORDER BY created_at DESC LIMIT 20`,
      [req.player.id]
    )
    if (!req.query.peek) {
      await pool.query(
        'UPDATE events SET read=true WHERE player_id=$1 AND read=false',
        [req.player.id]
      )
    }
    res.json(result.rows.map(renderEvent))
  } catch (err) {
    console.error('[events] GET / failed:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

router.get('/count', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT COUNT(*)::integer AS count FROM events WHERE player_id=$1 AND read=false',
      [req.player.id]
    )
    res.json({ count: result.rows[0].count })
  } catch (err) {
    console.error('[events] GET /count failed:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

export default router

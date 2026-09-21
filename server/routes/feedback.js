import { Router } from 'express'
import { pool } from '../db.js'
import { requireAuth } from '../auth.js'
import { rateLimit } from '../ratelimit.js'
import { IS_DEV } from '../config.js'
import { createLogger } from '../logger.js'

const log = createLogger('feedback')

const router = Router()

export const FEEDBACK_MAX_LENGTH = 2000
export const FEEDBACK_CATEGORIES = ['bug', 'idea', 'other']

router.post('/', requireAuth, rateLimit({ windowMs: 60 * 60 * 1000, max: IS_DEV ? 1000 : 10, key: req => `feedback:${req.player.id}`, message: 'Thanks - you\'ve sent a lot of feedback, try again later' }), async (req, res) => {
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : ''
  const category = FEEDBACK_CATEGORIES.includes(req.body?.category) ? req.body.category : 'idea'
  if (!message) return res.status(400).json({ error: 'Write something first' })
  if (message.length > FEEDBACK_MAX_LENGTH) return res.status(400).json({ error: `Keep it under ${FEEDBACK_MAX_LENGTH} characters` })
  try {
    await pool.query('INSERT INTO feedback (player_id, category, message) VALUES ($1,$2,$3)', [req.player.id, category, message])
    log.info('Feedback received', { playerId: req.player.id, category, length: message.length })
    res.json({ success: true })
  } catch (err) {
    log.error('POST / failed', { err })
    res.status(500).json({ error: 'Server error' })
  }
})

export default router

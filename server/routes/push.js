import { Router } from 'express'
import { pool } from '../db.js'
import { requireAuth } from '../auth.js'
import { pushEnabled } from '../push.js'

const router = Router()

// Public VAPID key - client needs it to subscribe
router.get('/key', (req, res) => {
  if (!pushEnabled()) return res.status(503).json({ error: 'Push not configured' })
  res.json({ key: process.env.VAPID_PUBLIC_KEY })
})

// Register this browser's push subscription
router.post('/subscribe', requireAuth, async (req, res) => {
  const { subscription } = req.body
  if (!subscription?.endpoint || !subscription?.keys) {
    return res.status(400).json({ error: 'subscription required' })
  }
  try {
    await pool.query(
      `INSERT INTO push_subscriptions (player_id, endpoint, keys) VALUES ($1,$2,$3)
       ON CONFLICT (endpoint) DO UPDATE SET player_id=$1, keys=$3`,
      [req.player.id, subscription.endpoint, subscription.keys]
    )
    res.json({ success: true })
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

// Unregister
router.delete('/subscribe', requireAuth, async (req, res) => {
  const { endpoint } = req.body
  if (!endpoint) return res.status(400).json({ error: 'endpoint required' })
  try {
    await pool.query('DELETE FROM push_subscriptions WHERE endpoint=$1 AND player_id=$2', [endpoint, req.player.id])
    res.json({ success: true })
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

export default router

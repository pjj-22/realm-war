import webpush from 'web-push'
import { pool } from './db.js'

let enabled = false

export function initPush() {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.log('[push] VAPID keys not set - push notifications disabled')
    return
  }
  webpush.setVapidDetails(VAPID_SUBJECT || 'mailto:admin@realmwar.local', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
  enabled = true
  console.log('[push] Web push enabled')
}

export function pushEnabled() {
  return enabled
}

// Fire-and-forget: send a notification to every device a player has registered.
// Dead subscriptions (410/404) are pruned automatically.
export async function sendPush(playerId, title, body, data = {}) {
  if (!enabled) return
  try {
    const subs = await pool.query('SELECT id, endpoint, keys FROM push_subscriptions WHERE player_id=$1', [playerId])
    const payload = JSON.stringify({ title, body, data })
    await Promise.all(subs.rows.map(async sub => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload)
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await pool.query('DELETE FROM push_subscriptions WHERE id=$1', [sub.id])
        }
      }
    }))
  } catch (err) {
    console.error('[push] send error:', err.message)
  }
}

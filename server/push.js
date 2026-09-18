import webpush from 'web-push'
import { pool } from './db.js'
import { NOTIFICATIONS_ENABLED } from './config.js'
import { createLogger } from './logger.js'

const log = createLogger('push')
let enabled = false

export function initPush() {
  if (!NOTIFICATIONS_ENABLED) {
    log.info('Notifications disabled via NOTIFICATIONS_ENABLED=false')
    return
  }
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    log.info('VAPID keys not set - push notifications disabled')
    return
  }
  webpush.setVapidDetails(VAPID_SUBJECT || 'mailto:admin@realmwar.local', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
  enabled = true
  log.info('Web push enabled')
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
    log.error('send error', { err })
  }
}

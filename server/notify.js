import { pool } from './db.js'
import { sendPush } from './push.js'
import { getIO } from './socket.js'
import { isDark } from './visibility.js'

function isNPC(username) {
  return username?.startsWith('BOT_') || username?.startsWith('WILD_')
}

const HIDDEN_QUANTITY_PHRASE = 'a force of unknown size'

// Warn the owner of a hex that an enemy army is on its way.
// No-op when the target is unclaimed, own territory, an ally, or an NPC.
export async function notifyIncomingAttack(attackerId, toHex, quantity, arrivesAt) {
  try {
    const target = await pool.query(`
      SELECT p.id, p.username, p.alliance_id FROM hexes h JOIN players p ON p.id = h.owner_id
      WHERE h.h3_index = $1
    `, [toHex])
    const owner = target.rows[0]
    if (!owner || owner.id === attackerId || isNPC(owner.username)) return

    const attacker = await pool.query('SELECT username, alliance_id FROM players WHERE id=$1', [attackerId])
    const atk = attacker.rows[0]
    if (!atk) return
    if (owner.alliance_id && owner.alliance_id === atk.alliance_id) return

    const etaMin = Math.max(1, Math.round((new Date(arrivesAt) - Date.now()) / 60000))
    // The stored message keeps a {quantity} placeholder rather than baking
    // the number in - a warning can be read hours later, after day/night has
    // changed, so the real quantity is stored separately (events.quantity)
    // and substituted at read time (server/routes/events.js) using whatever
    // is visible *then*, not what was visible when this fired.
    const message = `${atk.username}'s army ({quantity}) is marching on your territory - arrives in ~${etaMin}m`
    await pool.query(
      'INSERT INTO events (player_id, type, message, hex_index, quantity) VALUES ($1,$2,$3,$4,$5)',
      [owner.id, 'incoming_attack', message, toHex, quantity]
    )
    getIO()?.to(`player-${owner.id}`).emit('events:new')
    // The push itself fires now, so "now" is all that can be checked - no
    // later re-render is possible for a push already delivered to a device.
    const pushQuantity = isDark(toHex) ? HIDDEN_QUANTITY_PHRASE : `${quantity} troops`
    sendPush(owner.id, 'Incoming attack!', message.replace('{quantity}', pushQuantity), { hex: toHex })
  } catch (err) {
    console.error('[notify] incoming attack error:', err.message)
  }
}

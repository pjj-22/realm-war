import { pool } from './db.js'
import { sendPush } from './push.js'
import { getIO } from './socket.js'

function isNPC(username) {
  return username?.startsWith('BOT_') || username?.startsWith('WILD_')
}

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
    const message = `🏹 ${atk.username}'s army (${quantity} troops) is marching on your territory - arrives in ~${etaMin}m`
    await pool.query(
      'INSERT INTO events (player_id, type, message, hex_index) VALUES ($1,$2,$3,$4)',
      [owner.id, 'incoming_attack', message, toHex]
    )
    getIO()?.emit('events:new')
    sendPush(owner.id, '⚔️ Incoming attack!', message, { hex: toHex })
  } catch (err) {
    console.error('[notify] incoming attack error:', err.message)
  }
}

// Game-master "act of god" events: instant, global, schema-free.
// Each handler mutates state, announces itself on The Herald, pushes affected
// players, and returns a summary. Sockets are emitted by the admin route.
import { pool } from './db.js'
import { sendPush } from './push.js'
import { seedCampsAround } from './wild.js'
import { insertEvent, insertWorldEvent } from './tick.js'

// Real players only - never the Wildlands NPC owner
const NOT_NPC = "username NOT LIKE 'WILD_%'"
const HUMAN = "username NOT LIKE 'BOT_%' AND username NOT LIKE 'WILD_%'"

// Registry drives the admin UI: param is the single tunable knob per event.
export const GM_EVENTS = {
  plague:         { name: 'Plague',         param: 'severity', def: 0.3, min: 0.05, max: 0.9,  step: 0.05, unit: '% troops lost' },
  meteor:         { name: 'Meteor Storm',   param: 'severity', def: 0.3, min: 0.05, max: 1,    step: 0.05, unit: '% buildings razed' },
  gold_rush:      { name: 'Gold Rush',      param: 'amount',   def: 100, min: 10,   max: 5000, step: 10,   unit: 'gold granted' },
  famine:         { name: 'Famine',         param: 'severity', def: 0.3, min: 0.05, max: 0.9,  step: 0.05, unit: '% gold drained' },
  marauder_surge: { name: 'Marauder Surge', param: 'count',    def: 3,   min: 1,    max: 15,   step: 1,    unit: 'capitals struck' },
  revolt:         { name: 'Peasant Revolt', param: 'count',    def: 5,   min: 1,    max: 30,   step: 1,    unit: 'hexes lost' },
}

function clampParam(type, raw) {
  const def = GM_EVENTS[type]
  const n = Number(raw)
  if (!Number.isFinite(n)) return def.def
  return Math.min(def.max, Math.max(def.min, n))
}

// Personal event + push to each affected real player (bots/NPCs get neither)
async function notify(ids, title, body, type) {
  const real = ids.length
    ? (await pool.query(`SELECT id FROM players WHERE id = ANY($1) AND ${HUMAN}`, [ids])).rows.map(r => r.id)
    : []
  for (const id of real) {
    await insertEvent(id, type, body)
    sendPush(id, title, body)
  }
  return real.length
}

async function plague(severity) {
  const t0 = Number((await pool.query('SELECT COALESCE(SUM(quantity),0)::int n FROM troops')).rows[0].n)
  const owners = (await pool.query('SELECT DISTINCT owner_id FROM troops')).rows.map(r => r.owner_id)
  await pool.query('UPDATE troops SET quantity = quantity - CEIL(quantity * $1::numeric)', [severity])
  await pool.query('DELETE FROM troops WHERE quantity <= 0')
  const t1 = Number((await pool.query('SELECT COALESCE(SUM(quantity),0)::int n FROM troops')).rows[0].n)
  const killed = t0 - t1
  const pct = Math.round(severity * 100)
  const msg = `A plague sweeps the realm — ${pct}% of every army withers. ${killed.toLocaleString()} troops lie dead.`
  await insertWorldEvent('plague', msg)
  const notified = await notify(owners, '🦠 Plague!', `A plague has killed ${pct}% of your troops.`, 'plague')
  return { headline: msg, killed, notified }
}

async function meteor(severity) {
  const total = Number((await pool.query('SELECT COUNT(*)::int n FROM buildings')).rows[0].n)
  if (total === 0) {
    const msg = 'Meteors streak the sky, but find nothing to destroy.'
    await insertWorldEvent('meteor', msg)
    return { headline: msg, destroyed: 0, notified: 0 }
  }
  // owners of the hexes whose buildings we're about to raze
  const doomed = (await pool.query(
    'SELECT id, h3_index FROM buildings ORDER BY random() LIMIT (CEIL($1::numeric * $2::numeric))::int', [total, severity]
  )).rows
  const hexes = doomed.map(r => r.h3_index)
  const owners = hexes.length
    ? (await pool.query('SELECT DISTINCT owner_id FROM hexes WHERE h3_index = ANY($1) AND owner_id IS NOT NULL', [hexes])).rows.map(r => r.owner_id)
    : []
  await pool.query('DELETE FROM buildings WHERE id = ANY($1)', [doomed.map(r => r.id)])
  const msg = `Meteors rain from the heavens — ${doomed.length} structures lie in ruin.`
  await insertWorldEvent('meteor', msg)
  const notified = await notify(owners, '☄️ Meteor Storm!', `Meteors destroyed ${doomed.length} of your buildings.`, 'meteor')
  return { headline: msg, destroyed: doomed.length, notified }
}

async function goldRush(amount) {
  const r = await pool.query(`UPDATE players SET gold = gold + $1 WHERE ${NOT_NPC} RETURNING id`, [amount])
  const msg = `A gold rush grips the realm — every ruler's coffers swell by ${amount.toLocaleString()}.`
  await insertWorldEvent('gold_rush', msg)
  const notified = await notify(r.rows.map(x => x.id), '💰 Gold Rush!', `Fortune smiles: +${amount.toLocaleString()} gold.`, 'gold_rush')
  return { headline: msg, players: r.rowCount, notified }
}

async function famine(severity) {
  const r = await pool.query(
    `UPDATE players SET gold = GREATEST(0, FLOOR(gold * (1 - $1::numeric))) WHERE ${NOT_NPC} RETURNING id`, [severity]
  )
  const pct = Math.round(severity * 100)
  const msg = `Famine grips the land — ${pct}% of every treasury turns to dust.`
  await insertWorldEvent('famine', msg)
  const notified = await notify(r.rows.map(x => x.id), '🍂 Famine!', `Famine drained ${pct}% of your gold.`, 'famine')
  return { headline: msg, players: r.rowCount, notified }
}

async function marauderSurge(count) {
  const capitals = (await pool.query(
    `SELECT capital_hex FROM players WHERE capital_hex IS NOT NULL AND ${NOT_NPC} ORDER BY random() LIMIT $1`, [count]
  )).rows
  let camps = 0
  for (const { capital_hex } of capitals) {
    const before = Number((await pool.query('SELECT COUNT(*)::int n FROM hexes')).rows[0].n)
    await seedCampsAround(capital_hex)
    const after = Number((await pool.query('SELECT COUNT(*)::int n FROM hexes')).rows[0].n)
    camps += Math.max(0, after - before)
  }
  const msg = `Marauders pour from the wilds — war camps blight the land near ${capitals.length} realms.`
  await insertWorldEvent('marauder_surge', msg)
  return { headline: msg, capitals: capitals.length, camps, notified: 0 }
}

async function revolt(count) {
  // Random owned, non-capital hexes throw off their lords and go neutral
  const hexes = (await pool.query(`
    SELECT h.h3_index, h.owner_id FROM hexes h
    JOIN players p ON p.id = h.owner_id
    WHERE ${NOT_NPC.replace(/username/g, 'p.username')}
      AND h.h3_index <> COALESCE(p.capital_hex, '')
    ORDER BY random() LIMIT $1`, [count]
  )).rows
  if (hexes.length === 0) {
    const msg = 'The peasants grumble, but no territory rises in revolt.'
    await insertWorldEvent('revolt', msg)
    return { headline: msg, hexes: 0, notified: 0 }
  }
  const ids = hexes.map(h => h.h3_index)
  const owners = [...new Set(hexes.map(h => h.owner_id))]
  await pool.query('DELETE FROM troops WHERE h3_index = ANY($1)', [ids])
  await pool.query('DELETE FROM buildings WHERE h3_index = ANY($1)', [ids])
  await pool.query('UPDATE hexes SET owner_id = NULL, claimed_at = NULL WHERE h3_index = ANY($1)', [ids])
  const msg = `Peasants revolt! ${hexes.length} territories cast off their rulers and stand neutral.`
  await insertWorldEvent('revolt', msg)
  const notified = await notify(owners, '🚩 Revolt!', `${hexes.length} of your territories have revolted and gone neutral.`, 'revolt')
  return { headline: msg, hexes: hexes.length, notified }
}

const HANDLERS = { plague, meteor, gold_rush: goldRush, famine, marauder_surge: marauderSurge, revolt }

// Returns a summary object, or throws on unknown type.
export async function triggerEvent(type, rawParam) {
  if (!GM_EVENTS[type]) throw new Error(`Unknown event type: ${type}`)
  const value = clampParam(type, rawParam)
  const result = await HANDLERS[type](value)
  return { type, param: value, ...result }
}

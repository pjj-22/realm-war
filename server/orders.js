import { pool, withTransaction } from './db.js'
import { BUILDING_COSTS, TROOP_STATS } from './config.js'
import { queueTraining } from './training.js'
import { createLogger } from './logger.js'

const log = createLogger('orders')

const TRAIN_TYPE = 'troop'

// notify(playerId, type, message) posts the summary event - passed in by
// tick.js (which owns insertEvent) so the two modules don't import each other.
// Standing orders: per-hex rules the server carries out at the start of each
// resource tick, paid for at the normal gold price.
//   min_troops - keep at least this many troops (garrisoned + already in
//                training) on the hex, training the shortfall
//   build      - if the hex has no building, put this one up
// Running before the tick's income lands (and its gold cap) means gold that
// would otherwise sit at the cap gets spent instead of wasted. Hexes are served
// most-depleted first, so a gold shortfall leaves the strongest hexes short
// rather than the emptiest. Orders on hexes the player no longer owns are dropped.
export async function processStandingOrders(notify) {
  try {
    const stale = await pool.query(`
      SELECT o.h3_index FROM hex_orders o
      LEFT JOIN hexes h ON h.h3_index = o.h3_index AND h.owner_id = o.owner_id
      WHERE h.h3_index IS NULL
    `)
    for (const { h3_index } of stale.rows) await pool.query('DELETE FROM hex_orders WHERE h3_index=$1', [h3_index])
    const owners = await pool.query('SELECT DISTINCT owner_id FROM hex_orders')
    for (const { owner_id } of owners.rows) {
      try { await runOrdersForPlayer(owner_id, notify) }
      catch (err) { log.error('Orders failed for player', { playerId: owner_id, err }) }
    }
  } catch (err) {
    log.error('Standing orders error', { err })
  }
}

export async function runOrdersForPlayer(ownerId, notify) {
  const summary = await withTransaction(async (tx) => {
    const player = await tx.query('SELECT gold FROM players WHERE id=$1 FOR UPDATE', [ownerId])
    let gold = player.rows[0]?.gold ?? 0
    if (gold <= 0) return null

    const orders = await tx.query('SELECT h3_index, min_troops, build FROM hex_orders WHERE owner_id=$1', [ownerId])
    const hexes = orders.rows.map(o => o.h3_index)
    const [troops, queued, built] = await Promise.all([
      tx.query('SELECT h3_index, SUM(quantity)::int AS qty FROM troops WHERE owner_id=$1 AND h3_index = ANY($2) GROUP BY h3_index', [ownerId, hexes]),
      tx.query('SELECT h3_index, SUM(quantity - delivered)::int AS qty FROM training_queue WHERE owner_id=$1 AND h3_index = ANY($2) GROUP BY h3_index', [ownerId, hexes]),
      tx.query('SELECT DISTINCT h3_index FROM buildings WHERE h3_index = ANY($1)', [hexes]),
    ])
    const have = new Map()
    for (const r of troops.rows) have.set(r.h3_index, r.qty)
    for (const r of queued.rows) have.set(r.h3_index, (have.get(r.h3_index) || 0) + r.qty)
    const hasBuilding = new Set(built.rows.map(r => r.h3_index))

    const unitCost = TROOP_STATS[TRAIN_TYPE].gold
    let builtCount = 0, trainedTroops = 0, trainedHexes = 0, shortHexes = 0, spent = 0

    // Buildings first - a barracks/fort makes the training that follows worth more
    for (const o of orders.rows) {
      if (!o.build || hasBuilding.has(o.h3_index) || !BUILDING_COSTS[o.build]) continue
      const cost = BUILDING_COSTS[o.build].gold
      if (gold < cost) continue
      await tx.query('INSERT INTO buildings (h3_index, type) VALUES ($1,$2)', [o.h3_index, o.build])
      gold -= cost; spent += cost; builtCount++
    }

    const needy = orders.rows
      .map(o => ({ ...o, deficit: o.min_troops - (have.get(o.h3_index) || 0) }))
      .filter(o => o.deficit > 0)
      .sort((a, b) => (have.get(a.h3_index) || 0) - (have.get(b.h3_index) || 0))
    for (const o of needy) {
      const affordable = Math.floor(gold / unitCost)
      const qty = Math.min(o.deficit, affordable)
      if (qty < o.deficit) shortHexes++
      if (qty < 1) continue
      await queueTraining(tx, ownerId, o.h3_index, TRAIN_TYPE, qty)
      gold -= qty * unitCost; spent += qty * unitCost
      trainedTroops += qty; trainedHexes++
    }

    if (spent > 0) await tx.query('UPDATE players SET gold=$1 WHERE id=$2', [gold, ownerId])
    return spent > 0 || shortHexes > 0 ? { spent, builtCount, trainedTroops, trainedHexes, shortHexes } : null
  })
  if (!summary) return null

  const parts = []
  if (summary.trainedTroops) parts.push(`training ${summary.trainedTroops} troops across ${summary.trainedHexes} hex${summary.trainedHexes > 1 ? 'es' : ''}`)
  if (summary.builtCount) parts.push(`building ${summary.builtCount}`)
  const tail = summary.shortHexes ? ` ${summary.shortHexes} hex${summary.shortHexes > 1 ? 'es are' : ' is'} still short - out of gold.` : ''
  notify?.(ownerId, 'orders', `Standing orders: ${parts.join(', ') || 'nothing affordable'} for ${summary.spent}g.${tail}`)
  return summary
}

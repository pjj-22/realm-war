import { Router } from 'express'
import { pool, withTransaction, httpError } from '../db.js'
import { rateLimit } from '../ratelimit.js'
import { requireAuth, optionalAuth } from '../auth.js'
import { TROOP_STATS, BUILDING_COSTS, PROJECTION_GARRISON, PROJECTION_EMPIRE, MASS_MARCH_MAX_SOURCES, MIN_TROOPS_TO_CLAIM } from '../config.js'
import { gridDisk, gridDistance } from 'h3-js'
import { gatherFanOut } from '../expansion.js'
import { launchArmy } from '../march.js'
import { planReinforce } from '../reinforce.js'
import { planRedistribute } from '../redistribute.js'
import { requireUnlock, getUnlockState, oceanMultiplierFor } from '../unlocks.js'
import { queueTraining } from '../training.js'
import { emitToRegion } from '../socket.js'
import { isOcean } from '../terrain.js'
import { notifyIncomingAttack } from '../notify.js'
import { currentMarchHex, findMarchPath, pathStepCosts } from '../marchPath.js'
import { buildVisibleSet, canSeeDetail } from '../visibility.js'
import { createLogger } from '../logger.js'

const log = createLogger('military')

const router = Router()

router.get('/hex/:h3Index', requireAuth, async (req, res) => {
  const { h3Index } = req.params
  try {
    const [troops, training, armies, hexRow] = await Promise.all([
      pool.query('SELECT type, quantity FROM troops WHERE owner_id=$1 AND h3_index=$2', [req.player.id, h3Index]),
      pool.query('SELECT * FROM training_queue WHERE owner_id=$1 AND h3_index=$2 ORDER BY completes_at ASC', [req.player.id, h3Index]),
      pool.query('SELECT * FROM armies WHERE owner_id=$1 AND from_hex=$2 AND status=$3', [req.player.id, h3Index, 'marching']),
      pool.query('SELECT rally_hex FROM hexes WHERE h3_index=$1 AND owner_id=$2', [h3Index, req.player.id]),
    ])
    res.json({ troops: troops.rows, training: training.rows, armies: armies.rows, rally_hex: hexRow.rows[0]?.rally_hex || null })
  } catch (err) {
    log.error('GET /hex/:h3Index failed', { err })
    res.status(500).json({ error: 'Server error' })
  }
})

router.post('/train', requireAuth, async (req, res) => {
  const { h3Index, type, quantity } = req.body
  if (!h3Index || !type || !Number.isInteger(quantity) || quantity < 1) return res.status(400).json({ error: 'Invalid request' })
  if (!TROOP_STATS[type]) return res.status(400).json({ error: 'Invalid troop type' })

  try {
    const hex = await pool.query('SELECT owner_id FROM hexes WHERE h3_index=$1', [h3Index])
    if (hex.rows[0]?.owner_id !== req.player.id) return res.status(403).json({ error: 'You do not own this hex' })

    const stats = TROOP_STATS[type]
    const totalGold = stats.gold * quantity

    const { training, gold } = await withTransaction(async (tx) => {
      // Lock the player row so concurrent trains can't double-spend
      const player = await tx.query('SELECT gold FROM players WHERE id=$1 FOR UPDATE', [req.player.id])
      const current = player.rows[0].gold
      if (current < totalGold) throw httpError(400, `Need ${totalGold}g, have ${current}g`)

      await tx.query('UPDATE players SET gold=gold-$1 WHERE id=$2', [totalGold, req.player.id])
      const training = await queueTraining(tx, req.player.id, h3Index, type, quantity)
      return { training, gold: current - totalGold }
    })

    res.json({ training, player: { gold } })
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    log.error('POST /train failed', { err })
    res.status(500).json({ error: 'Server error' })
  }
})

// Auto-train (client's "Auto-Train" button): spreads the player's gold across
// many hexes in one request instead of one /train call per hex - at a couple
// hundred hexes that used to mean that many sequential round trips. The split
// across hexes is decided client-side (GameMap.jsx handleAutoTrain); this just
// executes it as a single transaction, one gold check, one price lock-in.
const AUTO_TRAIN_MAX_HEXES = 500
router.post('/train-batch', requireAuth, async (req, res) => {
  const { orders } = req.body
  if (!Array.isArray(orders) || orders.length === 0 || orders.length > AUTO_TRAIN_MAX_HEXES) return res.status(400).json({ error: 'Invalid request' })
  const type = 'troop'
  const clean = []
  for (const o of orders) {
    if (!o || typeof o.h3Index !== 'string' || !Number.isInteger(o.quantity) || o.quantity < 1) return res.status(400).json({ error: 'Invalid request' })
    clean.push({ h3Index: o.h3Index, quantity: o.quantity })
  }
  const stats = TROOP_STATS[type]

  try {
    const owned = await pool.query('SELECT h3_index FROM hexes WHERE owner_id=$1', [req.player.id])
    const ownedSet = new Set(owned.rows.map(r => r.h3_index))
    const wanted = clean.filter(o => ownedSet.has(o.h3Index))

    const { trained, hexes, spent, gold } = await withTransaction(async (tx) => {
      const player = await tx.query('SELECT gold FROM players WHERE id=$1 FOR UPDATE', [req.player.id])
      let budget = player.rows[0].gold
      let trained = 0, hexes = 0, spent = 0
      for (const o of wanted) {
        const cost = stats.gold * o.quantity
        if (cost > budget) continue
        await queueTraining(tx, req.player.id, o.h3Index, type, o.quantity)
        budget -= cost; spent += cost; trained += o.quantity; hexes++
      }
      if (spent > 0) await tx.query('UPDATE players SET gold=gold-$1 WHERE id=$2', [spent, req.player.id])
      return { trained, hexes, spent, gold: budget }
    })
    res.json({ trained, hexes, spent, player: { gold } })
  } catch (err) {
    log.error('POST /train-batch failed', { err })
    res.status(500).json({ error: 'Server error' })
  }
})

router.post('/march', requireAuth, async (req, res) => {
  const { fromHex, toHex, type, quantity } = req.body
  // quantity must be a positive whole number - a negative value would slip past
  // the `available < quantity` check below and turn `quantity - $1` into an
  // addition, minting troops at the source and creating a negative-size army.
  if (!fromHex || !toHex || !type || !Number.isInteger(quantity) || quantity < 1) {
    return res.status(400).json({ error: 'Invalid request' })
  }

  try {
    // No hex-ownership check here on purpose - real authorization is the
    // troops-row lock below (owner_id=req.player.id), which is sufficient on
    // its own and, unlike a hex-ownership check, doesn't block marching away
    // troops that are sitting on a hex you don't own (ocean, decayed-away,
    // any "pending claim" state) - the one case that actually needs this,
    // since it's the only way to ever recover troops stranded there.
    const stats = TROOP_STATS[type]
    // findMarchPath weighs ocean at OCEAN_MARCH_MULTIPLIER per hex instead of
    // just checking the destination, so a longer all-land route can beat a
    // short ocean shortcut when it's actually faster - cost is already in
    // the same "hexes-equivalent" units the old gridDistance*multiplier
    // formula produced, just accounting for the real route instead of a
    // straight line.
    const oceanMult = oceanMultiplierFor(await getUnlockState(req.player.id))
    const { path, cost } = findMarchPath(fromHex, toHex, oceanMult)
    const arrivesAt = new Date(Date.now() + Math.max(1, cost) * stats.marchMinutesPerHex * 60 * 1000)

    const army = await launchArmy(req.player.id, { fromHex, toHex, type, quantity, path, arrivesAt, oceanMult })

    notifyIncomingAttack(req.player.id, toHex, quantity, arrivesAt)
    emitToRegion(fromHex, 'armies:update')
    emitToRegion(toHex, 'armies:update')
    res.json({ army })
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    log.error('POST /march failed', { err })
    res.status(500).json({ error: 'Server error' })
  }
})

// Mass march: send the troops from many of your hexes to one target in a
// single order, leaving `keep` behind on each. Needs the mass_march
// unlock (config.js UNLOCKS). Each source gets its own route (and so its own arrival time).
// Sources that can't send (not yours, nothing spare, the target itself, garrison
// changed mid-request) are skipped, not fatal. The defender gets one alert for
// the whole force, not one per source hex.
router.post('/march-many', requireAuth, rateLimit({ windowMs: 60 * 1000, max: 10, key: req => `march-many:${req.player.id}`, message: 'Slow down - too many mass marches' }), async (req, res) => {
  const { sources, toHex, keep = 1, sync = false } = req.body
  if (!Array.isArray(sources) || sources.length === 0 || !toHex) return res.status(400).json({ error: 'Invalid request' })
  if (!Number.isInteger(keep) || keep < 0 || keep > 500) return res.status(400).json({ error: 'Invalid keep amount' })
  const type = 'troop'
  const stats = TROOP_STATS[type]

  try {
    await requireUnlock(req.player.id, 'mass_march')
    if (sync) await requireUnlock(req.player.id, 'coordinated')
    const oceanMult = oceanMultiplierFor(await getUnlockState(req.player.id))
    const owned = await pool.query('SELECT h3_index FROM hexes WHERE owner_id=$1', [req.player.id])
    const ownedSet = new Set(owned.rows.map(r => r.h3_index))
    const wanted = [...new Set(sources)].filter(h => typeof h === 'string' && h !== toHex && ownedSet.has(h)).slice(0, MASS_MARCH_MAX_SOURCES)

    const garrisons = await pool.query(
      'SELECT h3_index, quantity FROM troops WHERE owner_id=$1 AND type=$2 AND h3_index = ANY($3)',
      [req.player.id, type, wanted]
    )
    const sending = garrisons.rows.map(r => ({ fromHex: r.h3_index, quantity: r.quantity - keep })).filter(o => o.quantity > 0)

    // Route every source first (so `sync` can hold them all to the slowest)
    const routed = []
    for (const o of sending) {
      // Route search is CPU-bound and synchronous - let other requests through
      // between sources so a big order doesn't stall the whole server.
      await new Promise(resolve => setImmediate(resolve))
      const { path, cost } = findMarchPath(o.fromHex, toHex, oceanMult)
      routed.push({ ...o, path, arrivesAt: new Date(Date.now() + Math.max(1, cost) * stats.marchMinutesPerHex * 60 * 1000) })
    }
    if (sync) {
      const slowest = new Date(Math.max(...routed.map(r => r.arrivesAt.getTime())))
      for (const r of routed) r.arrivesAt = slowest
    }

    let armies = 0, troops = 0, earliest = null
    for (const o of routed) {
      try {
        await launchArmy(req.player.id, { fromHex: o.fromHex, toHex, type, quantity: o.quantity, path: o.path, arrivesAt: o.arrivesAt, oceanMult })
      } catch (err) {
        if (err.status) continue
        throw err
      }
      armies++; troops += o.quantity
      if (!earliest || o.arrivesAt < earliest) earliest = o.arrivesAt
      emitToRegion(o.fromHex, 'armies:update')
    }

    if (armies > 0) {
      notifyIncomingAttack(req.player.id, toHex, troops, earliest)
      emitToRegion(toHex, 'armies:update')
    }
    log.info('Mass march', { playerId: req.player.id, toHex, armies, troops, requested: sources.length })
    res.json({ armies, troops, skipped: sources.length - armies })
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    log.error('POST /march-many failed', { err })
    res.status(500).json({ error: 'Server error' })
  }
})

// Fan out: one click, and troops from your hexes go to the hexes next to them
// that aren't yours - unclaimed land to claim and/or enemy hexes to attack.
// The player sets `perTarget`, the exact size of every army, `range`, how many
// hexes away a target may pull troops from (nearest source first), and `keep`, the
// least a source may be left with (a source that can't send perTarget without
// dropping below it doesn't send). Attacks are only planned where the
// defender's garrison is currently visible (fog of war, night) and perTarget
// covers 1.5x that garrison + 2, so this never throws troops at a hex it
// can't size up or can't beat. Allies, ocean, hexes already under
// siege, and hexes one of your armies is already heading for are left alone.
// dryRun returns the plan without sending anything.
const FANOUT_MAX_ARMIES = 300
const FANOUT_MAX_RANGE = 10
const FANOUT_MODES = ['claim', 'attack', 'both']
router.post('/fan-out', requireAuth, rateLimit({ windowMs: 60 * 1000, max: 20, key: req => `fan-out:${req.player.id}`, message: 'Slow down - too many fan-outs' }), async (req, res) => {
  const { sources, keep = 1, mode = 'both', dryRun = false, sync = false, perTarget, range = 1 } = req.body
  if (!Array.isArray(sources) || sources.length === 0) return res.status(400).json({ error: 'Invalid request' })
  if (!Number.isInteger(keep) || keep < 0 || keep > 500) return res.status(400).json({ error: 'Invalid keep amount' })
  if (!FANOUT_MODES.includes(mode)) return res.status(400).json({ error: 'Invalid mode' })
  if (!Number.isInteger(range) || range < 1 || range > FANOUT_MAX_RANGE) return res.status(400).json({ error: `Reach must be 1-${FANOUT_MAX_RANGE} hexes` })
  if (!Number.isInteger(perTarget) || perTarget < MIN_TROOPS_TO_CLAIM || perTarget > 500) return res.status(400).json({ error: `Send between ${MIN_TROOPS_TO_CLAIM} and 500 troops per target` })
  const type = 'troop'
  const stats = TROOP_STATS[type]
  const me = req.player.id

  try {
    await requireUnlock(me, 'fan_out')
    if (sync) await requireUnlock(me, 'coordinated')
    const oceanMult = oceanMultiplierFor(await getUnlockState(me))
    const gathered = await gatherFanOut(me, { sources, keep, mode, perTarget, range })
    const plan = gathered.plan.slice(0, FANOUT_MAX_ARMIES)
    const summary = {
      armies: plan.length,
      troops: plan.reduce((s, p) => s + p.quantity, 0),
      claims: plan.filter(p => p.kind === 'claim').length,
      attacks: plan.filter(p => p.kind === 'attack').length,
    }
    if (dryRun) return res.json({ dryRun: true, ...summary, senders: gathered.senders, maxSpare: gathered.maxSpare, targets: gathered.targets, skipped: gathered.skipped })

    const routed = plan.map(p => {
      const { path, cost } = findMarchPath(p.fromHex, p.toHex, oceanMult)
      return { ...p, path, arrivesAt: new Date(Date.now() + Math.max(1, cost) * stats.marchMinutesPerHex * 60 * 1000) }
    })
    if (sync && routed.length) {
      const slowest = new Date(Math.max(...routed.map(r => r.arrivesAt.getTime())))
      for (const r of routed) r.arrivesAt = slowest
    }

    let sent = 0, sentTroops = 0, sentClaims = 0, sentAttacks = 0
    for (const p of routed) {
      try {
        await launchArmy(me, { fromHex: p.fromHex, toHex: p.toHex, type, quantity: p.quantity, path: p.path, arrivesAt: p.arrivesAt, oceanMult })
      } catch (err) {
        if (err.status) continue
        throw err
      }
      sent++; sentTroops += p.quantity
      if (p.kind === 'claim') sentClaims++; else { sentAttacks++; notifyIncomingAttack(me, p.toHex, p.quantity, p.arrivesAt) }
      emitToRegion(p.fromHex, 'armies:update')
      emitToRegion(p.toHex, 'armies:update')
    }
    log.info('Fan out', { playerId: me, mode, armies: sent, troops: sentTroops, claims: sentClaims, attacks: sentAttacks })
    res.json({ dryRun: false, armies: sent, troops: sentTroops, claims: sentClaims, attacks: sentAttacks })
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    log.error('POST /fan-out failed', { err })
    res.status(500).json({ error: 'Server error' })
  }
})

// Reinforce threatened: hexes with enemy armies marching on them (or a battle
// already raging where you defend) get troops from your other hexes, nearest
// first, sized to 1.5x the incoming force + 2 (or enough to match the attackers
// in a live battle). Only armies that can actually arrive before the enemy
// (or within 30 minutes, for a battle already on) are sent - each route is
// really computed and late ones dropped. Hexes that are themselves threatened
// never give troops. Allies' armies aren't threats. dryRun previews.
const REINFORCE_BATTLE_WINDOW_MS = 30 * 60 * 1000
router.post('/reinforce', requireAuth, rateLimit({ windowMs: 60 * 1000, max: 20, key: req => `reinforce:${req.player.id}`, message: 'Slow down - too many reinforce orders' }), async (req, res) => {
  const { keep = 1, dryRun = false } = req.body
  if (!Number.isInteger(keep) || keep < 0 || keep > 500) return res.status(400).json({ error: 'Invalid keep amount' })
  const type = 'troop'
  const stats = TROOP_STATS[type]
  const me = req.player.id
  try {
    const state = await requireUnlock(me, 'reinforce')
    const oceanMult = oceanMultiplierFor(state)
    const now = Date.now()

    const [owned, incoming, battles, garrisons, me_] = await Promise.all([
      pool.query('SELECT h3_index FROM hexes WHERE owner_id=$1', [me]),
      pool.query(`SELECT a.to_hex, a.quantity, a.arrives_at, p.alliance_id FROM armies a JOIN players p ON p.id = a.owner_id
                  WHERE a.status='marching' AND a.owner_id <> $1 AND a.to_hex IN (SELECT h3_index FROM hexes WHERE owner_id=$1)`, [me]),
      pool.query("SELECT h3_index, attacker_troops, defender_troops FROM battles WHERE status='active' AND defender_id=$1", [me]),
      pool.query('SELECT h3_index, quantity FROM troops WHERE owner_id=$1 AND type=$2', [me, type]),
      pool.query('SELECT alliance_id FROM players WHERE id=$1', [me]),
    ])
    const myAlliance = me_.rows[0]?.alliance_id
    const garrison = new Map(garrisons.rows.map(r => [r.h3_index, r.quantity]))

    // threat per hex: incoming force and earliest landing, or a battle in progress
    const byHex = new Map()
    for (const a of incoming.rows) {
      if (myAlliance && a.alliance_id === myAlliance) continue
      const t = byHex.get(a.to_hex) || { incoming: 0, deadline: Infinity, battleShortfall: 0 }
      t.incoming += a.quantity
      t.deadline = Math.min(t.deadline, new Date(a.arrives_at).getTime())
      byHex.set(a.to_hex, t)
    }
    for (const b of battles.rows) {
      const t = byHex.get(b.h3_index) || { incoming: 0, deadline: Infinity, battleShortfall: 0 }
      t.battleShortfall = Math.max(t.battleShortfall, Math.ceil(Number(b.attacker_troops)) + 2 - Math.floor(Number(b.defender_troops)))
      t.deadline = Math.min(t.deadline, now + REINFORCE_BATTLE_WINDOW_MS)
      byHex.set(b.h3_index, t)
    }
    const threats = []
    for (const [h3, t] of byHex) {
      const have = garrison.get(h3) || 0
      const need = Math.max(t.incoming ? Math.ceil(t.incoming * 1.5) + 2 - have : 0, t.battleShortfall)
      if (need > 0) threats.push({ h3, need, deadline: t.deadline })
    }

    const spare = new Map()
    for (const o of owned.rows) {
      if (byHex.has(o.h3_index)) continue
      const q = (garrison.get(o.h3_index) || 0) - keep
      if (q > 0) spare.set(o.h3_index, q)
    }
    const perHexMs = stats.marchMinutesPerHex * 60 * 1000
    const travelMs = (a, b) => { try { return gridDistance(a, b) * perHexMs } catch { return Infinity } }
    const { plan } = planReinforce(threats, spare, travelMs, now)

    // Real routes: drop anything that would still land after its deadline
    let late = 0
    const routed = []
    for (const p of plan) {
      await new Promise(resolve => setImmediate(resolve))
      const { path, cost } = findMarchPath(p.fromHex, p.toHex, oceanMult)
      const arrivesAt = new Date(now + Math.max(1, cost) * perHexMs)
      if (arrivesAt.getTime() > p.deadline) { late++; continue }
      routed.push({ ...p, path, arrivesAt })
    }
    const troops = routed.reduce((s, r) => s + r.quantity, 0)
    const covered = new Set(routed.map(r => r.toHex)).size
    const summary = { threatened: byHex.size, needing: threats.length, covered, armies: routed.length, troops, late }
    if (dryRun) return res.json({ dryRun: true, ...summary })

    let sent = 0, sentTroops = 0
    for (const r of routed) {
      try {
        await launchArmy(me, { fromHex: r.fromHex, toHex: r.toHex, type, quantity: r.quantity, path: r.path, arrivesAt: r.arrivesAt, oceanMult })
      } catch (err) {
        if (err.status) continue
        throw err
      }
      sent++; sentTroops += r.quantity
      emitToRegion(r.fromHex, 'armies:update')
      emitToRegion(r.toHex, 'armies:update')
    }
    log.info('Reinforce', { playerId: me, armies: sent, troops: sentTroops, threatened: byHex.size })
    res.json({ dryRun: false, ...summary, armies: sent, troops: sentTroops })
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    log.error('POST /reinforce failed', { err })
    res.status(500).json({ error: 'Server error' })
  }
})

// Redistribute troops: evens out garrisons between neighbouring hexes in the
// filter (redistribute.js) - full hexes hand troops to thinner neighbours, one
// army per neighbouring pair, all landing one march step later. Never takes a
// hex below `keep`; hexes with an enemy army inbound or a battle on hold their
// troops (they can still receive). dryRun previews the result.
const REDISTRIBUTE_MAX_ARMIES = 400
router.post('/redistribute', requireAuth, rateLimit({ windowMs: 60 * 1000, max: 20, key: req => `redistribute:${req.player.id}`, message: 'Slow down - too many redistributions' }), async (req, res) => {
  const { sources, keep = 1, dryRun = false } = req.body
  if (!Array.isArray(sources) || sources.length === 0) return res.status(400).json({ error: 'Invalid request' })
  if (!Number.isInteger(keep) || keep < 0 || keep > 500) return res.status(400).json({ error: 'Invalid keep amount' })
  const type = 'troop'
  const stats = TROOP_STATS[type]
  const me = req.player.id
  try {
    const state = await requireUnlock(me, 'redistribute')
    const oceanMult = oceanMultiplierFor(state)

    const owned = await pool.query('SELECT h3_index FROM hexes WHERE owner_id=$1', [me])
    const ownedSet = new Set(owned.rows.map(r => r.h3_index))
    const scope = [...new Set(sources)].filter(h => typeof h === 'string' && ownedSet.has(h)).slice(0, MASS_MARCH_MAX_SOURCES)
    if (scope.length < 2) return res.json({ dryRun: !!dryRun, armies: 0, troops: 0, hexes: scope.length, before: { min: 0, max: 0 }, after: { min: 0, max: 0 } })

    const [garrisons, incoming, battles] = await Promise.all([
      pool.query('SELECT h3_index, quantity FROM troops WHERE owner_id=$1 AND type=$2 AND h3_index = ANY($3)', [me, type, scope]),
      pool.query("SELECT DISTINCT to_hex FROM armies WHERE status='marching' AND owner_id <> $1 AND to_hex = ANY($2)", [me, scope]),
      pool.query("SELECT h3_index FROM battles WHERE status='active' AND defender_id=$1 AND h3_index = ANY($2)", [me, scope]),
    ])
    const troops = new Map(scope.map(h => [h, 0]))
    for (const r of garrisons.rows) troops.set(r.h3_index, r.quantity)
    const holding = new Set([...incoming.rows.map(r => r.to_hex), ...battles.rows.map(r => r.h3_index)])

    const result = planRedistribute(troops, h => gridDisk(h, 1), { keep, canSend: h => !holding.has(h) })
    const moves = result.moves.slice(0, REDISTRIBUTE_MAX_ARMIES)
    const summary = {
      armies: moves.length,
      troops: moves.reduce((s, m) => s + m.quantity, 0),
      hexes: scope.length,
      before: result.before,
      after: result.after,
      holding: holding.size,
    }
    if (dryRun) return res.json({ dryRun: true, ...summary })

    let sent = 0, sentTroops = 0
    for (const m of moves) {
      const { path, cost } = findMarchPath(m.fromHex, m.toHex, oceanMult)
      const arrivesAt = new Date(Date.now() + Math.max(1, cost) * stats.marchMinutesPerHex * 60 * 1000)
      try {
        await launchArmy(me, { fromHex: m.fromHex, toHex: m.toHex, type, quantity: m.quantity, path, arrivesAt, oceanMult })
      } catch (err) {
        if (err.status) continue
        throw err
      }
      sent++; sentTroops += m.quantity
      emitToRegion(m.fromHex, 'armies:update')
      emitToRegion(m.toHex, 'armies:update')
    }
    log.info('Redistribute', { playerId: me, armies: sent, troops: sentTroops, hexes: scope.length })
    res.json({ dryRun: false, ...summary, armies: sent, troops: sentTroops })
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    log.error('POST /redistribute failed', { err })
    res.status(500).json({ error: 'Server error' })
  }
})

router.delete('/armies/:id', requireAuth, async (req, res) => {
  const { id } = req.params
  try {
    const army = await pool.query(
      'SELECT * FROM armies WHERE id=$1 AND owner_id=$2 AND status=$3',
      [id, req.player.id, 'marching']
    )
    if (!army.rows[0]) return res.status(404).json({ error: 'Army not found' })
    const a = army.rows[0]

    await pool.query(
      `INSERT INTO troops (owner_id, h3_index, type, quantity)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (owner_id, h3_index, type) DO UPDATE SET quantity = troops.quantity + EXCLUDED.quantity`,
      [req.player.id, a.from_hex, a.type, a.quantity]
    )
    await pool.query('DELETE FROM armies WHERE id=$1', [id])
    emitToRegion(a.from_hex, 'armies:update')
    res.json({ success: true })
  } catch (err) {
    log.error('DELETE /armies/:id failed', { err })
    res.status(500).json({ error: 'Server error' })
  }
})

router.post('/rally', requireAuth, async (req, res) => {
  const { fromHex, rallyHex } = req.body
  if (!fromHex || !rallyHex) return res.status(400).json({ error: 'fromHex and rallyHex required' })
  try {
    const own = await pool.query('SELECT owner_id FROM hexes WHERE h3_index=$1 AND owner_id=$2', [fromHex, req.player.id])
    if (!own.rows[0]) return res.status(403).json({ error: 'You do not own this hex' })
    const dest = await pool.query('SELECT owner_id FROM hexes WHERE h3_index=$1 AND owner_id=$2', [rallyHex, req.player.id])
    if (!dest.rows[0]) return res.status(400).json({ error: 'Rally destination must be one of your own hexes' })
    await pool.query('UPDATE hexes SET rally_hex=$1 WHERE h3_index=$2', [rallyHex, fromHex])
    res.json({ success: true, rally_hex: rallyHex })
  } catch (err) {
    log.error('POST /rally failed', { err })
    res.status(500).json({ error: 'Server error' })
  }
})

router.delete('/rally/:h3Index', requireAuth, async (req, res) => {
  const { h3Index } = req.params
  try {
    await pool.query('UPDATE hexes SET rally_hex=NULL WHERE h3_index=$1 AND owner_id=$2', [h3Index, req.player.id])
    res.json({ success: true })
  } catch (err) {
    log.error('DELETE /rally/:h3Index failed', { err })
    res.status(500).json({ error: 'Server error' })
  }
})

// Get all marching armies (for map display). Same power-projection rule as
// hexes: huge forces (or huge empires) can't hide - the client applies its own
// fog-of-war filtering for everything else, with more leeway than hexes get
// since a moving column is easier to spot than a quiet border.
// Standing orders (orders.js) - set or clear the same rule on many hexes at
// once. min_troops 0 with no build clears the orders on those hexes. Hexes you
// don't own are ignored rather than failing the whole batch.
const MAX_ORDER_HEXES = 1000
const MAX_ORDER_TROOPS = 500
router.post('/orders', requireAuth, async (req, res) => {
  const { h3Indexes, min_troops, build = null } = req.body
  if (!Array.isArray(h3Indexes) || h3Indexes.length === 0 || h3Indexes.length > MAX_ORDER_HEXES) return res.status(400).json({ error: 'Invalid hex list' })
  if (!Number.isInteger(min_troops) || min_troops < 0 || min_troops > MAX_ORDER_TROOPS) return res.status(400).json({ error: `min_troops must be 0-${MAX_ORDER_TROOPS}` })
  if (build !== null && !BUILDING_COSTS[build]) return res.status(400).json({ error: 'Invalid building type' })
  try {
    // Clearing orders is always allowed; setting them needs the matching unlock
    if (min_troops > 0) await requireUnlock(req.player.id, 'orders')
    if (build !== null) await requireUnlock(req.player.id, 'build_orders')
    const owned = await pool.query('SELECT h3_index FROM hexes WHERE owner_id=$1 AND h3_index = ANY($2)', [req.player.id, h3Indexes])
    const mine = owned.rows.map(r => r.h3_index)
    if (min_troops === 0 && build === null) {
      await pool.query('DELETE FROM hex_orders WHERE owner_id=$1 AND h3_index = ANY($2)', [req.player.id, mine])
    } else if (mine.length) {
      await pool.query(`
        INSERT INTO hex_orders (h3_index, owner_id, min_troops, build)
        SELECT h, $1, $3, $4 FROM unnest($2::text[]) AS h
        ON CONFLICT (h3_index) DO UPDATE SET owner_id=$1, min_troops=$3, build=$4
      `, [req.player.id, mine, min_troops, build])
    }
    res.json({ updated: mine.length, skipped: h3Indexes.length - mine.length })
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    log.error('POST /orders failed', { err })
    res.status(500).json({ error: 'Server error' })
  }
})

router.get('/armies', optionalAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      WITH power AS (SELECT owner_id, SUM(quantity)::float8 AS total FROM troops GROUP BY owner_id)
      SELECT a.*, p.color, p.username, COALESCE(power.total, 0)::float8 AS owner_power
      FROM armies a
      JOIN players p ON p.id = a.owner_id
      LEFT JOIN power ON power.owner_id = a.owner_id
      WHERE a.status='marching'
    `)
    const visibleSet = await buildVisibleSet(req.player?.id ?? null)
    const rows = result.rows.map(a => {
      const projected = a.quantity >= PROJECTION_GARRISON || a.owner_power >= PROJECTION_EMPIRE
      const { owner_power, ...rest } = a
      // Armies in flight from before the `path` column existed have none
      // stored - compute one just for this response so they still render
      // correctly rather than breaking the beam for whatever's still
      // mid-march when this deploys. New armies always have it stored.
      const path = a.path?.length ? a.path : findMarchPath(a.from_hex, a.to_hex).path
      const stepCosts = pathStepCosts(path, a.ocean_mult)
      // You always know your own army's size - only an enemy/bystander's
      // march gets hidden, and only when its destination isn't visible.
      const canSee = (req.player && a.owner_id === req.player.id) || canSeeDetail(a.to_hex, visibleSet, projected)
      if (!canSee) rest.quantity = null
      return { ...rest, path, stepCosts, projected, current_hex: currentMarchHex(a, path, stepCosts) }
    })
    res.json(rows)
  } catch (err) {
    log.error('GET /armies failed', { err })
    res.status(500).json({ error: 'Server error' })
  }
})

// Your own troops sitting on hexes you don't own yet - either mid-claim
// (below MIN_TROOPS_TO_CLAIM, waiting on reinforcement) or stranded on
// ocean (marchable, but never claimable at any troop count). Without this,
// those troops are real in the DB but invisible on the map, which reads as
// "my troops just disappeared." Ocean hexes stay in the list (an earlier
// version excluded them, which fixed the misleading "N/5" progress label
// but broke findability entirely - with no entry at all, there was no way
// to even locate stranded troops to march them back out) - claimable:false
// tells the client to render them as "stranded," not "almost there."
router.get('/pending-claims', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT t.h3_index, SUM(t.quantity)::int AS quantity
      FROM troops t
      LEFT JOIN hexes h ON h.h3_index = t.h3_index
      WHERE t.owner_id = $1 AND (h.h3_index IS NULL OR h.owner_id IS NULL)
      GROUP BY t.h3_index
      HAVING SUM(t.quantity) > 0
    `, [req.player.id])
    res.json(result.rows.map(r => ({ ...r, claimable: !isOcean(r.h3_index) })))
  } catch (err) {
    log.error('GET /pending-claims failed', { err })
    res.status(500).json({ error: 'Server error' })
  }
})

export default router

import { Router } from 'express'
import { pool, withTransaction, httpError } from '../db.js'
import { requireAuth } from '../auth.js'
import { gridDistance } from 'h3-js'
import { TROOP_STATS, OCEAN_MARCH_MULTIPLIER, BUILDING_TIME_SECONDS, NO_BARRACKS_TRAIN_MULT, PROJECTION_GARRISON, PROJECTION_EMPIRE } from '../config.js'
import { getIO } from '../socket.js'
import { isOcean } from '../terrain.js'
import { notifyIncomingAttack } from '../notify.js'

const router = Router()

// Get troops + training queue + armies for a hex
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
    console.error('[military] GET /hex/:h3Index failed:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// Train troops
router.post('/train', requireAuth, async (req, res) => {
  const { h3Index, type, quantity } = req.body
  if (!h3Index || !type || !quantity || quantity < 1) return res.status(400).json({ error: 'Invalid request' })
  if (!TROOP_STATS[type]) return res.status(400).json({ error: 'Invalid troop type' })

  try {
    // Must own the hex
    const hex = await pool.query('SELECT owner_id FROM hexes WHERE h3_index=$1', [h3Index])
    if (hex.rows[0]?.owner_id !== req.player.id) return res.status(403).json({ error: 'You do not own this hex' })

    const stats = TROOP_STATS[type]
    const totalGold = stats.gold * quantity

    const { training, gold } = await withTransaction(async (tx) => {
      // Lock the player row so concurrent trains can't double-spend
      const player = await tx.query('SELECT gold FROM players WHERE id=$1 FOR UPDATE', [req.player.id])
      const current = player.rows[0].gold
      if (current < totalGold) throw httpError(400, `Need ${totalGold}g, have ${current}g`)

      // Barracks halves train time; without one training runs at
      // NO_BARRACKS_TRAIN_MULT × base (10× slower than a barracks hex)
      const building = await tx.query(
        'SELECT type, created_at FROM buildings WHERE h3_index=$1', [h3Index]
      )
      const hasBarracks = building.rows.some(b =>
        b.type === 'barracks' && (Date.now() - new Date(b.created_at).getTime() >= BUILDING_TIME_SECONDS * 1000)
      )
      const trainMinutes = hasBarracks ? stats.trainMinutes / 2 : stats.trainMinutes * NO_BARRACKS_TRAIN_MULT

      // Chain after the last queued job on this hex so jobs don't overlap
      const lastJob = await tx.query(
        'SELECT MAX(completes_at) AS last FROM training_queue WHERE owner_id=$1 AND h3_index=$2',
        [req.player.id, h3Index]
      )
      const startedAt  = lastJob.rows[0]?.last ? new Date(lastJob.rows[0].last) : new Date()
      const completesAt = new Date(startedAt.getTime() + trainMinutes * 60 * 1000 * quantity)

      await tx.query('UPDATE players SET gold=gold-$1 WHERE id=$2', [totalGold, req.player.id])
      const result = await tx.query(
        'INSERT INTO training_queue (owner_id, h3_index, type, quantity, started_at, completes_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
        [req.player.id, h3Index, type, quantity, startedAt, completesAt]
      )
      return { training: result.rows[0], gold: current - totalGold }
    })

    res.json({ training, player: { gold } })
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    console.error('[military] POST /train failed:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// Send army to a hex
router.post('/march', requireAuth, async (req, res) => {
  const { fromHex, toHex, type, quantity } = req.body
  if (!fromHex || !toHex || !type || !quantity) return res.status(400).json({ error: 'Invalid request' })

  try {
    // Must own from hex
    const hex = await pool.query('SELECT owner_id FROM hexes WHERE h3_index=$1', [fromHex])
    if (hex.rows[0]?.owner_id !== req.player.id) return res.status(403).json({ error: 'You do not own this hex' })

    // Calculate arrival time - ocean hexes cost 10× march time
    const stats = TROOP_STATS[type]
    const dist = Math.max(1, gridDistance(fromHex, toHex))
    const multiplier = isOcean(toHex) ? OCEAN_MARCH_MULTIPLIER : 1
    const arrivesAt = new Date(Date.now() + dist * stats.marchMinutesPerHex * multiplier * 60 * 1000)

    const army = await withTransaction(async (tx) => {
      // Lock the garrison row so concurrent marches can't send the same troops twice
      const troopsRow = await tx.query(
        'SELECT quantity FROM troops WHERE owner_id=$1 AND h3_index=$2 AND type=$3 FOR UPDATE',
        [req.player.id, fromHex, type]
      )
      const available = troopsRow.rows[0]?.quantity || 0
      if (available < quantity) throw httpError(400, `Only ${available} troops available`)

      await tx.query(
        'UPDATE troops SET quantity=quantity-$1 WHERE owner_id=$2 AND h3_index=$3 AND type=$4',
        [quantity, req.player.id, fromHex, type]
      )
      const result = await tx.query(
        'INSERT INTO armies (owner_id, from_hex, to_hex, type, quantity, arrives_at, departed_at) VALUES ($1,$2,$3,$4,$5,$6,NOW()) RETURNING *',
        [req.player.id, fromHex, toHex, type, quantity, arrivesAt]
      )
      return result.rows[0]
    })

    notifyIncomingAttack(req.player.id, toHex, quantity, arrivesAt)
    getIO()?.emit('armies:update')
    res.json({ army })
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    console.error('[military] POST /march failed:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// Recall a marching army
router.delete('/armies/:id', requireAuth, async (req, res) => {
  const { id } = req.params
  try {
    const army = await pool.query(
      'SELECT * FROM armies WHERE id=$1 AND owner_id=$2 AND status=$3',
      [id, req.player.id, 'marching']
    )
    if (!army.rows[0]) return res.status(404).json({ error: 'Army not found' })
    const a = army.rows[0]

    // Return troops to origin hex
    await pool.query(
      `INSERT INTO troops (owner_id, h3_index, type, quantity)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (owner_id, h3_index, type) DO UPDATE SET quantity = troops.quantity + EXCLUDED.quantity`,
      [req.player.id, a.from_hex, a.type, a.quantity]
    )
    await pool.query('DELETE FROM armies WHERE id=$1', [id])
    getIO()?.emit('armies:update')
    res.json({ success: true })
  } catch (err) {
    console.error('[military] DELETE /armies/:id failed:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// Set rally point for a hex
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
    console.error('[military] POST /rally failed:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// Clear rally point for a hex
router.delete('/rally/:h3Index', requireAuth, async (req, res) => {
  const { h3Index } = req.params
  try {
    await pool.query('UPDATE hexes SET rally_hex=NULL WHERE h3_index=$1 AND owner_id=$2', [h3Index, req.player.id])
    res.json({ success: true })
  } catch (err) {
    console.error('[military] DELETE /rally/:h3Index failed:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// Get all marching armies (for map display). Same power-projection rule as
// hexes: huge forces (or huge empires) can't hide - the client applies its own
// fog-of-war filtering for everything else, with more leeway than hexes get
// since a moving column is easier to spot than a quiet border.
router.get('/armies', async (req, res) => {
  try {
    const result = await pool.query(`
      WITH power AS (SELECT owner_id, SUM(quantity)::int AS total FROM troops GROUP BY owner_id)
      SELECT a.*, p.color, p.username, COALESCE(power.total, 0)::int AS owner_power
      FROM armies a
      JOIN players p ON p.id = a.owner_id
      LEFT JOIN power ON power.owner_id = a.owner_id
      WHERE a.status='marching'
    `)
    const rows = result.rows.map(a => {
      const projected = a.quantity >= PROJECTION_GARRISON || a.owner_power >= PROJECTION_EMPIRE
      const { owner_power, ...rest } = a
      return { ...rest, projected }
    })
    res.json(rows)
  } catch (err) {
    console.error('[military] GET /armies failed:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

export default router

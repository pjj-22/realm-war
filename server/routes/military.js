import { Router } from 'express'
import { pool } from '../db.js'
import { requireAuth } from '../auth.js'
import { gridDistance } from 'h3-js'
import { TROOP_STATS } from '../config.js'

const router = Router()

// Get troops + training queue + armies for a hex
router.get('/hex/:h3Index', requireAuth, async (req, res) => {
  const { h3Index } = req.params
  try {
    const [troops, training, armies] = await Promise.all([
      pool.query('SELECT type, quantity FROM troops WHERE owner_id=$1 AND h3_index=$2', [req.player.id, h3Index]),
      pool.query('SELECT * FROM training_queue WHERE owner_id=$1 AND h3_index=$2 ORDER BY completes_at ASC', [req.player.id, h3Index]),
      pool.query('SELECT * FROM armies WHERE owner_id=$1 AND from_hex=$2 AND status=$3', [req.player.id, h3Index, 'marching']),
    ])
    res.json({ troops: troops.rows, training: training.rows, armies: armies.rows })
  } catch {
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
    const totalMana = stats.mana * quantity

    // Check resources
    const player = await pool.query('SELECT gold, mana FROM players WHERE id=$1', [req.player.id])
    const { gold, mana } = player.rows[0]
    if (gold < totalGold || mana < totalMana) {
      return res.status(400).json({ error: `Need ${totalGold}g ${totalMana}m, have ${gold}g ${mana}m` })
    }

    // Check for barracks (halves train time)
    const building = await pool.query('SELECT type FROM buildings WHERE h3_index=$1', [h3Index])
    const hasBarracks = building.rows.some(b => b.type === 'barracks')
    const trainMinutes = hasBarracks ? stats.trainMinutes / 2 : stats.trainMinutes

    // Chain after the last queued job on this hex so jobs don't overlap
    const lastJob = await pool.query(
      'SELECT MAX(completes_at) AS last FROM training_queue WHERE owner_id=$1 AND h3_index=$2',
      [req.player.id, h3Index]
    )
    const startedAt  = lastJob.rows[0]?.last ? new Date(lastJob.rows[0].last) : new Date()
    const completesAt = new Date(startedAt.getTime() + trainMinutes * 60 * 1000 * quantity)

    // Deduct resources and queue training
    await pool.query('UPDATE players SET gold=gold-$1, mana=mana-$2 WHERE id=$3', [totalGold, totalMana, req.player.id])
    const result = await pool.query(
      'INSERT INTO training_queue (owner_id, h3_index, type, quantity, started_at, completes_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [req.player.id, h3Index, type, quantity, startedAt, completesAt]
    )

    const updated = await pool.query('SELECT gold, mana FROM players WHERE id=$1', [req.player.id])
    res.json({ training: result.rows[0], player: updated.rows[0] })
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

// Send army to adjacent hex
router.post('/march', requireAuth, async (req, res) => {
  const { fromHex, toHex, type, quantity } = req.body
  if (!fromHex || !toHex || !type || !quantity) return res.status(400).json({ error: 'Invalid request' })

  try {
    // Must own from hex
    const hex = await pool.query('SELECT owner_id FROM hexes WHERE h3_index=$1', [fromHex])
    if (hex.rows[0]?.owner_id !== req.player.id) return res.status(403).json({ error: 'You do not own this hex' })

    // Check troops available
    const troopsRow = await pool.query(
      'SELECT quantity FROM troops WHERE owner_id=$1 AND h3_index=$2 AND type=$3',
      [req.player.id, fromHex, type]
    )
    const available = troopsRow.rows[0]?.quantity || 0
    if (available < quantity) return res.status(400).json({ error: `Only ${available} ${type}s available` })

    // Deduct troops
    await pool.query(
      'UPDATE troops SET quantity=quantity-$1 WHERE owner_id=$2 AND h3_index=$3 AND type=$4',
      [quantity, req.player.id, fromHex, type]
    )

    // Calculate arrival time based on actual hex distance
    const stats = TROOP_STATS[type]
    const dist = Math.max(1, gridDistance(fromHex, toHex))
    const arrivesAt = new Date(Date.now() + dist * stats.marchMinutesPerHex * 60 * 1000)

    const result = await pool.query(
      'INSERT INTO armies (owner_id, from_hex, to_hex, type, quantity, arrives_at, departed_at) VALUES ($1,$2,$3,$4,$5,$6,NOW()) RETURNING *',
      [req.player.id, fromHex, toHex, type, quantity, arrivesAt]
    )

    res.json({ army: result.rows[0] })
  } catch {
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
    res.json({ success: true })
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

// ─── Army Groups ─────────────────────────────────────────────────────────────

router.get('/groups', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM army_groups WHERE owner_id=$1 ORDER BY created_at ASC',
      [req.player.id]
    )
    res.json(result.rows)
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

router.post('/groups', requireAuth, async (req, res) => {
  const { id, name, knight = 0, archer = 0, trebuchet = 0 } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' })
  try {
    if (id) {
      await pool.query(
        'UPDATE army_groups SET name=$1, knight=$2, archer=$3, trebuchet=$4 WHERE id=$5 AND owner_id=$6',
        [name.trim(), knight, archer, trebuchet, id, req.player.id]
      )
      res.json({ success: true })
    } else {
      const r = await pool.query(
        'INSERT INTO army_groups (owner_id, name, knight, archer, trebuchet) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [req.player.id, name.trim(), knight, archer, trebuchet]
      )
      res.json(r.rows[0])
    }
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

router.delete('/groups/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM army_groups WHERE id=$1 AND owner_id=$2', [req.params.id, req.player.id])
    res.json({ success: true })
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

// March a saved group — dispatches one army per troop type in the group
router.post('/march-group', requireAuth, async (req, res) => {
  const { fromHex, toHex, groupId } = req.body
  if (!fromHex || !toHex || !groupId) return res.status(400).json({ error: 'Invalid request' })
  try {
    const hexRow = await pool.query('SELECT owner_id FROM hexes WHERE h3_index=$1', [fromHex])
    if (hexRow.rows[0]?.owner_id !== req.player.id) return res.status(403).json({ error: 'You do not own this hex' })

    const groupRow = await pool.query('SELECT * FROM army_groups WHERE id=$1 AND owner_id=$2', [groupId, req.player.id])
    if (!groupRow.rows[0]) return res.status(404).json({ error: 'Group not found' })
    const group = groupRow.rows[0]

    const dist = Math.max(1, gridDistance(fromHex, toHex))
    const armies = []
    const errors = []

    for (const type of ['knight', 'archer', 'trebuchet']) {
      const qty = Number(group[type])
      if (!qty || qty <= 0) continue

      const troopsRow = await pool.query(
        'SELECT quantity FROM troops WHERE owner_id=$1 AND h3_index=$2 AND type=$3',
        [req.player.id, fromHex, type]
      )
      const available = troopsRow.rows[0]?.quantity || 0
      if (available < qty) { errors.push(`Only ${available} ${type}s (need ${qty})`); continue }

      await pool.query(
        'UPDATE troops SET quantity=quantity-$1 WHERE owner_id=$2 AND h3_index=$3 AND type=$4',
        [qty, req.player.id, fromHex, type]
      )
      const arrivesAt = new Date(Date.now() + dist * TROOP_STATS[type].marchMinutesPerHex * 60 * 1000)
      const r = await pool.query(
        'INSERT INTO armies (owner_id, from_hex, to_hex, type, quantity, arrives_at, departed_at) VALUES ($1,$2,$3,$4,$5,$6,NOW()) RETURNING *',
        [req.player.id, fromHex, toHex, type, qty, arrivesAt]
      )
      armies.push(r.rows[0])
    }

    if (armies.length === 0) return res.status(400).json({ error: errors.join('; ') || 'No troops in group' })
    res.json({ armies, errors })
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

// Get all marching armies (for map display)
router.get('/armies', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT a.*, p.color, p.username
      FROM armies a JOIN players p ON p.id=a.owner_id
      WHERE a.status='marching'
    `)
    res.json(result.rows)
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

export default router

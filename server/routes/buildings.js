import { Router } from 'express'
import { pool } from '../db.js'
import { requireAuth } from '../auth.js'
import { BUILDING_COSTS, UPGRADE_COST, UPGRADE_MINUTES, MAX_UPGRADE_LEVEL, BUILDING_TIME_SECONDS, TICK_INTERVAL_MS } from '../config.js'

const router = Router()
const VALID_TYPES = Object.keys(BUILDING_COSTS)
const MAX_BUILDINGS_PER_HEX = 1

// Get all buildings on a hex + slot info + upgrade status
router.get('/:h3Index', async (req, res) => {
  try {
    const { h3Index } = req.params
    const [buildings, hexRow, upgradeRow] = await Promise.all([
      pool.query('SELECT * FROM buildings WHERE h3_index=$1 ORDER BY created_at ASC', [h3Index]),
      pool.query('SELECT h.upgrade_level, p.capital_hex FROM hexes h JOIN players p ON p.id=h.owner_id WHERE h.h3_index=$1', [h3Index]),
      pool.query('SELECT * FROM upgrade_queue WHERE h3_index=$1', [h3Index]),
    ])
    const hex = hexRow.rows[0] || { upgrade_level: 0, capital_hex: null }
    const enriched = buildings.rows.map(b => ({
      ...b,
      is_complete: !b.created_at || (Date.now() - new Date(b.created_at).getTime() >= BUILDING_TIME_SECONDS * 1000),
    }))
    res.json({
      buildings: enriched,
      build_time_seconds: BUILDING_TIME_SECONDS,
      upgrade_minutes: UPGRADE_MINUTES,
      slots: MAX_BUILDINGS_PER_HEX,
      usedSlots: buildings.rows.length,
      upgradeLevel: hex.upgrade_level || 0,
      maxUpgradeLevel: MAX_UPGRADE_LEVEL,
      upgrading: upgradeRow.rows[0] || null,
    })
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

// Build on a hex
router.post('/', requireAuth, async (req, res) => {
  const { h3Index, type } = req.body
  if (!h3Index || !type) return res.status(400).json({ error: 'h3Index and type required' })
  if (!VALID_TYPES.includes(type)) return res.status(400).json({ error: 'Invalid building type' })

  try {
    const hexRow = await pool.query(
      'SELECT h.owner_id, h.upgrade_level, p.capital_hex FROM hexes h JOIN players p ON p.id=h.owner_id WHERE h.h3_index=$1',
      [h3Index]
    )
    if (!hexRow.rows[0] || hexRow.rows[0].owner_id !== req.player.id) {
      return res.status(403).json({ error: 'You do not own this hex' })
    }
    // One building per hex
    const existing = await pool.query('SELECT type FROM buildings WHERE h3_index=$1', [h3Index])
    if (existing.rows.length >= MAX_BUILDINGS_PER_HEX) {
      return res.status(400).json({ error: 'This hex already has a building' })
    }

    const cost = BUILDING_COSTS[type]
    const player = await pool.query('SELECT gold FROM players WHERE id=$1', [req.player.id])
    const { gold } = player.rows[0]
    if (gold < cost.gold) {
      return res.status(400).json({ error: `Need ${cost.gold}g, have ${gold}g` })
    }

    await pool.query('UPDATE players SET gold=gold-$1 WHERE id=$2', [cost.gold, req.player.id])
    const built = await pool.query('INSERT INTO buildings (h3_index, type) VALUES ($1,$2) RETURNING *', [h3Index, type])

    const updated = await pool.query('SELECT gold FROM players WHERE id=$1', [req.player.id])
    res.json({ success: true, building: built.rows[0], player: updated.rows[0] })
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

// Demolish a specific building by id
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const building = await pool.query('SELECT b.*, h.owner_id FROM buildings b JOIN hexes h ON h.h3_index=b.h3_index WHERE b.id=$1', [req.params.id])
    if (!building.rows[0] || building.rows[0].owner_id !== req.player.id) {
      return res.status(403).json({ error: 'Not your building' })
    }
    await pool.query('DELETE FROM buildings WHERE id=$1', [req.params.id])
    res.json({ success: true })
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

// Start hex upgrade
router.post('/:h3Index/upgrade', requireAuth, async (req, res) => {
  const { h3Index } = req.params
  try {
    const hexRow = await pool.query(
      'SELECT h.owner_id, h.upgrade_level FROM hexes h WHERE h.h3_index=$1',
      [h3Index]
    )
    if (!hexRow.rows[0] || hexRow.rows[0].owner_id !== req.player.id) {
      return res.status(403).json({ error: 'You do not own this hex' })
    }
    if (hexRow.rows[0].upgrade_level >= MAX_UPGRADE_LEVEL) {
      return res.status(400).json({ error: 'Already at max upgrade level' })
    }

    const existing = await pool.query('SELECT id FROM upgrade_queue WHERE h3_index=$1', [h3Index])
    if (existing.rows[0]) return res.status(409).json({ error: 'Upgrade already in progress' })

    const player = await pool.query('SELECT gold FROM players WHERE id=$1', [req.player.id])
    const { gold } = player.rows[0]
    if (gold < UPGRADE_COST.gold) {
      return res.status(400).json({ error: `Need ${UPGRADE_COST.gold}g` })
    }

    const completesAt = new Date(Date.now() + UPGRADE_MINUTES * 60 * 1000)
    await pool.query('UPDATE players SET gold=gold-$1 WHERE id=$2', [UPGRADE_COST.gold, req.player.id])
    const job = await pool.query(
      'INSERT INTO upgrade_queue (owner_id, h3_index, completes_at) VALUES ($1,$2,$3) RETURNING *',
      [req.player.id, h3Index, completesAt]
    )
    const updated = await pool.query('SELECT gold FROM players WHERE id=$1', [req.player.id])
    res.json({ upgrade: job.rows[0], player: updated.rows[0] })
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

export default router

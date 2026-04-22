import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { pool } from '../db.js'
import { signToken, requireAuth } from '../auth.js'
import { STARTING_GOLD, STARTING_MANA } from '../config.js'
import { nextTickAt } from '../tick.js'

const router = Router()

// Register
router.post('/register', async (req, res) => {
  const { username, password, color } = req.body
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' })
  if (username.length < 3 || username.length > 32) return res.status(400).json({ error: 'Username must be 3-32 characters' })
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' })

  try {
    const hash = await bcrypt.hash(password, 10)
    const playerColor = color || '#4a90d9'
    const result = await pool.query(
      'INSERT INTO players (username, password_hash, color, gold, mana) VALUES ($1, $2, $3, $4, $5) RETURNING id, username, color, gold, capital_hex',
      [username, hash, playerColor, STARTING_GOLD, STARTING_MANA]
    )
    const player = result.rows[0]
    res.json({ token: signToken(player), player })
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Username already taken' })
    res.status(500).json({ error: 'Server error' })
  }
})

// Login
router.post('/login', async (req, res) => {
  const { username, password } = req.body
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' })

  try {
    const result = await pool.query(
      'SELECT id, username, color, gold, capital_hex, password_hash FROM players WHERE username = $1',
      [username]
    )
    const player = result.rows[0]
    if (!player) return res.status(401).json({ error: 'Invalid credentials' })

    const valid = await bcrypt.compare(password, player.password_hash)
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' })

    const { password_hash, ...playerData } = player
    res.json({ token: signToken(playerData), player: playerData })
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

// Leaderboard (public)
router.get('/leaderboard', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.username, p.color,
        COUNT(DISTINCT h.h3_index)::integer AS hex_count,
        COALESCE(SUM(t.quantity), 0)::integer AS total_troops
      FROM players p
      LEFT JOIN hexes h ON h.owner_id = p.id
      LEFT JOIN troops t ON t.owner_id = p.id
      GROUP BY p.id, p.username, p.color
      ORDER BY hex_count DESC, total_troops DESC
      LIMIT 10
    `)
    res.json(result.rows)
  } catch { res.status(500).json({ error: 'Server error' }) }
})

// Player stats (authenticated)
router.get('/stats', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(DISTINCT h.h3_index)::integer AS hex_count,
        COALESCE(SUM(CASE WHEN b.type='mine' THEN 1 ELSE 0 END), 0)::integer AS mines,
        COALESCE(SUM(CASE WHEN b.type='barracks' THEN 1 ELSE 0 END), 0)::integer AS barracks,
        COALESCE(SUM(CASE WHEN b.type='fort' THEN 1 ELSE 0 END), 0)::integer AS forts
      FROM players p
      LEFT JOIN hexes h ON h.owner_id = p.id
      LEFT JOIN buildings b ON b.h3_index = h.h3_index
      WHERE p.id = $1
      GROUP BY p.id
    `, [req.player.id])
    const row = result.rows[0] || { hex_count: 0, mines: 0, barracks: 0, forts: 0 }
    const { GOLD_CAP_BASE, GOLD_CAP_PER_HEX, GOLD_CAP_PER_MINE } = await import('../config.js')
    row.gold_cap = GOLD_CAP_BASE + row.hex_count * GOLD_CAP_PER_HEX + row.mines * GOLD_CAP_PER_MINE
    row.next_tick_at = new Date(nextTickAt).toISOString()
    res.json(row)
  } catch { res.status(500).json({ error: 'Server error' }) }
})

// Get current player
router.get('/me', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, color, gold, capital_hex FROM players WHERE id = $1',
      [req.player.id]
    )
    res.json(result.rows[0])
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

export default router

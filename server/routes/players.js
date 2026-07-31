import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { pool } from '../db.js'
import { signToken, requireAuth } from '../auth.js'
import { rateLimit } from '../ratelimit.js'
import { IS_DEV } from '../config.js'
import { STARTING_GOLD, STARTING_MANA, TICK_INTERVAL_MS, BUILDING_TIME_SECONDS, GOLD_CAP_BASE, WONDER_INCOME_GOLD } from '../config.js'
import { nextTickAt } from '../tick.js'
import { getCountry } from '../countries.js'
import { STRATEGIC_HEXES, STRATEGIC_BONUS_GOLD, CITY_ZONES, ZONE_BONUS_PER_HEX } from '../strategic.js'
import { WONDERS } from '../wonders.js'

const router = Router()

router.post('/register', rateLimit({ windowMs: 60 * 60 * 1000, max: IS_DEV ? 1000 : 10, message: 'Too many accounts created - try later' }), async (req, res) => {
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
    console.error('[players] POST /register failed:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

router.post('/login', rateLimit({ windowMs: 10 * 60 * 1000, max: IS_DEV ? 1000 : 20, message: 'Too many login attempts - try later' }), async (req, res) => {
  const { username, password } = req.body
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' })

  try {
    const result = await pool.query(
      'SELECT id, username, color, gold, capital_hex, password_hash, last_login_date, login_streak FROM players WHERE username = $1',
      [username]
    )
    const player = result.rows[0]
    if (!player) return res.status(401).json({ error: 'Invalid credentials' })

    const valid = await bcrypt.compare(password, player.password_hash)
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' })

    const { password_hash, last_login_date, login_streak, ...playerData } = player

    let loginBonus = null
    const today = new Date().toISOString().split('T')[0]
    const lastDate = last_login_date ? last_login_date.toISOString().split('T')[0] : null
    if (lastDate !== today) {
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]
      const newStreak = lastDate === yesterday ? (login_streak || 0) + 1 : 1
      const bonusGold = newStreak >= 7 ? 100 : newStreak >= 3 ? 50 : 20
      await pool.query(
        'UPDATE players SET gold = LEAST(gold + $1, $2), last_login_date = $3::date, login_streak = $4 WHERE id = $5',
        [bonusGold, GOLD_CAP_BASE, today, newStreak, playerData.id]
      )
      playerData.gold = Math.min(playerData.gold + bonusGold, GOLD_CAP_BASE)
      loginBonus = { gold: bonusGold, streak: newStreak }
    }

    res.json({ token: signToken(playerData), player: playerData, loginBonus })
  } catch (err) {
    console.error('[players] POST /login failed:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

router.get('/leaderboard', async (req, res) => {
  try {
    const result = await pool.query(`
      WITH hx AS (SELECT owner_id, COUNT(*)::int AS n FROM hexes GROUP BY owner_id),
           tr AS (SELECT owner_id, SUM(quantity)::float8 AS n FROM troops GROUP BY owner_id),
           ch AS (SELECT winner_id, COUNT(*)::int AS n FROM seasons WHERE status='ended' AND winner_id IS NOT NULL GROUP BY winner_id)
      SELECT p.username, p.color, p.capital_hex, p.flag_pixels, a.tag AS alliance_tag,
        COALESCE(hx.n, 0) AS hex_count,
        COALESCE(tr.n, 0) AS total_troops,
        COALESCE(ch.n, 0) AS champion_titles
      FROM players p
      LEFT JOIN alliances a ON a.id = p.alliance_id
      LEFT JOIN hx ON hx.owner_id = p.id
      LEFT JOIN tr ON tr.owner_id = p.id
      LEFT JOIN ch ON ch.winner_id = p.id
      WHERE p.username NOT LIKE 'WILD_%'
      ORDER BY hex_count DESC, total_troops DESC
    `)
    res.json(result.rows)
  } catch (err) {
    console.error('[players] GET /leaderboard failed:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

router.get('/stats', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(DISTINCT h.h3_index)::integer AS hex_count,
        COALESCE(SUM(CASE WHEN b.type='mine'     AND EXTRACT(EPOCH FROM (NOW() - b.created_at)) >= $2 THEN 1 ELSE 0 END), 0)::integer AS mines,
        COALESCE(SUM(CASE WHEN b.type='barracks' AND EXTRACT(EPOCH FROM (NOW() - b.created_at)) >= $2 THEN 1 ELSE 0 END), 0)::integer AS barracks,
        COALESCE(SUM(CASE WHEN b.type='fort'     AND EXTRACT(EPOCH FROM (NOW() - b.created_at)) >= $2 THEN 1 ELSE 0 END), 0)::integer AS forts
      FROM players p
      LEFT JOIN hexes h ON h.owner_id = p.id
      LEFT JOIN buildings b ON b.h3_index = h.h3_index
      WHERE p.id = $1
      GROUP BY p.id
    `, [req.player.id, BUILDING_TIME_SECONDS])
    const row = result.rows[0] || { hex_count: 0, mines: 0, barracks: 0, forts: 0 }
    const { GOLD_CAP_BASE, GOLD_CAP_PER_HEX, GOLD_CAP_PER_MINE } = await import('../config.js')
    row.gold_cap = GOLD_CAP_BASE + row.hex_count * GOLD_CAP_PER_HEX + row.mines * GOLD_CAP_PER_MINE
    row.next_tick_at = new Date(nextTickAt).toISOString()
    row.tick_interval_ms = TICK_INTERVAL_MS

    const hexRows = await pool.query(`
      SELECT h.h3_index,
        COALESCE(SUM(CASE WHEN b.type='mine' AND EXTRACT(EPOCH FROM (NOW() - b.created_at)) >= $2 THEN 1 ELSE 0 END), 0)::integer AS mines
      FROM hexes h
      LEFT JOIN buildings b ON b.h3_index = h.h3_index
      WHERE h.owner_id = $1
      GROUP BY h.h3_index
    `, [req.player.id, BUILDING_TIME_SECONDS])

    // Mirrors tick.js's actual payout exactly (base + mines + strategic hexes +
    // city-zone hexes + wonders) - this used to only count base+mines, so the
    // displayed total silently omitted strategic/zone/wonder income entirely.
    const byCountry = new Map()
    for (const { h3_index, mines } of hexRows.rows) {
      const info = getCountry(h3_index)
      const key = info ? info.name : 'Ocean / Islands'
      const continent = info ? info.continent : 'Ocean'
      if (!byCountry.has(key)) byCountry.set(key, { country: key, continent, hexes: 0, mines: 0, strategic: 0, zone: 0 })
      const entry = byCountry.get(key)
      entry.hexes += 1
      entry.mines += mines
      if (STRATEGIC_HEXES.has(h3_index)) entry.strategic += 1
      if (CITY_ZONES.has(h3_index)) entry.zone += 1
    }

    row.income_by_country = Array.from(byCountry.values())
      .map(e => ({ ...e, income: e.hexes + e.mines * 3 + e.strategic * STRATEGIC_BONUS_GOLD + e.zone * ZONE_BONUS_PER_HEX }))
      .sort((a, b) => b.income - a.income)

    const wonderHexes = new Set(WONDERS.map(w => w.h3))
    row.wonder_income = hexRows.rows.filter(r => wonderHexes.has(r.h3_index)).length * WONDER_INCOME_GOLD
    row.income_per_harvest = row.income_by_country.reduce((s, e) => s + e.income, 0) + row.wonder_income

    res.json(row)
  } catch (err) {
    console.error('[players] GET /stats failed:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

router.get('/me', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, color, gold, capital_hex, flag_pixels, motto FROM players WHERE id = $1',
      [req.player.id]
    )
    res.json(result.rows[0])
  } catch (err) {
    console.error('[players] GET /me failed:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// Save capital flag - one 16x16 pixel grid, one palette-index char per pixel,
// plus an optional short motto. Set once at onboarding; no edit route by
// design (see client FlagOnboardingModal).
const FLAG_PATTERN = /^[0-9a-n]{256}$/
const MOTTO_MAX = 50
router.post('/flag', requireAuth, async (req, res) => {
  const { flagPixels, motto } = req.body
  if (typeof flagPixels !== 'string' || !FLAG_PATTERN.test(flagPixels)) {
    return res.status(400).json({ error: 'Invalid flag data' })
  }
  if (motto != null && (typeof motto !== 'string' || motto.length > MOTTO_MAX)) {
    return res.status(400).json({ error: `Motto must be ${MOTTO_MAX} characters or fewer` })
  }
  // Strip control characters (still allow ordinary spaces/punctuation)
  const cleanMotto = motto ? motto.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, MOTTO_MAX) : null
  try {
    await pool.query('UPDATE players SET flag_pixels = $1, motto = $2 WHERE id = $3', [flagPixels, cleanMotto || null, req.player.id])
    res.json({ ok: true })
  } catch (err) {
    console.error('[players] POST /flag failed:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

router.get('/history', requireAuth, async (req, res) => {
  try {
    const rows = await pool.query(
      `SELECT hex_count, recorded_at FROM hex_history
       WHERE player_id = $1 AND recorded_at > NOW() - INTERVAL '30 days'
       ORDER BY recorded_at ASC`,
      [req.player.id]
    )
    // Downsample to max 120 points so the client stays lean
    const data = rows.rows
    const MAX = 120
    if (data.length <= MAX) return res.json(data)
    const step = data.length / MAX
    const sampled = Array.from({ length: MAX }, (_, i) => data[Math.floor(i * step)])
    res.json(sampled)
  } catch (err) {
    console.error('[players] GET /history failed:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

export default router

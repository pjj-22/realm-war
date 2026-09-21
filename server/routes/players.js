import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { pool, withTransaction } from '../db.js'
import { signToken, requireAuth } from '../auth.js'
import { rateLimit } from '../ratelimit.js'
import { getIO, emitToRegion } from '../socket.js'
import { IS_DEV } from '../config.js'
import { STARTING_GOLD, STARTING_MANA, TICK_INTERVAL_MS, BUILDING_TIME_SECONDS, GOLD_CAP_BASE, GOLD_CAP_PER_HEX, GOLD_CAP_PER_MINE, WONDER_INCOME_GOLD } from '../config.js'
import { nextTickAt } from '../tick.js'
import { getCountry } from '../countries.js'
import { STRATEGIC_HEXES, STRATEGIC_BONUS_GOLD, CITY_ZONES, ZONE_BONUS_PER_HEX } from '../strategic.js'
import { WONDERS } from '../wonders.js'
import { containsBadWords } from '../moderation.js'
import { getUnlockState, requireUnlock } from '../unlocks.js'
import { createLogger } from '../logger.js'
import { clientIp } from '../ratelimit.js'

const log = createLogger('players')

const router = Router()

router.post('/register', rateLimit({ windowMs: 60 * 60 * 1000, max: IS_DEV ? 1000 : 10, message: 'Too many accounts created - try later' }), async (req, res) => {
  const { username, password, color, ageConfirmed } = req.body
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' })
  if (username.length < 3 || username.length > 32) return res.status(400).json({ error: 'Username must be 3-32 characters' })
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' })
  if (containsBadWords(username)) return res.status(400).json({ error: 'Username not allowed' })
  // Age gate: COPPA (US, under 13) / GDPR digital-consent age. We can't verify
  // it, but requiring the explicit affirmation - and recording that it was
  // given - is the standard bar for a service not directed at children.
  if (ageConfirmed !== true) return res.status(400).json({ error: 'You must confirm you are 16 or older' })

  try {
    const hash = await bcrypt.hash(password, 10)
    const playerColor = color || '#4a90d9'
    const result = await pool.query(
      'INSERT INTO players (username, password_hash, color, gold, mana) VALUES ($1, $2, $3, $4, $5) RETURNING id, username, color, gold, capital_hex',
      [username, hash, playerColor, STARTING_GOLD, STARTING_MANA]
    )
    const player = result.rows[0]
    log.info('Registered', { id: player.id, username: player.username, ip: clientIp(req) })
    res.json({ token: signToken(player), player })
  } catch (err) {
    if (err.code === '23505') {
      log.debug('Registration rejected - username taken', { username, ip: clientIp(req) })
      return res.status(409).json({ error: 'Username already taken' })
    }
    log.error('POST /register failed', { err })
    res.status(500).json({ error: 'Server error' })
  }
})

router.post('/login', rateLimit({ windowMs: 10 * 60 * 1000, max: IS_DEV ? 1000 : 20, message: 'Too many login attempts - try later' }), async (req, res) => {
  const { username, password } = req.body
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' })

  try {
    // Case-insensitive (players_username_lower_idx guarantees at most one
    // match once it exists) - LIMIT 1 is defensive insurance, not load-
    // bearing, for the narrow window before that index exists/is rebuilt.
    const result = await pool.query(
      'SELECT id, username, color, gold, capital_hex, flag_pixels, motto, password_hash, last_login_date, login_streak, deleted_at FROM players WHERE LOWER(username) = LOWER($1) LIMIT 1',
      [username]
    )
    const player = result.rows[0]
    if (!player || player.deleted_at) {
      // Same "unknown user" reason for both a nonexistent username and a
      // deleted one - the response is already the generic 'Invalid
      // credentials' either way, and the log staying equally generic means
      // it can't be used to enumerate which usernames exist or once did.
      log.warn('Login failed - unknown user', { username, ip: clientIp(req) })
      return res.status(401).json({ error: 'Invalid credentials' })
    }
    delete player.deleted_at

    const valid = await bcrypt.compare(password, player.password_hash)
    if (!valid) {
      log.warn('Login failed - wrong password', { id: player.id, username: player.username, ip: clientIp(req) })
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    const { password_hash, last_login_date, login_streak, ...playerData } = player

    let loginBonus = null
    const today = new Date().toISOString().split('T')[0]
    const lastDate = last_login_date ? last_login_date.toISOString().split('T')[0] : null
    if (lastDate !== today) {
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]
      const newStreak = lastDate === yesterday ? (login_streak || 0) + 1 : 1
      const bonusGold = newStreak >= 7 ? 100 : newStreak >= 3 ? 50 : 20

      // Cap the bonus the same way the resource tick does (base + hexes + mines) -
      // using the flat GOLD_CAP_BASE here would clamp an established player's whole
      // balance down to 500 on every new-day login, wiping out territory income.
      const capRow = await pool.query(`
        SELECT COUNT(DISTINCT h.h3_index)::int AS hex_count,
               COUNT(DISTINCT CASE WHEN b.type='mine' THEN b.id END)::int AS mine_count
        FROM players p
        LEFT JOIN hexes h ON h.owner_id = p.id
        LEFT JOIN buildings b ON b.h3_index = h.h3_index
        WHERE p.id = $1
        GROUP BY p.id
      `, [playerData.id])
      const { hex_count = 0, mine_count = 0 } = capRow.rows[0] || {}
      const goldCap = GOLD_CAP_BASE + hex_count * GOLD_CAP_PER_HEX + mine_count * GOLD_CAP_PER_MINE

      await pool.query(
        'UPDATE players SET gold = LEAST(gold + $1, $2), last_login_date = $3::date, login_streak = $4 WHERE id = $5',
        [bonusGold, goldCap, today, newStreak, playerData.id]
      )
      playerData.gold = Math.min(playerData.gold + bonusGold, goldCap)
      loginBonus = { gold: bonusGold, streak: newStreak }
    }

    log.info('Login', { id: playerData.id, username: playerData.username, ip: clientIp(req), bonus: !!loginBonus })
    res.json({ token: signToken(playerData), player: playerData, loginBonus })
  } catch (err) {
    log.error('POST /login failed', { err })
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
    log.error('GET /leaderboard failed', { err })
    res.status(500).json({ error: 'Server error' })
  }
})

// Look up players by (partial) username, for jumping to a player who isn't
// in the top-5 leaderboard slice without loading the whole board. Auth +
// rate limit: the leading-wildcard ILIKE plus two GROUP BY aggregations over
// hexes/troops is a full scan per call, and the response exposes every
// player's capital/flag/alliance - not something to serve anonymously in bulk.
router.get('/search', requireAuth, rateLimit({ windowMs: 60 * 1000, max: IS_DEV ? 5000 : 120, message: 'Slow down' }), async (req, res) => {
  const q = String(req.query.q || '').trim()
  if (q.length < 2) return res.json([])
  try {
    const result = await pool.query(`
      WITH hx AS (SELECT owner_id, COUNT(*)::int AS n FROM hexes GROUP BY owner_id),
           tr AS (SELECT owner_id, SUM(quantity)::float8 AS n FROM troops GROUP BY owner_id)
      SELECT p.username, p.color, p.capital_hex, p.flag_pixels, a.tag AS alliance_tag,
        COALESCE(hx.n, 0) AS hex_count,
        COALESCE(tr.n, 0) AS total_troops
      FROM players p
      LEFT JOIN alliances a ON a.id = p.alliance_id
      LEFT JOIN hx ON hx.owner_id = p.id
      LEFT JOIN tr ON tr.owner_id = p.id
      WHERE p.username ILIKE $1 AND p.username NOT LIKE 'WILD_%'
      ORDER BY hex_count DESC, total_troops DESC
      LIMIT 10
    `, [`%${q}%`])
    res.json(result.rows)
  } catch (err) {
    log.error('GET /search failed', { err })
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
    row.unlocks = await getUnlockState(req.player.id)

    res.json(row)
  } catch (err) {
    log.error('GET /stats failed', { err })
    res.status(500).json({ error: 'Server error' })
  }
})

// One row per hex you own, everything the Empire dashboard needs to sort and
// filter a large territory without a request per hex. Income mirrors the
// per-hex share of tick.js's payout (base + built mine + strategic + city
// zone + wonder); threats/marching armies come from /military/armies, which
// the client already holds.
router.get('/empire', requireAuth, async (req, res) => {
  try {
    const id = req.player.id
    await requireUnlock(id, 'empire')
    const [hexes, troops, buildings, training, upgrading, player, orders] = await Promise.all([
      pool.query('SELECT h3_index, upgrade_level, rally_hex, claimed_at FROM hexes WHERE owner_id=$1', [id]),
      pool.query('SELECT h3_index, SUM(quantity)::int AS qty FROM troops WHERE owner_id=$1 GROUP BY h3_index', [id]),
      pool.query(`
        SELECT b.h3_index, b.type, EXTRACT(EPOCH FROM (NOW() - b.created_at)) >= $2 AS ready
        FROM buildings b JOIN hexes h ON h.h3_index = b.h3_index WHERE h.owner_id = $1
      `, [id, BUILDING_TIME_SECONDS]),
      pool.query('SELECT h3_index, SUM(quantity - delivered)::int AS qty FROM training_queue WHERE owner_id=$1 GROUP BY h3_index', [id]),
      pool.query('SELECT h3_index FROM upgrade_queue WHERE owner_id=$1', [id]),
      pool.query('SELECT capital_hex FROM players WHERE id=$1', [id]),
      pool.query('SELECT h3_index, min_troops, build FROM hex_orders WHERE owner_id=$1', [id]),
    ])
    const ordersBy = new Map(orders.rows.map(r => [r.h3_index, { min_troops: r.min_troops, build: r.build }]))
    const troopsBy = new Map(troops.rows.map(r => [r.h3_index, r.qty]))
    const trainingBy = new Map(training.rows.map(r => [r.h3_index, r.qty]))
    const upgradingSet = new Set(upgrading.rows.map(r => r.h3_index))
    const buildingsBy = new Map()
    for (const b of buildings.rows) {
      if (!buildingsBy.has(b.h3_index)) buildingsBy.set(b.h3_index, [])
      buildingsBy.get(b.h3_index).push({ type: b.type, ready: b.ready })
    }
    const wonderHexes = new Set(WONDERS.map(w => w.h3))
    const capital = player.rows[0]?.capital_hex
    const rows = hexes.rows.map(h => {
      const blds = buildingsBy.get(h.h3_index) || []
      let income = 1 + blds.filter(b => b.type === 'mine' && b.ready).length * 3
      if (STRATEGIC_HEXES.has(h.h3_index)) income += STRATEGIC_BONUS_GOLD
      if (CITY_ZONES.has(h.h3_index)) income += ZONE_BONUS_PER_HEX
      if (wonderHexes.has(h.h3_index)) income += WONDER_INCOME_GOLD
      const info = getCountry(h.h3_index)
      return {
        h3_index: h.h3_index,
        country: info?.name || null,
        is_capital: h.h3_index === capital,
        troops: troopsBy.get(h.h3_index) || 0,
        training: trainingBy.get(h.h3_index) || 0,
        buildings: blds,
        upgrade_level: h.upgrade_level,
        upgrading: upgradingSet.has(h.h3_index),
        rally_hex: h.rally_hex,
        order: ordersBy.get(h.h3_index) || null,
        income,
        strategic_name: STRATEGIC_HEXES.get(h.h3_index)?.name || null,
        claimed_at: h.claimed_at,
      }
    })
    res.json(rows)
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    log.error('GET /empire failed', { err })
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
    log.error('GET /me failed', { err })
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
  if (cleanMotto && containsBadWords(cleanMotto)) {
    return res.status(400).json({ error: 'Motto not allowed' })
  }
  try {
    const { rows } = await pool.query('UPDATE players SET flag_pixels = $1, motto = $2 WHERE id = $3 RETURNING capital_hex', [flagPixels, cleanMotto || null, req.player.id])
    if (rows[0]?.capital_hex) emitToRegion(rows[0].capital_hex, 'hexes:update')
    res.json({ ok: true })
  } catch (err) {
    log.error('POST /flag failed', { err })
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
    log.error('GET /history failed', { err })
    res.status(500).json({ error: 'Server error' })
  }
})

// GDPR / CCPA data-access ("right to portability"): every row we hold that is
// tied to this account, as one JSON document. Deliberately excludes password
// hash (a secret, not personal data to hand back) and other players' data.
router.get('/export', requireAuth, async (req, res) => {
  try {
    const id = req.player.id
    const q = (sql, params = [id]) => pool.query(sql, params).then(r => r.rows)
    const [account, hexes, troops, armies, buildings, events, history, pushSubs, chat, battles, alliance, feedback] = await Promise.all([
      q('SELECT id, username, color, gold, mana, capital_hex, flag_pixels, motto, last_login_date, login_streak, created_at, alliance_id FROM players WHERE id=$1').then(r => r[0] || null),
      q('SELECT h3_index, claimed_at, upgrade_level, rally_hex FROM hexes WHERE owner_id=$1'),
      q('SELECT h3_index, type, quantity FROM troops WHERE owner_id=$1'),
      q('SELECT from_hex, to_hex, type, quantity, arrives_at, departed_at, status FROM armies WHERE owner_id=$1'),
      q("SELECT b.h3_index, b.type, b.created_at FROM buildings b JOIN hexes h ON h.h3_index=b.h3_index WHERE h.owner_id=$1"),
      q('SELECT type, message, hex_index, quantity, read, created_at FROM events WHERE player_id=$1 ORDER BY created_at'),
      q('SELECT hex_count, recorded_at FROM hex_history WHERE player_id=$1 ORDER BY recorded_at'),
      q('SELECT endpoint, created_at FROM push_subscriptions WHERE player_id=$1'),
      q('SELECT text, alliance_id, created_at FROM chat_messages WHERE player_id=$1 ORDER BY created_at').catch(() => []),
      q('SELECT id, attacker_id, defender_id, h3_index, created_at FROM battles WHERE attacker_id=$1 OR defender_id=$1 ORDER BY created_at'),
      q(`SELECT a.name, a.tag, a.created_at FROM alliances a
         JOIN players p ON p.alliance_id = a.id WHERE p.id=$1`).then(r => r[0] || null),
      q('SELECT category, message, created_at FROM feedback WHERE player_id=$1 ORDER BY created_at'),
    ])
    res.setHeader('Content-Disposition', 'attachment; filename="realmwar-data.json"')
    res.json({ exported_at: new Date().toISOString(), account, alliance, hexes, troops, armies, buildings, events, hex_history: history, push_subscriptions: pushSubs, chat_messages: chat, battles, feedback })
  } catch (err) {
    log.error('GET /export failed', { err })
    res.status(500).json({ error: 'Server error' })
  }
})

// GDPR / CCPA erasure. Battle history FKs players(id) with no ON DELETE, and
// Champion monuments are meant to outlive accounts, so this anonymises the
// row in place (username -> deleted_<id>, all profile PII nulled, login
// blocked via deleted_at) and purges everything that is purely this player's:
// live game presence, personal events, push subscriptions, chat. What stays
// is de-identified - battle rows reference "deleted_<id>", nothing that names
// a person.
router.delete('/me', requireAuth, async (req, res) => {
  const id = req.player.id
  try {
    await withTransaction(async (tx) => {
      await tx.query('DELETE FROM buildings WHERE h3_index IN (SELECT h3_index FROM hexes WHERE owner_id=$1)', [id])
      await tx.query('DELETE FROM hexes WHERE owner_id=$1', [id])
      await tx.query('DELETE FROM troops WHERE owner_id=$1', [id])
      await tx.query('DELETE FROM armies WHERE owner_id=$1', [id])
      await tx.query('DELETE FROM training_queue WHERE owner_id=$1', [id])
      await tx.query('DELETE FROM upgrade_queue WHERE owner_id=$1', [id])
      await tx.query('DELETE FROM country_crowns WHERE player_id=$1', [id])
      await tx.query('DELETE FROM wonder_holders WHERE owner_id=$1', [id])
      await tx.query('DELETE FROM push_subscriptions WHERE player_id=$1', [id])
      await tx.query('DELETE FROM events WHERE player_id=$1', [id])
      await tx.query('DELETE FROM hex_history WHERE player_id=$1', [id])
      await tx.query('DELETE FROM feedback WHERE player_id=$1', [id])
      await tx.query('DELETE FROM chat_messages WHERE player_id=$1', [id]).catch(() => {})
      await tx.query(`
        UPDATE players SET
          username = 'deleted_' || id,
          password_hash = '',
          color = '#555555',
          gold = 0, mana = 0,
          capital_hex = NULL, flag_pixels = NULL, motto = NULL,
          alliance_id = NULL, last_login_date = NULL, login_streak = 0,
          deleted_at = NOW()
        WHERE id = $1
      `, [id])
    })
    getIO()?.emit('hexes:update')
    getIO()?.emit('armies:update')
    log.info('Account deleted', { id, ip: clientIp(req) })
    res.json({ ok: true })
  } catch (err) {
    log.error('DELETE /me failed', { err })
    res.status(500).json({ error: 'Server error' })
  }
})

export default router

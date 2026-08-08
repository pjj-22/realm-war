import { Router } from 'express'
import { timingSafeEqual } from 'crypto'
import { createRequire } from 'module'
import { getNumCells } from 'h3-js'
import { pool } from '../db.js'
import { rateLimit } from '../ratelimit.js'
import { runTick } from '../tick.js'
import { ensureBots } from '../bots.js'
import { getCurrentSeason, processSeason } from '../season.js'
import { getIO } from '../socket.js'
import { IS_DEV, TICK_INTERVAL_MS, BUILDING_TIME_SECONDS, WONDER_INCOME_GOLD } from '../config.js'
import { GM_EVENTS, triggerEvent } from '../gmEvents.js'
import { STRATEGIC_HEXES, STRATEGIC_BONUS_GOLD, CITY_ZONES, ZONE_BONUS_PER_HEX } from '../strategic.js'
import { WONDERS } from '../wonders.js'
import { currentMarchHex, findMarchPath, pathStepCosts } from '../marchPath.js'

const router = Router()

function secretsMatch(given, secret) {
  const a = Buffer.from(String(given ?? ''))
  const b = Buffer.from(secret)
  // length leaks through timingSafeEqual's precondition; compare a against
  // itself when lengths differ so the work done is identical either way
  return a.length === b.length ? timingSafeEqual(a, b) : (timingSafeEqual(a, a), false)
}

function requireAdmin(req, res, next) {
  const secret = process.env.ADMIN_SECRET
  if (!secret) return res.status(503).json({ error: 'Admin not configured (set ADMIN_SECRET)' })
  if (!secretsMatch(req.headers['x-admin-secret'], secret)) return res.status(403).json({ error: 'Forbidden' })
  next()
}

router.use(rateLimit({ windowMs: 60 * 1000, max: IS_DEV ? 1000 : 300, message: 'Too many admin requests' }))
router.use(requireAdmin)

// Static world outline for the admin world-map view - land-110m (56KB) is
// plenty for a background silhouette at that scale, versus terrain.js's
// land-10m (3MB) which exists for actual per-hex land/ocean testing. Built
// once at module load since the topojson is static; every request reuses it.
const LAND_OUTLINE = (() => {
  const require = createRequire(import.meta.url)
  const { feature } = require('topojson-client')
  const topo = require('world-atlas/land-110m.json')
  const geom = feature(topo, topo.objects.land).features[0].geometry
  return geom.type === 'MultiPolygon' ? geom.coordinates.map(p => p[0]) : [geom.coordinates[0]]
})()

router.get('/world/land-outline', (req, res) => {
  res.json(LAND_OUTLINE)
})

// Every claimed hex on the map, for the static admin world-map view - small
// (low thousands of rows even at full game scale), so a single unpaginated
// fetch is fine, unlike the player-facing /hexes route which scopes to
// viewport/ownership for exactly that reason.
router.get('/hexes/all', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT h.h3_index, h.owner_id, p.username, p.color, (h.h3_index = p.capital_hex) AS is_capital
      FROM hexes h JOIN players p ON p.id = h.owner_id
    `)
    res.json(r.rows)
  } catch (err) {
    console.error('[admin] GET /hexes/all failed:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

router.get('/overview', async (req, res) => {
  try {
    const [players, bots, hexes, armies, battles, troops, gold, training, upgrades, alliances] = await Promise.all([
      pool.query("SELECT COUNT(*)::integer AS n FROM players WHERE username NOT LIKE 'BOT_%' AND username NOT LIKE 'WILD_%'"),
      pool.query("SELECT COUNT(*)::integer AS n FROM players WHERE username LIKE 'BOT_%'"),
      pool.query('SELECT COUNT(*)::integer AS n FROM hexes'),
      pool.query("SELECT COUNT(*)::integer AS n FROM armies WHERE status='marching'"),
      pool.query("SELECT COUNT(*)::integer AS n FROM battles WHERE status='active'"),
      pool.query('SELECT COALESCE(SUM(quantity),0)::float8 AS n FROM troops'),
      pool.query("SELECT COALESCE(SUM(gold),0)::integer AS n FROM players WHERE username NOT LIKE 'BOT_%' AND username NOT LIKE 'WILD_%'"),
      pool.query('SELECT COUNT(*)::integer AS n FROM training_queue'),
      pool.query('SELECT COUNT(*)::integer AS n FROM upgrade_queue'),
      pool.query('SELECT COUNT(*)::integer AS n FROM alliances'),
    ])
    res.json({
      human_players: players.rows[0].n,
      bot_players: bots.rows[0].n,
      total_hexes: hexes.rows[0].n,
      active_armies: armies.rows[0].n,
      active_battles: battles.rows[0].n,
      total_troops: troops.rows[0].n,
      total_gold: gold.rows[0].n,
      training_queued: training.rows[0].n,
      upgrade_queued: upgrades.rows[0].n,
      alliances: alliances.rows[0].n,
    })
  } catch (err) {
    console.error('[admin] GET /overview failed:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// Live activity feed - the Herald world events with player names
router.get('/activity', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 60, 200)
    const result = await pool.query(`
      SELECT w.id, w.type, w.message, w.hex_index, w.created_at,
        p.username, p.color
      FROM world_events w
      LEFT JOIN players p ON p.id = w.player_id
      ORDER BY w.created_at DESC
      LIMIT $1
    `, [limit])
    res.json(result.rows)
  } catch (err) {
    console.error('[admin] GET /activity failed:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

router.get('/battles', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT b.id, b.h3_index, b.attacker_strength, b.defender_strength,
        b.attacker_losses, b.defender_losses, b.round_number,
        b.created_at, b.last_round_at,
        a.username AS attacker_name, a.color AS attacker_color,
        d.username AS defender_name, d.color AS defender_color
      FROM battles b
      JOIN players a ON a.id = b.attacker_id
      JOIN players d ON d.id = b.defender_id
      WHERE b.status='active'
      ORDER BY b.created_at DESC
    `)
    res.json(result.rows)
  } catch (err) {
    console.error('[admin] GET /battles failed:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// Recent battles, active or concluded - for picking a battle to inspect in
// the round-by-round dice log below (debugging a disputed outcome usually
// happens after the fact, once someone notices the result looks off).
router.get('/battles/recent', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 30, 100)
    const result = await pool.query(`
      SELECT b.id, b.h3_index, b.status, b.defender_advantage_troops, b.defender_frontline, b.round_number,
        b.attacker_troops, b.defender_troops, b.attacker_losses, b.defender_losses,
        b.created_at, b.ended_at,
        a.username AS attacker_name, a.color AS attacker_color,
        d.username AS defender_name, d.color AS defender_color
      FROM battles b
      JOIN players a ON a.id = b.attacker_id
      JOIN players d ON d.id = b.defender_id
      ORDER BY b.created_at DESC
      LIMIT $1
    `, [limit])
    res.json(result.rows)
  } catch (err) {
    console.error('[admin] GET /battles/recent failed:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// Round-by-round dice log for one battle - the actual atk_dice/def_dice
// rolled each clash, not a reconstruction from final totals.
router.get('/battles/:id/rounds', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT round_number, defender_advantage_troops, atk_frontline_before, def_frontline_before,
        atk_dice, def_dice, atk_losses, def_losses, atk_troops_after, def_troops_after, created_at
      FROM battle_rounds
      WHERE battle_id = $1
      ORDER BY round_number ASC
    `, [req.params.id])
    res.json(result.rows)
  } catch (err) {
    console.error('[admin] GET /battles/:id/rounds failed:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

router.get('/armies', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT ar.id, ar.from_hex, ar.to_hex, ar.type, ar.quantity,
        ar.arrives_at, ar.departed_at, ar.path,
        p.username, p.color
      FROM armies ar
      JOIN players p ON p.id = ar.owner_id
      WHERE ar.status='marching'
      ORDER BY ar.arrives_at ASC
      LIMIT 200
    `)
    res.json(result.rows.map(a => {
      const path = a.path?.length ? a.path : findMarchPath(a.from_hex, a.to_hex).path
      return { ...a, current_hex: currentMarchHex(a, path, pathStepCosts(path)) }
    }))
  } catch (err) {
    console.error('[admin] GET /armies failed:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

router.get('/system', async (req, res) => {
  try {
    const season = getCurrentSeason()
    const [training, upgrades, chats, crowns] = await Promise.all([
      pool.query('SELECT COUNT(*)::integer AS n FROM training_queue'),
      pool.query('SELECT COUNT(*)::integer AS n FROM upgrade_queue'),
      pool.query('SELECT COUNT(*)::integer AS n FROM chat_messages'),
      pool.query('SELECT COUNT(*)::integer AS n FROM country_crowns'),
    ])
    res.json({
      dev_mode: IS_DEV,
      tick_interval_ms: TICK_INTERVAL_MS,
      uptime_seconds: Math.floor(process.uptime()),
      memory_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      server_time: new Date().toISOString(),
      node_version: process.version,
      season: season ? {
        number: season.number,
        started_at: season.started_at,
        ends_at: season.ends_at,
        hex_resolution: season.hex_resolution,
        world_hex_count: getNumCells(season.hex_resolution),
      } : null,
      training_queued: training.rows[0].n,
      upgrade_queued: upgrades.rows[0].n,
      chat_messages: chats.rows[0].n,
      country_crowns: crowns.rows[0].n,
    })
  } catch (err) {
    console.error('[admin] GET /system failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// Retention: DAU/WAU/MAU and D1/D7/D30 cohort return-rates, computed purely
// from players.created_at/last_login_date - no separate session log exists,
// so "retained" here means "still had a login on/after day N", not "logged
// in on exactly day N" (rolling, not exact-day, retention).
router.get('/retention', async (req, res) => {
  try {
    const NOT_NPC = "username NOT LIKE 'BOT_%' AND username NOT LIKE 'WILD_%'"
    const result = await pool.query(`
      SELECT
        COUNT(*)::int AS total_signups,
        COUNT(*) FILTER (WHERE last_login_date = CURRENT_DATE)::int AS dau,
        COUNT(*) FILTER (WHERE last_login_date >= CURRENT_DATE - INTERVAL '6 days')::int AS wau,
        COUNT(*) FILTER (WHERE last_login_date >= CURRENT_DATE - INTERVAL '29 days')::int AS mau,
        COUNT(*) FILTER (WHERE created_at::date <= CURRENT_DATE - 1)::int AS d1_cohort,
        COUNT(*) FILTER (WHERE created_at::date <= CURRENT_DATE - 1
          AND last_login_date >= created_at::date + 1)::int AS d1_retained,
        COUNT(*) FILTER (WHERE created_at::date <= CURRENT_DATE - 7)::int AS d7_cohort,
        COUNT(*) FILTER (WHERE created_at::date <= CURRENT_DATE - 7
          AND last_login_date >= created_at::date + 7)::int AS d7_retained,
        COUNT(*) FILTER (WHERE created_at::date <= CURRENT_DATE - 30)::int AS d30_cohort,
        COUNT(*) FILTER (WHERE created_at::date <= CURRENT_DATE - 30
          AND last_login_date >= created_at::date + 30)::int AS d30_retained,
        COUNT(*) FILTER (WHERE login_streak = 0)::int AS streak_0,
        COUNT(*) FILTER (WHERE login_streak = 1)::int AS streak_1,
        COUNT(*) FILTER (WHERE login_streak BETWEEN 2 AND 6)::int AS streak_2_6,
        COUNT(*) FILTER (WHERE login_streak BETWEEN 7 AND 29)::int AS streak_7_29,
        COUNT(*) FILTER (WHERE login_streak >= 30)::int AS streak_30_plus
      FROM players
      WHERE ${NOT_NPC}
    `)
    const r = result.rows[0]
    const pct = (retained, cohort) => cohort > 0 ? Math.round((retained / cohort) * 1000) / 10 : null
    res.json({
      total_signups: r.total_signups,
      dau: r.dau, wau: r.wau, mau: r.mau,
      retention: {
        d1: { cohort: r.d1_cohort, retained: r.d1_retained, pct: pct(r.d1_retained, r.d1_cohort) },
        d7: { cohort: r.d7_cohort, retained: r.d7_retained, pct: pct(r.d7_retained, r.d7_cohort) },
        d30: { cohort: r.d30_cohort, retained: r.d30_retained, pct: pct(r.d30_retained, r.d30_cohort) },
      },
      streaks: {
        '0': r.streak_0, '1': r.streak_1, '2-6': r.streak_2_6, '7-29': r.streak_7_29, '30+': r.streak_30_plus,
      },
    })
  } catch (err) {
    console.error('[admin] GET /retention failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

router.get('/players', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.id, p.username, p.color, p.gold, p.capital_hex, p.login_streak,
        p.last_login_date, p.created_at,
        COALESCE(h.hex_count, 0)::integer AS hex_count,
        COALESCE(t.total_troops, 0)::float8 AS total_troops
      FROM players p
      LEFT JOIN (SELECT owner_id, COUNT(*) AS hex_count FROM hexes GROUP BY owner_id) h ON h.owner_id = p.id
      LEFT JOIN (SELECT owner_id, SUM(quantity) AS total_troops FROM troops GROUP BY owner_id) t ON t.owner_id = p.id
      ORDER BY hex_count DESC, p.gold DESC
    `)

    // Gold income per harvest, mirroring tick.js's actual payout exactly:
    // base (1/hex) + mines (3, only once built) + strategic hexes (+5 each) +
    // city-zone hexes (+2 each) + wonders. One pass over all hexes rather
    // than a per-player query, since we need every owner's hexes anyway.
    const hexRows = await pool.query(`
      SELECT h.owner_id, h.h3_index,
        COALESCE(SUM(CASE WHEN b.type='mine' AND EXTRACT(EPOCH FROM (NOW() - b.created_at)) >= $1 THEN 1 ELSE 0 END), 0)::integer AS mines
      FROM hexes h
      LEFT JOIN buildings b ON b.h3_index = h.h3_index
      WHERE h.owner_id IS NOT NULL
      GROUP BY h.owner_id, h.h3_index
    `, [BUILDING_TIME_SECONDS])

    const wonderHexes = new Set(WONDERS.map(w => w.h3))
    const incomeByOwner = new Map()
    for (const { owner_id, h3_index, mines } of hexRows.rows) {
      let income = (incomeByOwner.get(owner_id) || 0) + 1 + mines * 3
      if (STRATEGIC_HEXES.has(h3_index)) income += STRATEGIC_BONUS_GOLD
      if (CITY_ZONES.has(h3_index)) income += ZONE_BONUS_PER_HEX
      if (wonderHexes.has(h3_index)) income += WONDER_INCOME_GOLD
      incomeByOwner.set(owner_id, income)
    }

    const rows = result.rows.map(p => ({ ...p, income_per_harvest: incomeByOwner.get(p.id) || 0 }))
    res.json(rows)
  } catch (err) {
    console.error('[admin] GET /players failed:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

router.post('/players/:id/gold', async (req, res) => {
  const { delta } = req.body
  if (typeof delta !== 'number') return res.status(400).json({ error: 'delta required' })
  try {
    const result = await pool.query(
      'UPDATE players SET gold = GREATEST(0, gold + $1) WHERE id = $2 RETURNING gold',
      [delta, req.params.id]
    )
    if (!result.rows[0]) return res.status(404).json({ error: 'Player not found' })
    res.json({ gold: result.rows[0].gold })
  } catch (err) {
    console.error('[admin] POST /players/:id/gold failed:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

router.delete('/players/:id', async (req, res) => {
  try {
    const check = await pool.query('SELECT username FROM players WHERE id=$1', [req.params.id])
    if (!check.rows[0]) return res.status(404).json({ error: 'Player not found' })
    const username = check.rows[0].username
    await pool.query('DELETE FROM armies WHERE owner_id=$1', [req.params.id])
    await pool.query('DELETE FROM troops WHERE owner_id=$1', [req.params.id])
    const ownedHexes = await pool.query('SELECT h3_index FROM hexes WHERE owner_id=$1', [req.params.id])
    const h3s = ownedHexes.rows.map(r => r.h3_index)
    if (h3s.length) {
      await pool.query('DELETE FROM buildings WHERE h3_index = ANY($1)', [h3s])
      await pool.query('DELETE FROM hexes WHERE owner_id=$1', [req.params.id])
    }
    await pool.query('DELETE FROM players WHERE id=$1', [req.params.id])
    getIO()?.emit('hexes:update')
    res.json({ deleted: username })
  } catch (err) {
    console.error('[admin] DELETE /players/:id failed:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

router.post('/tick', async (req, res) => {
  try {
    await runTick()
    getIO()?.emit('tick')
    res.json({ ok: true })
  } catch (err) {
    console.error('[admin] POST /tick failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// End the current season immediately (testing / emergencies)
router.post('/season/end', async (req, res) => {
  try {
    const season = getCurrentSeason()
    if (!season) return res.status(404).json({ error: 'No active season' })
    await pool.query('UPDATE seasons SET ends_at=NOW() WHERE id=$1', [season.id])
    season.ends_at = new Date(0) // force the cached row past its deadline
    await processSeason()
    res.json({ ok: true, ended: season.number })
  } catch (err) {
    console.error('[admin] POST /season/end failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// Queue the H3 resolution the *next* season should begin at. Consumed by
// ensureSeason() (season.js), which stores it on the new season row, updates
// worldState's activeResolution (read by bots.js for spawn placement), and
// rebuilds strategic/city-zone hexes (strategic.js) and wonders (wonders.js)
// at the new resolution. The client detects the season-number rollover and
// force-reloads if the resolution changed, since rebuilding its hex grid and
// MapLibre sources live in place would be far riskier than a fresh reload.
router.post('/season/next-resolution', async (req, res) => {
  const { resolution } = req.body
  if (!Number.isInteger(resolution) || resolution < 0 || resolution > 15) {
    return res.status(400).json({ error: 'resolution must be an integer 0-15 (H3\'s valid range)' })
  }
  try {
    await pool.query(
      'INSERT INTO season_config (id, next_hex_resolution) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET next_hex_resolution=$1',
      [resolution]
    )
    res.json({ ok: true, next_hex_resolution: resolution })
  } catch (err) {
    console.error('[admin] POST /season/next-resolution failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

router.get('/season/next-resolution', async (req, res) => {
  try {
    const r = await pool.query('SELECT next_hex_resolution FROM season_config WHERE id=1')
    res.json({ next_hex_resolution: r.rows[0]?.next_hex_resolution ?? null })
  } catch (err) {
    console.error('[admin] GET /season/next-resolution failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// Same pattern as next-resolution above: queues how many days the *next*
// season should run (SEASON_DURATION_MS's default otherwise), consumed once
// that season is actually created (see ensureSeason in season.js).
router.post('/season/next-duration', async (req, res) => {
  const { days } = req.body
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    return res.status(400).json({ error: 'days must be an integer 1-365' })
  }
  try {
    await pool.query(
      'INSERT INTO season_config (id, next_season_days) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET next_season_days=$1',
      [days]
    )
    res.json({ ok: true, next_season_days: days })
  } catch (err) {
    console.error('[admin] POST /season/next-duration failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

router.get('/season/next-duration', async (req, res) => {
  try {
    const r = await pool.query('SELECT next_season_days FROM season_config WHERE id=1')
    res.json({ next_season_days: r.rows[0]?.next_season_days ?? null })
  } catch (err) {
    console.error('[admin] GET /season/next-duration failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

router.post('/bots/reset', async (req, res) => {
  try {
    const bots = await pool.query('SELECT id FROM players WHERE username LIKE \'BOT_%\'')
    for (const { id } of bots.rows) {
      // battles has no ON DELETE CASCADE on attacker_id/defender_id (unlike
      // most other player-owned tables) - clear it first or the DELETE FROM
      // players below hits a foreign key violation. battle_participants
      // cascades from battles.id, so this covers it too.
      await pool.query('DELETE FROM battles WHERE attacker_id=$1 OR defender_id=$1', [id])
      await pool.query('DELETE FROM armies WHERE owner_id=$1', [id])
      await pool.query('DELETE FROM troops WHERE owner_id=$1', [id])
      const owned = await pool.query('SELECT h3_index FROM hexes WHERE owner_id=$1', [id])
      const h3s = owned.rows.map(r => r.h3_index)
      if (h3s.length) {
        await pool.query('DELETE FROM buildings WHERE h3_index = ANY($1)', [h3s])
        await pool.query('DELETE FROM hexes WHERE owner_id=$1', [id])
      }
      await pool.query('DELETE FROM players WHERE id=$1', [id])
    }
    await ensureBots(getCurrentSeason()?.number)
    getIO()?.emit('hexes:update')
    res.json({ ok: true, reset: bots.rows.length })
  } catch (err) {
    console.error('[admin] POST /bots/reset failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

router.get('/events/types', (req, res) => res.json(GM_EVENTS))

router.post('/event', async (req, res) => {
  const { type, param } = req.body
  try {
    const result = await triggerEvent(type, param)
    const io = getIO()
    io?.emit('hexes:update')
    io?.emit('armies:update')
    io?.emit('events:new')
    io?.emit('world:new')
    io?.emit('tick') // gold/troops changed (famine, gold rush, plague) - refresh the resource bar
    res.json(result)
  } catch (err) {
    console.error('[admin] POST /event failed:', err.message)
    res.status(400).json({ error: err.message })
  }
})

export default router

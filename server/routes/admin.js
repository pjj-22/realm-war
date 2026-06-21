import { Router } from 'express'
import { pool } from '../db.js'
import { runTick } from '../tick.js'
import { ensureBots } from '../bots.js'
import { getCurrentSeason, processSeason } from '../season.js'
import { getIO } from '../socket.js'
import { DEV_MODE, TICK_INTERVAL_MS } from '../config.js'
import { GM_EVENTS, triggerEvent } from '../gmEvents.js'

const router = Router()

function requireAdmin(req, res, next) {
  const secret = process.env.ADMIN_SECRET
  if (!secret) return res.status(503).json({ error: 'Admin not configured (set ADMIN_SECRET)' })
  if (req.headers['x-admin-secret'] !== secret) return res.status(403).json({ error: 'Forbidden' })
  next()
}

router.use(requireAdmin)

// Server overview
router.get('/overview', async (req, res) => {
  try {
    const [players, bots, hexes, armies, battles, troops, gold, training, upgrades, alliances] = await Promise.all([
      pool.query("SELECT COUNT(*)::integer AS n FROM players WHERE username NOT LIKE 'BOT_%' AND username NOT LIKE 'WILD_%'"),
      pool.query("SELECT COUNT(*)::integer AS n FROM players WHERE username LIKE 'BOT_%'"),
      pool.query('SELECT COUNT(*)::integer AS n FROM hexes'),
      pool.query("SELECT COUNT(*)::integer AS n FROM armies WHERE status='marching'"),
      pool.query("SELECT COUNT(*)::integer AS n FROM battles WHERE status='active'"),
      pool.query('SELECT COALESCE(SUM(quantity),0)::integer AS n FROM troops'),
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
  } catch { res.status(500).json({ error: 'Server error' }) }
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
  } catch { res.status(500).json({ error: 'Server error' }) }
})

// Active battles with both sides resolved
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
  } catch { res.status(500).json({ error: 'Server error' }) }
})

// In-flight armies
router.get('/armies', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT ar.id, ar.from_hex, ar.to_hex, ar.type, ar.quantity,
        ar.arrives_at, ar.departed_at,
        p.username, p.color
      FROM armies ar
      JOIN players p ON p.id = ar.owner_id
      WHERE ar.status='marching'
      ORDER BY ar.arrives_at ASC
      LIMIT 200
    `)
    res.json(result.rows)
  } catch { res.status(500).json({ error: 'Server error' }) }
})

// System health: season, queues, process info, config
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
      dev_mode: DEV_MODE,
      tick_interval_ms: TICK_INTERVAL_MS,
      uptime_seconds: Math.floor(process.uptime()),
      memory_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      server_time: new Date().toISOString(),
      node_version: process.version,
      season: season ? {
        number: season.number,
        started_at: season.started_at,
        ends_at: season.ends_at,
      } : null,
      training_queued: training.rows[0].n,
      upgrade_queued: upgrades.rows[0].n,
      chat_messages: chats.rows[0].n,
      country_crowns: crowns.rows[0].n,
    })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// All players
router.get('/players', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.id, p.username, p.color, p.gold, p.capital_hex, p.login_streak,
        p.last_login_date, p.created_at,
        COUNT(DISTINCT h.h3_index)::integer AS hex_count,
        COALESCE(SUM(t.quantity), 0)::integer AS total_troops
      FROM players p
      LEFT JOIN hexes h ON h.owner_id = p.id
      LEFT JOIN troops t ON t.owner_id = p.id
      GROUP BY p.id
      ORDER BY hex_count DESC, p.gold DESC
    `)
    res.json(result.rows)
  } catch { res.status(500).json({ error: 'Server error' }) }
})

// Adjust gold
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
  } catch { res.status(500).json({ error: 'Server error' }) }
})

// Delete player (cascade hexes, troops, buildings, armies)
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
  } catch { res.status(500).json({ error: 'Server error' }) }
})

// Force tick
router.post('/tick', async (req, res) => {
  try {
    await runTick()
    getIO()?.emit('tick')
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
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
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// Reset bots - wipe all BOT_ players and re-seed
router.post('/bots/reset', async (req, res) => {
  try {
    const bots = await pool.query('SELECT id FROM players WHERE username LIKE \'BOT_%\'')
    for (const { id } of bots.rows) {
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
    await ensureBots()
    getIO()?.emit('hexes:update')
    res.json({ ok: true, reset: bots.rows.length })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// Available game-master events and their tunable knob (drives the admin UI)
router.get('/events/types', (req, res) => res.json(GM_EVENTS))

// Fire an instant, global "act of god" event
router.post('/event', async (req, res) => {
  const { type, param } = req.body
  try {
    const result = await triggerEvent(type, param)
    const io = getIO()
    io?.emit('hexes:update')
    io?.emit('armies:update')
    io?.emit('events:new')
    io?.emit('world:new')
    res.json(result)
  } catch (err) { res.status(400).json({ error: err.message }) }
})

export default router

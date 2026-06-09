import { Router } from 'express'
import { pool } from '../db.js'
import { runTick } from '../tick.js'
import { ensureBots } from '../bots.js'
import { getIO } from '../socket.js'

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
    const [players, hexes, armies, battles] = await Promise.all([
      pool.query('SELECT COUNT(*)::integer AS n FROM players WHERE username NOT LIKE \'BOT_%\''),
      pool.query('SELECT COUNT(*)::integer AS n FROM hexes'),
      pool.query('SELECT COUNT(*)::integer AS n FROM armies WHERE arrived = false'),
      pool.query('SELECT COUNT(*)::integer AS n FROM battles WHERE resolved = false'),
    ])
    res.json({
      human_players: players.rows[0].n,
      total_hexes: hexes.rows[0].n,
      active_armies: armies.rows[0].n,
      active_battles: battles.rows[0].n,
    })
  } catch { res.status(500).json({ error: 'Server error' }) }
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

export default router

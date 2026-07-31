import { pool } from './db.js'
import { getIO } from './socket.js'
import { SEASON_DURATION_MS, STARTING_GOLD, SEASON_PODIUM_BONUS, HEX_RESOLUTION, SPEED_DIV } from './config.js'
import { respawnBots } from './bots.js'
import { sendPush } from './push.js'
import { recordMonument } from './monuments.js'
import { seedCapitalGarrisons } from './wild.js'
import { setActiveResolution } from './worldState.js'
import { rebuildStrategicData } from './strategic.js'
import { rebuildWonders } from './wonders.js'

let current = null // cached active season row

export async function ensureSeason() {
  try {
    const r = await pool.query("SELECT * FROM seasons WHERE status='active' ORDER BY number DESC LIMIT 1")
    if (r.rows[0]) {
      current = r.rows[0]
      setActiveResolution(current.hex_resolution)
      rebuildStrategicData(current.hex_resolution)
      rebuildWonders(current.hex_resolution)
      return current
    }
    const next = await pool.query('SELECT COALESCE(MAX(number), 0) + 1 AS n FROM seasons')

    // An admin can queue a resolution and/or duration for the *next* season
    // only (routes/admin.js) - consume both here so they apply to exactly the
    // one season they were set for, then fall back to defaults afterward
    // instead of sticking forever.
    const pending = await pool.query('SELECT next_hex_resolution, next_season_days FROM season_config WHERE id=1')
    const resolution = pending.rows[0]?.next_hex_resolution ?? HEX_RESOLUTION
    const queuedDays = pending.rows[0]?.next_season_days
    const durationMs = queuedDays != null ? (queuedDays * 24 * 60 * 60 * 1000) / SPEED_DIV : SEASON_DURATION_MS
    const ends = new Date(Date.now() + durationMs)
    await pool.query('UPDATE season_config SET next_hex_resolution=NULL, next_season_days=NULL WHERE id=1')

    const ins = await pool.query(
      "INSERT INTO seasons (number, ends_at, status, hex_resolution) VALUES ($1, $2, 'active', $3) RETURNING *",
      [next.rows[0].n, ends, resolution]
    )
    current = ins.rows[0]
    // Every downstream consumer of "what resolution is live right now" (bot
    // spawn placement, strategic/city-zone hexes) reads through worldState -
    // set it before anything that places a hex runs (seedCapitalGarrisons,
    // then ensureBots/respawnBots at the call sites in tick.js).
    setActiveResolution(resolution)
    rebuildStrategicData(resolution)
    rebuildWonders(resolution)
    console.log(`[season] Season ${current.number} begins at resolution ${resolution} - ends ${ends.toISOString()}`)
    await seedCapitalGarrisons()
    getIO()?.emit('season:update')
    return current
  } catch (err) {
    console.error('[season] ensure error:', err.message)
    return null
  }
}

export function getCurrentSeason() {
  return current
}

// Live standings: most hexes wins, troops break ties; crowns are bragging rights
export async function computeStandings(limit = 10) {
  const r = await pool.query(`
    WITH hx AS (SELECT owner_id, COUNT(*)::int AS n FROM hexes GROUP BY owner_id),
         tr AS (SELECT owner_id, SUM(quantity)::float8 AS n FROM troops GROUP BY owner_id),
         cr AS (SELECT player_id, COUNT(*)::int AS n FROM country_crowns GROUP BY player_id),
         ch AS (SELECT winner_id, COUNT(*)::int AS n FROM seasons WHERE status='ended' AND winner_id IS NOT NULL GROUP BY winner_id)
    SELECT p.id, p.username, p.color, a.tag AS alliance_tag,
      COALESCE(hx.n, 0) AS hex_count,
      COALESCE(tr.n, 0) AS total_troops,
      COALESCE(cr.n, 0) AS crowns,
      COALESCE(ch.n, 0) AS champion_titles
    FROM players p
    LEFT JOIN alliances a ON a.id = p.alliance_id
    LEFT JOIN hx ON hx.owner_id = p.id
    LEFT JOIN tr ON tr.owner_id = p.id
    LEFT JOIN cr ON cr.player_id = p.id
    LEFT JOIN ch ON ch.winner_id = p.id
    WHERE p.username NOT LIKE 'WILD_%'
      AND (COALESCE(hx.n, 0) > 0 OR COALESCE(tr.n, 0) > 0)
    ORDER BY hex_count DESC, total_troops DESC
    LIMIT $1
  `, [limit])
  return r.rows
}

// Called on a short interval: end the season when its clock runs out,
// crown the Champion, snapshot the final standings, reset the world.
export async function processSeason() {
  try {
    if (!current) await ensureSeason()
    if (!current || new Date(current.ends_at) > new Date()) return

    const season = current
    const standings = await computeStandings(10)
    const winner = standings[0] || null

    // Free stats: battles/hexes are about to be wiped below anyway, so a
    // couple of aggregate queries against data that already exists costs
    // nothing extra beyond the reset that was already happening - no new
    // per-tick tracking. attacker_losses/defender_losses accumulate on each
    // battles row as rounds resolve (see processBattleRounds in tick.js), so
    // summing them here gives the season's true total troop losses, not
    // just a final-state snapshot.
    const battleAgg = await pool.query(
      "SELECT COUNT(*)::int AS battles, COALESCE(SUM(attacker_losses + defender_losses), 0)::float8 AS troop_losses FROM battles"
    )
    const hexAgg = await pool.query('SELECT COUNT(*)::int AS n FROM hexes')
    const stats = {
      battles: battleAgg.rows[0].battles,
      troop_losses: Math.round(battleAgg.rows[0].troop_losses),
      final_hex_count: hexAgg.rows[0].n,
    }

    await pool.query(
      "UPDATE seasons SET status='ended', ended_at=NOW(), winner_id=$1, snapshot=$2, stats=$3 WHERE id=$4",
      [winner?.id || null, JSON.stringify(standings), JSON.stringify(stats), season.id]
    )
    console.log(`[season] Season ${season.number} ENDED - Champion: ${winner?.username || 'nobody'}`)

    await pool.query(
      'INSERT INTO world_events (type, message, player_id) VALUES ($1,$2,$3)',
      ['season', winner
        ? `Season ${season.number} is over - ${winner.username} is crowned Champion with ${winner.hex_count} hexes! A new age begins.`
        : `Season ${season.number} is over. A new age begins.`,
       winner?.id || null]
    )
    for (let i = 0; i < Math.min(3, standings.length); i++) {
      await pool.query(
        'INSERT INTO events (player_id, type, message) VALUES ($1,$2,$3)',
        [standings[i].id, 'season', `Season ${season.number} final standings: #${i + 1} with ${standings[i].hex_count} hexes`]
      )
    }
    const subs = await pool.query('SELECT DISTINCT player_id FROM push_subscriptions')
    for (const { player_id } of subs.rows) {
      sendPush(player_id, `Season ${season.number} is over!`,
        winner ? `${winner.username} is Champion. The map has reset - claim your new capital!` : 'The map has reset - claim your new capital!')
    }

    // Champion's Monument - raised at the winner's capital before the wipe
    // nulls it. Permanent: monuments are exempt from the reset below.
    if (winner) {
      const monument = await recordMonument(pool, { seasonNumber: season.number, winnerId: winner.id })
      if (monument) {
        await pool.query(
          'INSERT INTO world_events (type, message, hex_index, player_id) VALUES ($1,$2,$3,$4)',
          ['monument', `A monument to ${winner.username} rises where their capital stood - Champion of Age ${season.number}, remembered forever.`, monument.h3_index, winner.id]
        )
      }
    }

    // The great reset - accounts, alliances, chat, and history persist
    await pool.query('DELETE FROM battle_participants')
    await pool.query('DELETE FROM battles')
    await pool.query('DELETE FROM armies')
    await pool.query('DELETE FROM training_queue')
    await pool.query('DELETE FROM upgrade_queue')
    await pool.query('DELETE FROM troops')
    await pool.query('DELETE FROM buildings')
    await pool.query('DELETE FROM hexes')
    await pool.query('DELETE FROM country_crowns')
    await pool.query('DELETE FROM wonder_holders')
    await pool.query('UPDATE players SET capital_hex=NULL, gold=$1', [STARTING_GOLD])
    // Podium gold carries into the new age
    for (let i = 0; i < Math.min(SEASON_PODIUM_BONUS.length, standings.length); i++) {
      await pool.query('UPDATE players SET gold = gold + $1 WHERE id = $2', [SEASON_PODIUM_BONUS[i], standings[i].id])
    }

    current = null
    const next = await ensureSeason()
    await respawnBots(next?.number)

    const io = getIO()
    if (io) {
      io.emit('season:update')
      io.emit('hexes:update')
      io.emit('armies:update')
      io.emit('battle:update')
      io.emit('events:new')
      io.emit('world:new')
      io.emit('tick')
    }
  } catch (err) {
    console.error('[season] process error:', err.message)
  }
}

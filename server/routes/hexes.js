import { Router } from 'express'
import { gridDisk, cellToLatLng, cellToParent } from 'h3-js'
import { pool } from '../db.js'
import { requireAuth } from '../auth.js'
import { getIO } from '../socket.js'
import { isOcean } from '../terrain.js'
import { getCountry } from '../countries.js'
import { STARTING_TROOPS, PROJECTION_GARRISON, PROJECTION_EMPIRE, MIN_TROOPS_TO_CLAIM } from '../config.js'
import { STRATEGIC_HEXES, STRATEGIC_BONUS_GOLD } from '../strategic.js'
import { seedCampsAround } from '../wild.js'
import { foundCapital } from '../founding.js'

const router = Router()

// Shared by every "give me full claim data for these hexes" route below -
// same base query, just a different WHERE. whereClause must reference $1
// (and may reference further placeholders via extraParams).
async function queryEnrichedHexes(whereClause, params) {
  const result = await pool.query(`
    WITH power AS (SELECT owner_id, SUM(quantity)::float8 AS total FROM troops GROUP BY owner_id)
    SELECT h.h3_index, h.owner_id, h.upgrade_level, h.rally_hex, h.claimed_at, p.color, p.username, p.capital_hex, p.flag_pixels, p.motto,
      COALESCE(SUM(DISTINCT t.quantity), 0)::float8 AS troop_count,
      COALESCE(MAX(power.total), 0)::float8 AS owner_power,
      COALESCE(array_agg(DISTINCT b.type) FILTER (WHERE b.type IS NOT NULL), '{}') AS building_types
    FROM hexes h
    JOIN players p ON p.id = h.owner_id
    LEFT JOIN power ON power.owner_id = h.owner_id
    LEFT JOIN troops t ON t.h3_index = h.h3_index
    LEFT JOIN buildings b ON b.h3_index = h.h3_index
    WHERE ${whereClause}
    GROUP BY h.h3_index, h.owner_id, h.upgrade_level, h.rally_hex, p.color, p.username, p.capital_hex, p.flag_pixels, p.motto
  `, params)
  return result.rows.map(h => {
    const info = getCountry(h.h3_index)
    const strategic = STRATEGIC_HEXES.get(h.h3_index)
    // Power projection: huge garrisons (or huge empires) can't hide in fog
    const projected = h.troop_count >= PROJECTION_GARRISON || h.owner_power >= PROJECTION_EMPIRE
    const { owner_power, ...rest } = h
    return {
      ...rest,
      projected,
      country_name: info?.name || null,
      country_continent: info?.continent || null,
      strategic_name: strategic?.name || null,
      strategic_bonus: strategic ? STRATEGIC_BONUS_GOLD : 0,
      strategic_primary: strategic?.primary || false,
    }
  })
}

// Full-world dump - kept for admin/debug use, but the client no longer calls
// this for normal play (see /viewport and /mine below): with hexes numerous
// this payload runs into the megabytes and only grows over a season, and
// most of it is irrelevant to any one player at any one time.
router.get('/', async (req, res) => {
  try {
    res.json(await queryEnrichedHexes('TRUE', []))
  } catch (err) {
    console.error('[hexes] GET / failed:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// Claim data for a specific set of hexes - the client sends exactly the
// cells its own viewport/overview math already computed, so the response is
// proportional to what's on screen instead of the whole world.
router.post('/viewport', async (req, res) => {
  const { h3Indexes } = req.body
  if (!Array.isArray(h3Indexes)) return res.status(400).json({ error: 'h3Indexes required' })
  try {
    res.json(await queryEnrichedHexes('h.h3_index = ANY($1)', [h3Indexes.slice(0, 4000)]))
  } catch (err) {
    console.error('[hexes] POST /viewport failed:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// Your own territory plus any alliance members' - small and bounded (an
// empire, not the world), always fully loaded regardless of viewport since
// fog-of-war/stats/auto-train all need your complete set of hexes, not just
// whatever's currently on screen.
router.get('/mine', requireAuth, async (req, res) => {
  try {
    const allies = await pool.query(`
      SELECT id FROM players
      WHERE alliance_id IS NOT NULL
        AND alliance_id = (SELECT alliance_id FROM players WHERE id = $1)
    `, [req.player.id])
    const ownerIds = [req.player.id, ...allies.rows.map(r => r.id)]
    res.json(await queryEnrichedHexes('h.owner_id = ANY($1)', [ownerIds]))
  } catch (err) {
    console.error('[hexes] GET /mine failed:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// Look up a hex by its short code (the #XXXXXX shown when you click a claimed
// hex - see text.js's shortHex) so search can jump to any claimed hex, not
// just ones already loaded into the client's local cache.
router.get('/search', async (req, res) => {
  const code = String(req.query.code || '').toUpperCase()
  if (!/^[0-9A-F]{3,9}$/.test(code)) return res.status(400).json({ error: 'Invalid code' })
  try {
    const result = await pool.query(
      `SELECT h3_index FROM hexes
       WHERE UPPER(RIGHT(REGEXP_REPLACE(h3_index, 'f+$', ''), 6)) = $1
       LIMIT 1`,
      [code]
    )
    if (!result.rows[0]) return res.status(404).json({ error: 'No hex found' })
    res.json({ h3Index: result.rows[0].h3_index })
  } catch (err) {
    console.error('[hexes] GET /search failed:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/strategic', async (req, res) => {
  try {
    const indexes = Array.from(STRATEGIC_HEXES.keys())
    const owned = await pool.query(
      'SELECT h.h3_index, p.username, p.color FROM hexes h JOIN players p ON p.id = h.owner_id WHERE h.h3_index = ANY($1)',
      [indexes]
    )
    const ownerMap = new Map(owned.rows.map(r => [r.h3_index, { username: r.username, color: r.color }]))
    const result = indexes.map(h3 => {
      const def = STRATEGIC_HEXES.get(h3)
      const owner = ownerMap.get(h3) || null
      return { h3_index: h3, name: def.name, primary: def.primary, zone: def.zone, bonus_gold: STRATEGIC_BONUS_GOLD, owner }
    })
    res.json(result)
  } catch (err) {
    console.error('[hexes] GET /strategic failed:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// Suggest a starting hex on the active front - near (but not on top of)
// an existing empire, so new players spawn where the war is.
router.get('/suggest-start', async (req, res) => {
  try {
    const anchors = await pool.query(`
      SELECT capital_hex, username FROM players
      WHERE capital_hex IS NOT NULL AND username NOT LIKE 'WILD_%'
      ORDER BY RANDOM() LIMIT 5
    `)
    for (const { capital_hex, username } of anchors.rows) {
      // Ring 5-9 around an existing capital: close enough to matter, far enough to breathe
      const outer = gridDisk(capital_hex, 9)
      const inner = new Set(gridDisk(capital_hex, 4))
      const candidates = outer.filter(h => !inner.has(h) && !isOcean(h))
      if (candidates.length === 0) continue

      const owned = await pool.query('SELECT h3_index FROM hexes WHERE h3_index = ANY($1)', [candidates])
      const taken = new Set(owned.rows.map(r => r.h3_index))
      const free = candidates.filter(h => !taken.has(h))
      if (free.length === 0) continue

      const pick = free[Math.floor(Math.random() * free.length)]
      const [lat, lng] = cellToLatLng(pick)
      return res.json({ h3Index: pick, lat, lng, near: username })
    }
    res.status(404).json({ error: 'No suggestion available' })
  } catch (err) {
    console.error('[hexes] GET /suggest-start failed:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// Batch terrain check - returns { h3Index: 'ocean' | 'land', ... }
router.post('/terrain', (req, res) => {
  const { h3Indexes } = req.body
  if (!Array.isArray(h3Indexes)) return res.status(400).json({ error: 'h3Indexes required' })
  const result = {}
  for (const h of h3Indexes.slice(0, 1000)) {
    result[h] = isOcean(h) ? 'ocean' : 'land'
  }
  res.json(result)
})

router.post('/claim', requireAuth, async (req, res) => {
  const { h3Index } = req.body
  if (!h3Index) return res.status(400).json({ error: 'h3Index required' })

  if (isOcean(h3Index)) {
    return res.status(400).json({ error: 'Cannot claim ocean hexes' })
  }

  try {
    const existing = await pool.query('SELECT owner_id FROM hexes WHERE h3_index = $1', [h3Index])
    if (existing.rows[0]?.owner_id) return res.status(409).json({ error: 'Hex already claimed' })

    const player = await pool.query('SELECT id, capital_hex FROM players WHERE id = $1', [req.player.id])
    const hasCapital = !!player.rows[0].capital_hex

    // capital_hex goes NULL both for a brand-new player AND for someone whose
    // capital was just destroyed - those are very different situations. A
    // destroyed-capital player who still owns other territory is NOT starting
    // over, so they must march troops here like any other claim and don't get
    // a second round of starter gifts. Only a player with truly nothing left
    // (no capital AND no other hexes) gets the free, march-free bootstrap.
    const hexCountRes = await pool.query('SELECT COUNT(*)::int AS cnt FROM hexes WHERE owner_id=$1', [req.player.id])
    const ownsAnyHexes = hexCountRes.rows[0].cnt > 0
    const isBootstrapping = !hasCapital && !ownsAnyHexes
    const needsNewCapital = !hasCapital && ownsAnyHexes

    if (!isBootstrapping) {
      // Claiming an empty hex needs a real commitment, not one scout troop -
      // this is the actual lever against "spread everywhere for free," not
      // just a slower decay clock afterward.
      const troops = await pool.query(
        'SELECT COALESCE(SUM(quantity), 0)::int AS qty FROM troops WHERE owner_id=$1 AND h3_index=$2',
        [req.player.id, h3Index]
      )
      if (troops.rows[0].qty < MIN_TROOPS_TO_CLAIM) {
        return res.status(400).json({ error: `March at least ${MIN_TROOPS_TO_CLAIM} troops here first to claim this hex` })
      }
    }

    // Atomic claim: the WHERE guard on the conflict action means two concurrent
    // claims on the same hex can't both win. Only the request that actually flips
    // an unowned row gets a row back; the loser gets 409 instead of silently
    // stealing the hex or double-founding a capital on it (see founding.js for
    // the same pattern one level down).
    const claimed = await pool.query(
      `INSERT INTO hexes (h3_index, owner_id, claimed_at) VALUES ($1, $2, NOW())
       ON CONFLICT (h3_index) DO UPDATE SET owner_id = $2, claimed_at = NOW()
       WHERE hexes.owner_id IS NULL
       RETURNING h3_index`,
      [h3Index, req.player.id]
    )
    if (claimed.rows.length === 0) {
      return res.status(409).json({ error: 'Hex already claimed' })
    }

    if (isBootstrapping) {
      // Atomic founding: only the first of any concurrent (double-click) claims wins
      // and hands out the one-time starter gifts. See server/founding.js.
      await foundCapital(pool, req.player.id, h3Index, {
        startingTroops: STARTING_TROOPS,
        onWin: seedCampsAround,
      })
    } else if (needsNewCapital) {
      // Re-designating a capital after losing one, but with existing territory
      // intact - no starter gifts (they're not starting over), and the WHERE
      // guard is still load-bearing against a concurrent double-claim.
      await pool.query('UPDATE players SET capital_hex=$1 WHERE id=$2 AND capital_hex IS NULL', [h3Index, req.player.id])
    }

    getIO()?.emit('hexes:update')
    res.json({ success: true, isCapital: isBootstrapping || needsNewCapital })
  } catch (err) {
    console.error('[hexes] POST /claim failed:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// Re-found a capital on a hex you already own, instead of requiring a fresh
// unclaimed one - covers a capital-less player who's boxed in with no free
// hex reachable. Same troop bar as any claim (MIN_TROOPS_TO_CLAIM), no
// starter gifts since the player already has territory.
router.post('/set-capital', requireAuth, async (req, res) => {
  const { h3Index } = req.body
  if (!h3Index) return res.status(400).json({ error: 'h3Index required' })

  try {
    const player = await pool.query('SELECT capital_hex FROM players WHERE id = $1', [req.player.id])
    if (player.rows[0]?.capital_hex) return res.status(409).json({ error: 'You already have a capital' })

    const hex = await pool.query('SELECT owner_id FROM hexes WHERE h3_index = $1', [h3Index])
    if (hex.rows[0]?.owner_id !== req.player.id) return res.status(403).json({ error: 'You do not own this hex' })

    const troops = await pool.query(
      'SELECT COALESCE(SUM(quantity), 0)::int AS qty FROM troops WHERE owner_id=$1 AND h3_index=$2',
      [req.player.id, h3Index]
    )
    if (troops.rows[0].qty < MIN_TROOPS_TO_CLAIM) {
      return res.status(400).json({ error: `Need at least ${MIN_TROOPS_TO_CLAIM} troops garrisoned here to found a capital` })
    }

    // WHERE guard against a race with a concurrent set-capital/claim call.
    const updated = await pool.query(
      'UPDATE players SET capital_hex=$1 WHERE id=$2 AND capital_hex IS NULL RETURNING id',
      [h3Index, req.player.id]
    )
    if (updated.rows.length === 0) return res.status(409).json({ error: 'You already have a capital' })

    getIO()?.emit('hexes:update')
    res.json({ success: true })
  } catch (err) {
    console.error('[hexes] POST /set-capital failed:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// Dominant-owner-per-region summary for the low-zoom "overview" map layer
// (coarser parent hexes colored by whoever holds the most of the underlying
// claimed hexes inside them). This used to be computed client-side by
// scanning every claimed hex the client had loaded - fine when that was the
// whole world, but the overview view at low zoom spans a huge area, so
// scoping the client's data to "mine + current viewport" left nothing to
// summarize with. Doing the aggregation here instead keeps the response tiny
// (one entry per populated region, not one per claimed hex) regardless of
// how many hexes exist or how zoomed out the view is.
router.get('/overview', async (req, res) => {
  const resolution = parseInt(req.query.res, 10)
  if (!Number.isInteger(resolution) || resolution < 0 || resolution > 15) {
    return res.status(400).json({ error: 'res must be an integer 0-15' })
  }
  try {
    const result = await pool.query(`
      SELECT h.h3_index, p.color
      FROM hexes h JOIN players p ON p.id = h.owner_id
      WHERE h.owner_id IS NOT NULL
    `)
    const tally = {} // parent -> { [color]: count }
    for (const { h3_index, color } of result.rows) {
      const parent = cellToParent(h3_index, resolution)
      const entry = (tally[parent] ||= {})
      entry[color] = (entry[color] || 0) + 1
    }
    const summary = {}
    for (const [parent, counts] of Object.entries(tally)) {
      const [dominantColor] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
      summary[parent] = { color: dominantColor }
    }
    res.json(summary)
  } catch (err) {
    console.error('[hexes] GET /overview failed:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

export default router

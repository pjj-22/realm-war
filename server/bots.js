import { pool } from './db.js'
import { latLngToCell, gridDisk, gridDistance } from 'h3-js'
import { getIO } from './socket.js'
import { STARTING_GOLD, STARTING_MANA, STARTING_TROOPS, TROOP_STATS, BUILDING_COSTS, OCEAN_MARCH_MULTIPLIER, BUILDING_TIME_SECONDS } from './config.js'
import { isOcean } from './terrain.js'
import { notifyIncomingAttack } from './notify.js'

const HEX_RES = 7

// One bot per entry - created once, reused across restarts
const BOT_DEFS = [
  { username: 'BOT_Iron',  color: '#8B4513', lat:  40.7, lng:  -74.0 }, // New York
  { username: 'BOT_Storm', color: '#4169E1', lat:  51.5, lng:   -0.1 }, // London
  { username: 'BOT_Jade',  color: '#228B22', lat:  35.7, lng:  139.7 }, // Tokyo
  { username: 'BOT_Ember', color: '#DC143C', lat: -23.5, lng:  -46.6 }, // Sao Paulo
  { username: 'BOT_Sand',  color: '#DAA520', lat:  28.6, lng:   77.2 }, // Delhi
  { username: 'BOT_Frost', color: '#00CED1', lat: -33.9, lng:   18.4 }, // Cape Town
]

// Decision thresholds
const TRAIN_BATCH     = 30  // troops queued per training action
const GOLD_TRAIN_MIN  = 20  // minimum gold before training
const MARCH_THRESHOLD = 8   // troops on a hex before considering a march
const MARCH_SEND_PCT  = 0.6 // fraction of available troops to send
const ATTACK_MIN      = 8   // troops required before attacking an enemy hex

async function depositTroops(ownerId, hexIndex, type, quantity) {
  await pool.query(`
    INSERT INTO troops (owner_id, h3_index, type, quantity)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (owner_id, h3_index, type)
    DO UPDATE SET quantity = troops.quantity + EXCLUDED.quantity
  `, [ownerId, hexIndex, type, quantity])
}

// Find an unclaimed land hex near a target coordinate
async function findFreeHex(centerHex) {
  for (let ring = 0; ring <= 15; ring++) {
    const candidates = gridDisk(centerHex, ring)
    for (const h of candidates) {
      if (isOcean(h)) continue
      const row = await pool.query('SELECT owner_id FROM hexes WHERE h3_index=$1', [h])
      if (!row.rows[0]) return h
    }
  }
  return null
}

// Create all bot players and claim their starting hexes if not already done
export async function ensureBots() {
  // Remove any duplicate buildings (keep only the oldest per hex)
  await pool.query(`
    DELETE FROM buildings WHERE id IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY h3_index ORDER BY created_at ASC) AS rn
        FROM buildings
      ) sub WHERE rn > 1
    )
  `)

  for (const def of BOT_DEFS) {
    try {
      const existing = await pool.query('SELECT id, capital_hex FROM players WHERE username=$1', [def.username])

      if (existing.rows.length === 0) {
        const result = await pool.query(
          'INSERT INTO players (username, password_hash, color, gold, mana) VALUES ($1,$2,$3,$4,$5) RETURNING id',
          [def.username, 'BOT_NO_LOGIN', def.color, STARTING_GOLD, STARTING_MANA]
        )
        const botId = result.rows[0].id
        const preferredHex = latLngToCell(def.lat, def.lng, HEX_RES)
        const startHex = await findFreeHex(preferredHex)

        if (startHex) {
          await pool.query(
            'INSERT INTO hexes (h3_index, owner_id, claimed_at) VALUES ($1,$2,NOW())',
            [startHex, botId]
          )
          await pool.query('UPDATE players SET capital_hex=$1 WHERE id=$2', [startHex, botId])
          await depositTroops(botId, startHex, 'troop', STARTING_TROOPS)
          console.log(`[bot] Created ${def.username} at ${startHex}`)
        }
      }
    } catch (err) {
      console.error(`[bot] Failed to ensure ${def.username}:`, err.message)
    }
  }
}

// Re-seed bots that lost (or never had) a capital - used after a season reset
export async function respawnBots() {
  for (const def of BOT_DEFS) {
    try {
      const r = await pool.query('SELECT id, capital_hex FROM players WHERE username=$1', [def.username])
      const bot = r.rows[0]
      if (!bot || bot.capital_hex) continue
      const startHex = await findFreeHex(latLngToCell(def.lat, def.lng, HEX_RES))
      if (!startHex) continue
      await pool.query(
        'INSERT INTO hexes (h3_index, owner_id, claimed_at) VALUES ($1,$2,NOW()) ON CONFLICT DO NOTHING',
        [startHex, bot.id]
      )
      await pool.query('UPDATE players SET capital_hex=$1, gold=GREATEST(gold,$2) WHERE id=$3',
        [startHex, STARTING_GOLD, bot.id])
      await depositTroops(bot.id, startHex, 'troop', STARTING_TROOPS)
      console.log(`[bot] ${def.username} respawned at ${startHex}`)
    } catch (err) {
      console.error(`[bot] respawn failed for ${def.username}:`, err.message)
    }
  }
}

// Claim any hexes where the bot has troops stationed but doesn't yet own
async function botClaim(bot) {
  const stationed = await pool.query(
    'SELECT DISTINCT h3_index FROM troops WHERE owner_id=$1 AND quantity > 0',
    [bot.id]
  )
  if (stationed.rows.length === 0) return
  const hexIndexes = stationed.rows.map(r => r.h3_index)
  const existing = await pool.query('SELECT h3_index FROM hexes WHERE h3_index = ANY($1)', [hexIndexes])
  const claimed = new Set(existing.rows.map(r => r.h3_index))
  for (const h3_index of hexIndexes) {
    if (!claimed.has(h3_index)) {
      await pool.query(
        'INSERT INTO hexes (h3_index, owner_id, claimed_at) VALUES ($1,$2,NOW()) ON CONFLICT DO NOTHING',
        [h3_index, bot.id]
      )
      console.log(`[bot] ${bot.username} claimed ${h3_index}`)
    }
  }
}

// Build one building per owned hex per tick following priority order
async function botBuild(bot) {
  if (!bot.capital_hex) return

  const player = await pool.query('SELECT gold FROM players WHERE id=$1', [bot.id])
  let { gold } = player.rows[0]

  const ownedHexes = await pool.query('SELECT h3_index FROM hexes WHERE owner_id=$1', [bot.id])
  if (ownedHexes.rows.length === 0) return

  const hexIndexes = ownedHexes.rows.map(r => r.h3_index)
  const buildingsRes = await pool.query('SELECT h3_index FROM buildings WHERE h3_index = ANY($1)', [hexIndexes])
  const builtHexes = new Set(buildingsRes.rows.map(r => r.h3_index))

  for (const { h3_index } of ownedHexes.rows) {
    if (gold < 5) break
    if (builtHexes.has(h3_index)) continue

    const isCapital = h3_index === bot.capital_hex
    const buildOrder = isCapital ? ['barracks', 'mine', 'fort'] : ['mine', 'fort']

    for (const type of buildOrder) {
      const cost = BUILDING_COSTS[type]
      if (gold < cost.gold) continue

      const inserted = await pool.query(
        'INSERT INTO buildings (h3_index, type) SELECT $1,$2 WHERE NOT EXISTS (SELECT 1 FROM buildings WHERE h3_index=$1) RETURNING id',
        [h3_index, type]
      )
      if (!inserted.rows[0]) break  // another process beat us - skip this hex
      await pool.query('UPDATE players SET gold=gold-$1 WHERE id=$2', [cost.gold, bot.id])
      gold -= cost.gold
      console.log(`[bot] ${bot.username} built ${type} at ${h3_index}`)
      break
    }
  }
}

// Queue troop training on capital if resources and barracks allow
async function botTrain(bot) {
  if (!bot.capital_hex) return

  const player = await pool.query('SELECT gold FROM players WHERE id=$1', [bot.id])
  const { gold } = player.rows[0]
  if (gold < GOLD_TRAIN_MIN) return

  const barracks = await pool.query(
    "SELECT id FROM buildings WHERE h3_index=$1 AND type='barracks' AND EXTRACT(EPOCH FROM (NOW() - created_at)) >= $2",
    [bot.capital_hex, BUILDING_TIME_SECONDS]
  )
  if (!barracks.rows[0]) return

  const inQueue = await pool.query(
    'SELECT id FROM training_queue WHERE owner_id=$1 AND h3_index=$2',
    [bot.id, bot.capital_hex]
  )
  if (inQueue.rows.length > 0) return

  const stats = TROOP_STATS.troop
  const qty = Math.min(TRAIN_BATCH, Math.floor((gold - 5) / stats.gold))
  if (qty <= 0) return

  const completesAt = new Date(Date.now() + stats.trainMinutes * 60 * 1000 * qty)
  await pool.query('UPDATE players SET gold=gold-$1 WHERE id=$2', [stats.gold * qty, bot.id])
  await pool.query(
    'INSERT INTO training_queue (owner_id, h3_index, type, quantity, started_at, completes_at) VALUES ($1,$2,$3,$4,NOW(),$5)',
    [bot.id, bot.capital_hex, 'troop', qty, completesAt]
  )
  console.log(`[bot] ${bot.username} queued ${qty} troops`)
}

// March troops to expand territory or attack enemy hexes
async function botMarch(bot) {
  if (!bot.capital_hex) return

  const hexTroops = await pool.query(`
    SELECT h.h3_index, COALESCE(SUM(t.quantity), 0)::integer AS troops
    FROM hexes h
    LEFT JOIN troops t ON t.h3_index = h.h3_index AND t.owner_id = $1
    WHERE h.owner_id = $1
    GROUP BY h.h3_index
    ORDER BY troops DESC
  `, [bot.id])

  const sources = hexTroops.rows.filter(s => s.troops >= MARCH_THRESHOLD)
  if (sources.length === 0) return

  // Batch: which sources already have armies marching
  const sourceHexes = sources.map(s => s.h3_index)
  const marchingRes = await pool.query(
    "SELECT from_hex FROM armies WHERE owner_id=$1 AND from_hex = ANY($2) AND status='marching'",
    [bot.id, sourceHexes]
  )
  const alreadyMarching = new Set(marchingRes.rows.map(r => r.from_hex))

  // Batch: get ownership of all neighbors across all active sources
  const allNeighborSet = new Set()
  for (const source of sources) {
    if (alreadyMarching.has(source.h3_index)) continue
    gridDisk(source.h3_index, 1).filter(h => h !== source.h3_index).forEach(h => allNeighborSet.add(h))
  }
  const allNeighbors = Array.from(allNeighborSet)
  const neighborRes = await pool.query(
    'SELECT h3_index, owner_id FROM hexes WHERE h3_index = ANY($1)',
    [allNeighbors]
  )
  const neighborOwner = new Map(neighborRes.rows.map(r => [r.h3_index, r.owner_id]))

  for (const source of sources) {
    if (alreadyMarching.has(source.h3_index)) continue

    const neighbors = gridDisk(source.h3_index, 1).filter(h => h !== source.h3_index)
    let target = null

    // 1. Adjacent unclaimed
    for (const h of neighbors) {
      if (!neighborOwner.has(h) && !isOcean(h)) { target = h; break }
    }

    // 2. Adjacent enemy
    if (!target && source.troops >= ATTACK_MIN) {
      // prefer weakly-held hexes - pick the enemy neighbor with fewest troops
      let bestTroops = Infinity
      for (const h of neighbors) {
        const owner = neighborOwner.get(h)
        if (owner && owner !== bot.id) {
          // rough proxy: we don't have troop counts here, just pick first
          if (!target) { target = h; bestTroops = 0 }
        }
      }
    }

    // 3. Wider search (ring 2-3): unclaimed, then enemy
    if (!target) {
      const ring3 = gridDisk(source.h3_index, 3)
      const ring3Res = await pool.query(
        'SELECT h3_index, owner_id FROM hexes WHERE h3_index = ANY($1)',
        [ring3]
      )
      const ring3Map = new Map(ring3Res.rows.map(r => [r.h3_index, r.owner_id]))

      // unclaimed in ring 2-3
      for (const h of ring3) {
        if (!ring3Map.has(h) && !isOcean(h)) {
          // step toward it via best neighbor
          let best = null, bestDist = Infinity
          for (const n of neighbors) {
            const d = gridDistance(n, h)
            if (d < bestDist) { bestDist = d; best = n }
          }
          if (best) { target = best; break }
        }
      }

      // enemy in ring 2-3 if still no target
      if (!target && source.troops >= ATTACK_MIN) {
        for (const h of ring3) {
          const owner = ring3Map.get(h)
          if (owner && owner !== bot.id) {
            let best = null, bestDist = Infinity
            for (const n of neighbors) {
              const d = gridDistance(n, h)
              if (d < bestDist) { bestDist = d; best = n }
            }
            if (best) { target = best; break }
          }
        }
      }
    }

    if (!target) continue

    const troopRow = await pool.query(
      "SELECT quantity FROM troops WHERE owner_id=$1 AND h3_index=$2 AND type='troop'",
      [bot.id, source.h3_index]
    )
    const available = troopRow.rows[0]?.quantity || 0
    const sendQty = Math.max(1, Math.floor(available * MARCH_SEND_PCT))
    if (available < 2) continue

    await pool.query(
      "UPDATE troops SET quantity=quantity-$1 WHERE owner_id=$2 AND h3_index=$3 AND type='troop'",
      [sendQty, bot.id, source.h3_index]
    )

    const dist = Math.max(1, gridDistance(source.h3_index, target))
    const multiplier = isOcean(target) ? OCEAN_MARCH_MULTIPLIER : 1
    const arrivesAt = new Date(Date.now() + dist * TROOP_STATS.troop.marchMinutesPerHex * multiplier * 60 * 1000)
    await pool.query(
      'INSERT INTO armies (owner_id, from_hex, to_hex, type, quantity, arrives_at, departed_at) VALUES ($1,$2,$3,$4,$5,$6,NOW())',
      [bot.id, source.h3_index, target, 'troop', sendQty, arrivesAt]
    )
    notifyIncomingAttack(bot.id, target, sendQty, arrivesAt)
    console.log(`[bot] ${bot.username} marching ${sendQty} troops → ${target}`)
  }
}

export async function processBots() {
  try {
    const bots = await pool.query("SELECT * FROM players WHERE username LIKE 'BOT_%'")
    if (bots.rows.length === 0) return

    for (const bot of bots.rows) {
      await botBuild(bot)
      await botTrain(bot)
      await botMarch(bot)
    }

    getIO()?.emit('hexes:update')
    getIO()?.emit('armies:update')
  } catch (err) {
    console.error('[bot] Error in processBots:', err.message)
  }
}

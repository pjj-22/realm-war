import { pool } from './db.js'
import { latLngToCell, gridDisk, gridDistance } from 'h3-js'
import { getIO } from './socket.js'
import {
  STARTING_GOLD, STARTING_MANA,
  TROOP_STATS, BUILDING_COSTS,
  SLOT_BASE, SLOT_CAPITAL,
} from './config.js'

const HEX_RES = 7

// One bot per entry — created once, reused across restarts
const BOT_DEFS = [
  { username: 'BOT_Iron',  color: '#8B4513', lat:  40.7, lng:  -74.0 }, // New York
  { username: 'BOT_Storm', color: '#4169E1', lat:  51.5, lng:   -0.1 }, // London
  { username: 'BOT_Jade',  color: '#228B22', lat:  35.7, lng:  139.7 }, // Tokyo
  { username: 'BOT_Ember', color: '#DC143C', lat: -23.5, lng:  -46.6 }, // Sao Paulo
  { username: 'BOT_Sand',  color: '#DAA520', lat:  28.6, lng:   77.2 }, // Delhi
  { username: 'BOT_Frost', color: '#00CED1', lat: -33.9, lng:   18.4 }, // Cape Town
]

// Decision thresholds
const TRAIN_BATCH     = 20  // troops queued per training action
const GOLD_TRAIN_MIN  = 30  // minimum gold before training
const MARCH_THRESHOLD = 15  // troops on a hex before considering a march
const MARCH_SEND      = 10  // troops sent per march action
const ATTACK_MIN      = 25  // troops required before attacking an enemy hex

async function depositTroops(ownerId, hexIndex, type, quantity) {
  await pool.query(`
    INSERT INTO troops (owner_id, h3_index, type, quantity)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (owner_id, h3_index, type)
    DO UPDATE SET quantity = troops.quantity + EXCLUDED.quantity
  `, [ownerId, hexIndex, type, quantity])
}

// Find an unclaimed hex near a target coordinate
async function findFreeHex(centerHex) {
  for (let ring = 0; ring <= 15; ring++) {
    const candidates = gridDisk(centerHex, ring)
    for (const h of candidates) {
      const row = await pool.query('SELECT owner_id FROM hexes WHERE h3_index=$1', [h])
      if (!row.rows[0]) return h
    }
  }
  return null
}

// Create all bot players and claim their starting hexes if not already done
export async function ensureBots() {
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
          await depositTroops(botId, startHex, 'troop', 20)
          console.log(`[bot] Created ${def.username} at ${startHex}`)
        }
      }
    } catch (err) {
      console.error(`[bot] Failed to ensure ${def.username}:`, err.message)
    }
  }
}

// Claim any hexes where the bot has troops stationed but doesn't yet own
async function botClaim(bot) {
  const stationed = await pool.query(
    'SELECT DISTINCT h3_index FROM troops WHERE owner_id=$1 AND quantity > 0',
    [bot.id]
  )
  for (const { h3_index } of stationed.rows) {
    const hex = await pool.query('SELECT owner_id FROM hexes WHERE h3_index=$1', [h3_index])
    if (!hex.rows[0]) {
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

  for (const { h3_index } of ownedHexes.rows) {
    if (gold < 5) break

    const isCapital = h3_index === bot.capital_hex
    const maxSlots = isCapital ? SLOT_CAPITAL : SLOT_BASE

    const buildings = await pool.query('SELECT type FROM buildings WHERE h3_index=$1', [h3_index])
    const types = buildings.rows.map(b => b.type)
    if (types.length >= maxSlots) continue

    // Build priority: barracks on capital, then mines everywhere, then fort
    const buildOrder = isCapital
      ? ['barracks', 'mine', 'fort']
      : ['mine', 'fort']

    for (const type of buildOrder) {
      if (type === 'barracks' && (types.includes('barracks') || !isCapital)) continue
      if (type === 'mine' && types.includes('mine')) continue
      if (type === 'fort' && types.includes('fort')) continue

      const cost = BUILDING_COSTS[type]
      if (gold < cost.gold) continue

      await pool.query('UPDATE players SET gold=gold-$1 WHERE id=$2', [cost.gold, bot.id])
      await pool.query('INSERT INTO buildings (h3_index, type) VALUES ($1,$2)', [h3_index, type])
      gold -= cost.gold
      console.log(`[bot] ${bot.username} built ${type} at ${h3_index}`)
      break // one build per hex
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
    "SELECT id FROM buildings WHERE h3_index=$1 AND type='barracks'",
    [bot.capital_hex]
  )
  if (!barracks.rows[0]) return

  const inQueue = await pool.query(
    'SELECT id FROM training_queue WHERE owner_id=$1 AND h3_index=$2',
    [bot.id, bot.capital_hex]
  )
  if (inQueue.rows.length > 0) return

  const stats = TROOP_STATS.troop
  const qty = Math.min(TRAIN_BATCH, Math.floor(gold / stats.gold))
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

  // Find owned hexes sorted by troop count descending
  const hexTroops = await pool.query(`
    SELECT h.h3_index, COALESCE(SUM(t.quantity), 0)::integer AS troops
    FROM hexes h
    LEFT JOIN troops t ON t.h3_index = h.h3_index AND t.owner_id = $1
    WHERE h.owner_id = $1
    GROUP BY h.h3_index
    ORDER BY troops DESC
  `, [bot.id])

  for (const source of hexTroops.rows) {
    if (source.troops < MARCH_THRESHOLD) continue

    // Skip if already marching from this hex
    const marching = await pool.query(
      "SELECT id FROM armies WHERE owner_id=$1 AND from_hex=$2 AND status='marching'",
      [bot.id, source.h3_index]
    )
    if (marching.rows.length > 0) continue

    // Find a target — prefer unclaimed adjacent, then enemy adjacent
    const neighbors = gridDisk(source.h3_index, 1).filter(h => h !== source.h3_index)
    let target = null

    for (const h of neighbors) {
      const row = await pool.query('SELECT owner_id FROM hexes WHERE h3_index=$1', [h])
      if (!row.rows[0]) { target = h; break } // unclaimed — grab it
    }

    if (!target && source.troops >= ATTACK_MIN) {
      for (const h of neighbors) {
        const row = await pool.query('SELECT owner_id FROM hexes WHERE h3_index=$1', [h])
        if (row.rows[0] && row.rows[0].owner_id !== bot.id) { target = h; break }
      }
    }

    // If no adjacent targets, find nearest unclaimed hex within 3 rings
    // and march toward it one step at a time
    if (!target) {
      const ring3 = gridDisk(source.h3_index, 3)
      for (const h of ring3) {
        const row = await pool.query('SELECT owner_id FROM hexes WHERE h3_index=$1', [h])
        if (!row.rows[0]) {
          // March to the neighbor that gets us closest
          let best = null, bestDist = Infinity
          for (const n of neighbors) {
            const d = gridDistance(n, h)
            if (d < bestDist) { bestDist = d; best = n }
          }
          if (best) { target = best; break }
        }
      }
    }

    if (!target) continue

    const troopRow = await pool.query(
      "SELECT quantity FROM troops WHERE owner_id=$1 AND h3_index=$2 AND type='troop'",
      [bot.id, source.h3_index]
    )
    const available = troopRow.rows[0]?.quantity || 0
    const sendQty = Math.min(available, Math.min(source.troops - 5, MARCH_SEND))
    if (sendQty <= 0) continue

    await pool.query(
      "UPDATE troops SET quantity=quantity-$1 WHERE owner_id=$2 AND h3_index=$3 AND type='troop'",
      [sendQty, bot.id, source.h3_index]
    )

    const dist = Math.max(1, gridDistance(source.h3_index, target))
    const arrivesAt = new Date(Date.now() + dist * TROOP_STATS.troop.marchMinutesPerHex * 60 * 1000)
    await pool.query(
      'INSERT INTO armies (owner_id, from_hex, to_hex, type, quantity, arrives_at, departed_at) VALUES ($1,$2,$3,$4,$5,$6,NOW())',
      [bot.id, source.h3_index, target, 'troop', sendQty, arrivesAt]
    )
    console.log(`[bot] ${bot.username} marching ${sendQty} troops → ${target}`)
    break // one march action per bot per tick
  }
}

export async function processBots() {
  try {
    const bots = await pool.query("SELECT * FROM players WHERE username LIKE 'BOT_%'")
    if (bots.rows.length === 0) return

    for (const bot of bots.rows) {
      await botClaim(bot)
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

import { pool } from './db.js'
import { latLngToCell, gridDisk, gridDistance } from 'h3-js'
import { getIO } from './socket.js'
import { IS_DEV, STARTING_GOLD, STARTING_MANA, STARTING_TROOPS, TROOP_STATS, BUILDING_COSTS, OCEAN_MARCH_MULTIPLIER, BUILDING_TIME_SECONDS, TICK_INTERVAL_MS } from './config.js'

// Per-tick bot chatter is dev-only; creation/respawn logs stay
const log = IS_DEV ? console.log : () => {}
import { isOcean } from './terrain.js'
import { notifyIncomingAttack } from './notify.js'
import { WILD_USERNAME } from './wild.js'

const HEX_RES = 7

// Six personalities, cycled across the roster below so no two adjacent bots
// share one - see ARCHETYPES for what each actually does differently.
const ARCHETYPE_CYCLE = ['turtle', 'warmonger', 'raider', 'snowballer', 'opportunist', 'grudgeholder']

// One bot per entry - created once, reused across restarts
const BOT_DEFS = [
  { username: 'BOT_Iron',     color: '#8B4513', lat:  40.7,  lng:  -74.0 }, // New York
  { username: 'BOT_Storm',    color: '#4169E1', lat:  51.5,  lng:   -0.1 }, // London
  { username: 'BOT_Jade',     color: '#228B22', lat:  35.7,  lng:  139.7 }, // Tokyo
  { username: 'BOT_Ember',    color: '#DC143C', lat: -23.5,  lng:  -46.6 }, // Sao Paulo
  { username: 'BOT_Sand',     color: '#DAA520', lat:  28.6,  lng:   77.2 }, // Delhi
  { username: 'BOT_Frost',    color: '#00CED1', lat: -33.9,  lng:   18.4 }, // Cape Town
  { username: 'BOT_Coral',    color: '#FF8C00', lat: -33.9,  lng:  151.2 }, // Sydney
  { username: 'BOT_Steel',    color: '#8A2BE2', lat:  55.75, lng:   37.6 }, // Moscow
  { username: 'BOT_Dune',     color: '#CD853F', lat:  30.0,  lng:   31.2 }, // Cairo
  { username: 'BOT_Copper',   color: '#FF1493', lat:  19.4,  lng:  -99.1 }, // Mexico City
  { username: 'BOT_Slate',    color: '#20B2AA', lat:  43.7,  lng:  -79.4 }, // Toronto
  { username: 'BOT_Crimson',  color: '#B22222', lat:  39.9,  lng:  116.4 }, // Beijing
  { username: 'BOT_Azure',    color: '#4682B4', lat:  37.6,  lng:  127.0 }, // Seoul
  { username: 'BOT_Cinder',   color: '#FF6347', lat:  19.1,  lng:   72.9 }, // Mumbai
  { username: 'BOT_Onyx',     color: '#9370DB', lat:  41.0,  lng:   29.0 }, // Istanbul
  { username: 'BOT_Granite',  color: '#2F4F4F', lat:  52.5,  lng:   13.4 }, // Berlin
  { username: 'BOT_Pearl',    color: '#6495ED', lat:  48.9,  lng:    2.4 }, // Paris
  { username: 'BOT_Bronze',   color: '#ADFF2F', lat:   6.5,  lng:    3.4 }, // Lagos
  { username: 'BOT_Cobalt',   color: '#708090', lat: -34.6,  lng:  -58.4 }, // Buenos Aires
  { username: 'BOT_Marble',   color: '#FF4500', lat:  -6.2,  lng:  106.8 }, // Jakarta
  { username: 'BOT_Orchid',   color: '#DA70D6', lat:  13.8,  lng:  100.5 }, // Bangkok
  { username: 'BOT_Basalt',   color: '#A0522D', lat:  -1.3,  lng:   36.8 }, // Nairobi
  { username: 'BOT_Quartz',   color: '#1E90FF', lat:  34.05, lng: -118.24 }, // Los Angeles
  { username: 'BOT_Gold',     color: '#FFD700', lat:  25.2,  lng:   55.3 }, // Dubai
].map((def, i) => ({ ...def, archetype: ARCHETYPE_CYCLE[i % ARCHETYPE_CYCLE.length] }))

const BOT_DEF_BY_USERNAME = new Map(BOT_DEFS.map(d => [d.username, d]))

// ─── Personalities ──────────────────────────────────────────────────────────
// Each archetype tunes the same knobs (how much force to commit, how big an
// edge to demand before fighting, what to build, who to target) differently
// enough that watching one across a session should feel like a different
// opponent, not a recolored copy.
const ARCHETYPES = {
  // Builds up, rarely fights unless it has an overwhelming edge. Grows by
  // walking into empty land, not by picking fights.
  turtle: {
    attackMargin: 1.6, marchSendPct: 0.35, trainBoost: 0.7,
    buildBias: ['fort', 'mine'], targetPref: 'weakest',
  },
  // Low bar for a fight, commits most of its force, keeps armies moving.
  // Goes after rival players over Marauder camps - it wants the map, not gold.
  warmonger: {
    attackMargin: 1.05, marchSendPct: 0.8, trainBoost: 1.3,
    buildBias: ['mine', 'fort'], targetPref: 'players',
  },
  // Farms weak Marauder camps for gold, small frequent hits rather than
  // committing everything to one push.
  raider: {
    attackMargin: 1.25, marchSendPct: 0.5, trainBoost: 1.0,
    buildBias: ['mine', 'fort'], targetPref: 'camps',
  },
  // Turtle early - once its army crosses SNOWBALL_AT troops it flips into
  // warmonger behavior for the rest of the game.
  snowballer: {
    attackMargin: 1.6, marchSendPct: 0.35, trainBoost: 0.8,
    buildBias: ['fort', 'mine'], targetPref: 'weakest', snowballAt: 150,
  },
  // Always picks off whoever nearby is currently weakest, player or camp -
  // a scavenger, not a strategist.
  opportunist: {
    attackMargin: 1.2, marchSendPct: 0.55, trainBoost: 1.0,
    buildBias: ['mine', 'fort'], targetPref: 'weakest',
  },
  // Behaves like a generalist until attacked, then biases hard toward
  // retaliating against whoever hit it most recently.
  grudgeholder: {
    attackMargin: 1.2, marchSendPct: 0.6, trainBoost: 1.0,
    buildBias: ['mine', 'fort'], targetPref: 'grudge',
  },
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }

// Deterministic per-bot variance so two bots of the same archetype don't
// play identically - derived from the username, so it's stable across restarts
// without needing to persist anything.
function jitterFor(username, spread = 0.15) {
  let h = 0
  for (let i = 0; i < username.length; i++) h = (h * 31 + username.charCodeAt(i)) | 0
  const frac = (Math.abs(h) % 1000) / 1000 // 0..1
  return 1 + (frac * 2 - 1) * spread
}

// Rough "is this bot's home city awake right now" check from its longitude
// (~15deg per UTC hour). Bots are quieter but not silent at night - real
// players still glance at their phone sometimes.
function activityChance(lng, now = new Date()) {
  const utcHour = now.getUTCHours() + now.getUTCMinutes() / 60
  const localHour = ((utcHour + lng / 15) % 24 + 24) % 24
  return (localHour >= 7 && localHour < 23) ? 0.9 : 0.25
}

function resolveBotProfile(bot) {
  const def = BOT_DEF_BY_USERNAME.get(bot.username)
  const archetype = ARCHETYPES[def?.archetype] || ARCHETYPES.opportunist
  const jitter = jitterFor(bot.username)
  return {
    name: def?.archetype || 'opportunist',
    jitter,
    attackMargin: clamp(archetype.attackMargin * jitter, 1.0, 2.2),
    marchSendPct: clamp(archetype.marchSendPct * jitter, 0.2, 0.9),
    trainBoost: archetype.trainBoost,
    buildBias: archetype.buildBias,
    targetPref: archetype.targetPref,
    snowballAt: archetype.snowballAt,
  }
}

// Who has attacked this bot most in the recent past, if anyone - lets a
// grudgeholder (and, mildly, anyone else) hold a target in mind across ticks
// instead of deciding everything fresh with no memory each time.
async function getGrudgeTarget(botId) {
  const r = await pool.query(
    `SELECT attacker_id FROM battles
     WHERE defender_id=$1 AND created_at > NOW() - INTERVAL '2 hours'
     GROUP BY attacker_id ORDER BY COUNT(*) DESC, MAX(created_at) DESC LIMIT 1`,
    [botId]
  )
  return r.rows[0]?.attacker_id || null
}

// Pick the best target among candidate hexes given a profile's preference -
// shared by the adjacent-enemy and ring-2/3 search so both respect the same
// personality instead of duplicating "just pick first".
function pickTarget(candidateHexes, ownerOf, defenseOf, attackForce, profile, { wildId, grudgeId }) {
  const beatable = []
  for (const h of candidateHexes) {
    const owner = ownerOf.get(h)
    if (!owner) continue
    const defense = defenseOf.get(h) || 0
    if (defense * profile.attackMargin > attackForce) continue
    beatable.push({ h, owner, defense })
  }
  if (beatable.length === 0) return null

  if (grudgeId) {
    const revenge = beatable.find(c => c.owner === grudgeId)
    if (revenge) return revenge.h
  }

  const weakest = list => list.reduce((a, b) => (b.defense < a.defense ? b : a)).h

  if (profile.targetPref === 'players') {
    const players = beatable.filter(c => c.owner !== wildId)
    return weakest(players.length > 0 ? players : beatable)
  }
  if (profile.targetPref === 'camps') {
    const camps = beatable.filter(c => c.owner === wildId)
    return weakest(camps.length > 0 ? camps : beatable)
  }
  return weakest(beatable)
}

// Decision thresholds
const TRAIN_BATCH     = 30  // troops queued per training action (before archetype trainBoost)
const GOLD_TRAIN_MIN  = 20  // minimum gold before training
const MARCH_THRESHOLD = 8   // troops on a hex before considering a march
const ATTACK_MIN      = 8   // troops required before attacking an enemy hex
const MAX_MARCHES_PER_TICK = 2  // even an "active" bot only manages a couple of fronts per turn, not every qualifying hex at once
const BATTLE_COOLDOWN_MS = TICK_INTERVAL_MS * 3  // a hex that was just fought over gets a few ticks to regroup before marching out again

async function depositTroops(ownerId, hexIndex, type, quantity) {
  await pool.query(`
    INSERT INTO troops (owner_id, h3_index, type, quantity)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (owner_id, h3_index, type)
    DO UPDATE SET quantity = troops.quantity + EXCLUDED.quantity
  `, [ownerId, hexIndex, type, quantity])
}

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
      log(`[bot] ${bot.username} claimed ${h3_index}`)
    }
  }
}

async function botBuild(bot, profile) {
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
    const buildOrder = isCapital ? ['barracks', ...profile.buildBias] : profile.buildBias

    for (const type of buildOrder) {
      const cost = BUILDING_COSTS[type]
      if (gold < cost.gold) continue

      // $1 is cast to text so its type is unambiguous: older DBs type h3_index as
      // varchar (schema.sql uses TEXT), which otherwise yields 42P08 on the reused param
      const inserted = await pool.query(
        'INSERT INTO buildings (h3_index, type) SELECT $1::text,$2 WHERE NOT EXISTS (SELECT 1 FROM buildings WHERE h3_index=$1::text) RETURNING id',
        [h3_index, type]
      )
      if (!inserted.rows[0]) break  // another process beat us - skip this hex
      await pool.query('UPDATE players SET gold=gold-$1 WHERE id=$2', [cost.gold, bot.id])
      gold -= cost.gold
      log(`[bot] ${bot.username} built ${type} at ${h3_index}`)
      break
    }
  }
}

async function botTrain(bot, profile) {
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
  const batch = Math.max(1, Math.round(TRAIN_BATCH * profile.trainBoost))
  const qty = Math.min(batch, Math.floor((gold - 5) / stats.gold))
  if (qty <= 0) return

  const completesAt = new Date(Date.now() + stats.trainMinutes * 60 * 1000 * qty)
  await pool.query('UPDATE players SET gold=gold-$1 WHERE id=$2', [stats.gold * qty, bot.id])
  await pool.query(
    'INSERT INTO training_queue (owner_id, h3_index, type, quantity, started_at, completes_at) VALUES ($1,$2,$3,$4,NOW(),$5)',
    [bot.id, bot.capital_hex, 'troop', qty, completesAt]
  )
  log(`[bot] ${bot.username} queued ${qty} troops`)
}

async function botMarch(bot, profile, ctx) {
  if (!bot.capital_hex) return

  // Snowballer: a turtle build-up until it crosses its threshold, then it
  // fights like a warmonger for the rest of the game.
  if (profile.snowballAt) {
    const totalRes = await pool.query('SELECT COALESCE(SUM(quantity), 0)::float8 AS total FROM troops WHERE owner_id=$1', [bot.id])
    if (totalRes.rows[0].total >= profile.snowballAt) {
      const w = ARCHETYPES.warmonger
      profile = {
        ...profile,
        name: 'snowballer (unleashed)',
        attackMargin: clamp(w.attackMargin * profile.jitter, 1.0, 2.2),
        marchSendPct: clamp(w.marchSendPct * profile.jitter, 0.2, 0.9),
        trainBoost: w.trainBoost,
        buildBias: w.buildBias,
        targetPref: w.targetPref,
      }
    }
  }

  const grudgeId = await getGrudgeTarget(bot.id)
  const targetCtx = { ...ctx, grudgeId }

  const hexTroops = await pool.query(`
    SELECT h.h3_index, COALESCE(SUM(t.quantity), 0)::float8 AS troops
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

  // Batch: hexes that were fought over recently rest instead of marching out
  // again immediately - a real player regroups, they don't relaunch the
  // instant a siege ends.
  const restingRes = await pool.query(
    `SELECT DISTINCT h3_index FROM battles
     WHERE h3_index = ANY($1) AND (ended_at IS NULL OR ended_at > $2)`,
    [sourceHexes, new Date(Date.now() - BATTLE_COOLDOWN_MS)]
  )
  const resting = new Set(restingRes.rows.map(r => r.h3_index))

  // Batch: get ownership of all neighbors across all active sources
  const allNeighborSet = new Set()
  for (const source of sources) {
    if (alreadyMarching.has(source.h3_index) || resting.has(source.h3_index)) continue
    gridDisk(source.h3_index, 1).filter(h => h !== source.h3_index).forEach(h => allNeighborSet.add(h))
  }
  const allNeighbors = Array.from(allNeighborSet)
  const neighborRes = await pool.query(
    'SELECT h3_index, owner_id FROM hexes WHERE h3_index = ANY($1)',
    [allNeighbors]
  )
  const neighborOwner = new Map(neighborRes.rows.map(r => [r.h3_index, r.owner_id]))
  const neighborDefenseRes = await pool.query(
    'SELECT h3_index, COALESCE(SUM(quantity), 0)::float8 AS troops FROM troops WHERE h3_index = ANY($1) GROUP BY h3_index',
    [allNeighbors]
  )
  const neighborDefense = new Map(neighborDefenseRes.rows.map(r => [r.h3_index, r.troops]))

  let marchesLaunched = 0
  for (const source of sources) {
    if (marchesLaunched >= MAX_MARCHES_PER_TICK) break
    if (alreadyMarching.has(source.h3_index) || resting.has(source.h3_index)) continue

    const neighbors = gridDisk(source.h3_index, 1).filter(h => h !== source.h3_index)
    let target = null

    // 1. Adjacent unclaimed
    for (const h of neighbors) {
      if (!neighborOwner.has(h) && !isOcean(h)) { target = h; break }
    }

    // 2. Adjacent enemy - only ones this force can actually beat, chosen by personality
    if (!target && source.troops >= ATTACK_MIN) {
      const attackForce = Math.floor(source.troops * profile.marchSendPct)
      target = pickTarget(neighbors, neighborOwner, neighborDefense, attackForce, profile, targetCtx)
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
          let best = null, bestDist = Infinity
          for (const n of neighbors) {
            const d = gridDistance(n, h)
            if (d < bestDist) { bestDist = d; best = n }
          }
          if (best) { target = best; break }
        }
      }

      // enemy in ring 2-3 if still no target - only ones this force can beat
      if (!target && source.troops >= ATTACK_MIN) {
        const attackForce = Math.floor(source.troops * profile.marchSendPct)
        const enemyHexes = ring3.filter(h => {
          const owner = ring3Map.get(h)
          return owner && owner !== bot.id
        })
        if (enemyHexes.length > 0) {
          const ring3DefenseRes = await pool.query(
            'SELECT h3_index, COALESCE(SUM(quantity), 0)::float8 AS troops FROM troops WHERE h3_index = ANY($1) GROUP BY h3_index',
            [enemyHexes]
          )
          const ring3Defense = new Map(ring3DefenseRes.rows.map(r => [r.h3_index, r.troops]))
          const bestTarget = pickTarget(enemyHexes, ring3Map, ring3Defense, attackForce, profile, targetCtx)

          if (bestTarget) {
            let best = null, bestDist = Infinity
            for (const n of neighbors) {
              const d = gridDistance(n, bestTarget)
              if (d < bestDist) { bestDist = d; best = n }
            }
            if (best) target = best
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
    const sendQty = Math.max(1, Math.floor(available * profile.marchSendPct))
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
    log(`[bot] ${bot.username} (${profile.name}) marching ${sendQty} troops → ${target}`)
    marchesLaunched++
  }
}

export async function processBots() {
  try {
    const bots = await pool.query("SELECT * FROM players WHERE username LIKE 'BOT_%'")
    if (bots.rows.length === 0) return

    const wildRes = await pool.query('SELECT id FROM players WHERE username=$1', [WILD_USERNAME])
    const wildId = wildRes.rows[0]?.id || null

    for (const bot of bots.rows) {
      const def = BOT_DEF_BY_USERNAME.get(bot.username)
      // "Not online" this tick - real players don't act with perfect regularity.
      if (Math.random() > activityChance(def?.lng ?? 0)) continue

      const profile = resolveBotProfile(bot)
      await botBuild(bot, profile)
      await botTrain(bot, profile)
      await botMarch(bot, profile, { wildId })
    }

    getIO()?.emit('hexes:update')
    getIO()?.emit('armies:update')
  } catch (err) {
    console.error('[bot] Error in processBots:', err.message)
  }
}

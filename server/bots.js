import { pool } from './db.js'
import { latLngToCell, gridDisk, gridDistance } from 'h3-js'
import { getIO } from './socket.js'
import { IS_DEV, STARTING_GOLD, STARTING_MANA, STARTING_TROOPS, TROOP_STATS, BUILDING_COSTS, BUILDING_TIME_SECONDS, TICK_INTERVAL_MS } from './config.js'

// Per-tick bot chatter is dev-only; creation/respawn logs stay
const log = IS_DEV ? console.log : () => {}
import { isOcean } from './terrain.js'
import { notifyIncomingAttack } from './notify.js'
import { WILD_USERNAME } from './wild.js'
import { activeResolution } from './worldState.js'
import { findMarchPath } from './marchPath.js'

// Six personalities, cycled across the roster below so no two adjacent bots
// share one - see ARCHETYPES for what each actually does differently.
const ARCHETYPE_CYCLE = ['turtle', 'warmonger', 'raider', 'snowballer', 'opportunist', 'grudgeholder']

// Hand-placed "flagship" bots - one per entry, created once, reused across
// restarts. The roster below tops these up to BOT_COUNT procedurally.
const FLAGSHIP_BOT_DEFS = [
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
]

// More real cities, spread across every populated continent, to seed the
// generated roster below - just coordinates, no names/colors needed since
// those get generated per bot.
const EXTRA_CITY_SEEDS = [
  { lat: 41.9,   lng: -87.6 },   // Chicago
  { lat: 49.28,  lng: -123.12 }, // Vancouver
  { lat: 4.71,   lng: -74.07 },  // Bogota
  { lat: -12.05, lng: -77.04 },  // Lima
  { lat: -33.45, lng: -70.65 },  // Santiago
  { lat: 29.76,  lng: -95.37 },  // Houston
  { lat: 25.76,  lng: -80.19 },  // Miami
  { lat: 45.5,   lng: -73.57 },  // Montreal
  { lat: 23.13,  lng: -82.38 },  // Havana
  { lat: 10.5,   lng: -66.92 },  // Caracas
  { lat: -0.23,  lng: -78.52 },  // Quito
  { lat: 8.98,   lng: -79.52 },  // Panama City
  { lat: 37.77,  lng: -122.42 }, // San Francisco
  { lat: 47.61,  lng: -122.33 }, // Seattle
  { lat: 39.74,  lng: -104.99 }, // Denver
  { lat: 33.75,  lng: -84.39 },  // Atlanta
  { lat: 42.36,  lng: -71.06 },  // Boston
  { lat: 33.45,  lng: -112.07 }, // Phoenix
  { lat: 20.67,  lng: -103.35 }, // Guadalajara
  { lat: 25.69,  lng: -100.32 }, // Monterrey
  { lat: 40.42,  lng: -3.7 },    // Madrid
  { lat: 41.9,   lng: 12.5 },    // Rome
  { lat: 52.37,  lng: 4.9 },     // Amsterdam
  { lat: 48.21,  lng: 16.37 },   // Vienna
  { lat: 52.23,  lng: 21.01 },   // Warsaw
  { lat: 37.98,  lng: 23.73 },   // Athens
  { lat: 59.33,  lng: 18.06 },   // Stockholm
  { lat: 38.72,  lng: -9.14 },   // Lisbon
  { lat: 53.35,  lng: -6.26 },   // Dublin
  { lat: 47.5,   lng: 19.04 },   // Budapest
  { lat: 50.08,  lng: 14.44 },   // Prague
  { lat: 55.68,  lng: 12.57 },   // Copenhagen
  { lat: 60.17,  lng: 24.94 },   // Helsinki
  { lat: 50.45,  lng: 30.52 },   // Kyiv
  { lat: 47.38,  lng: 8.54 },    // Zurich
  { lat: 50.85,  lng: 4.35 },    // Brussels
  { lat: 45.46,  lng: 9.19 },    // Milan
  { lat: 41.39,  lng: 2.17 },    // Barcelona
  { lat: 48.14,  lng: 11.58 },   // Munich
  { lat: 59.91,  lng: 10.75 },   // Oslo
  { lat: 31.23,  lng: 121.47 },  // Shanghai
  { lat: 22.32,  lng: 114.17 },  // Hong Kong
  { lat: 1.35,   lng: 103.82 },  // Singapore
  { lat: 14.6,   lng: 120.98 },  // Manila
  { lat: 3.15,   lng: 101.71 },  // Kuala Lumpur
  { lat: 25.03,  lng: 121.56 },  // Taipei
  { lat: 34.69,  lng: 135.5 },   // Osaka
  { lat: 24.86,  lng: 67.0 },    // Karachi
  { lat: 35.69,  lng: 51.39 },   // Tehran
  { lat: 24.71,  lng: 46.68 },   // Riyadh
  { lat: 33.32,  lng: 44.36 },   // Baghdad
  { lat: 31.77,  lng: 35.21 },   // Jerusalem
  { lat: 21.03,  lng: 105.85 },  // Hanoi
  { lat: 6.93,   lng: 79.85 },   // Colombo
  { lat: 23.81,  lng: 90.41 },   // Dhaka
  { lat: 47.89,  lng: 106.91 },  // Ulaanbaatar
  { lat: 16.87,  lng: 96.2 },    // Yangon
  { lat: 26.91,  lng: 75.79 },   // Jaipur
  { lat: 30.57,  lng: 104.07 },  // Chengdu
  { lat: 43.24,  lng: 76.94 },   // Almaty
  { lat: -26.2,  lng: 28.05 },   // Johannesburg
  { lat: 33.57,  lng: -7.59 },   // Casablanca
  { lat: 5.6,    lng: -0.19 },   // Accra
  { lat: 9.03,   lng: 38.74 },   // Addis Ababa
  { lat: -4.32,  lng: 15.3 },    // Kinshasa
  { lat: 14.72,  lng: -17.47 },  // Dakar
  { lat: 36.81,  lng: 10.18 },   // Tunis
  { lat: 36.75,  lng: 3.06 },    // Algiers
  { lat: -36.85, lng: 174.76 },  // Auckland
  { lat: -37.81, lng: 144.96 },  // Melbourne
  { lat: -31.95, lng: 115.86 },  // Perth
  { lat: -41.29, lng: 174.78 },  // Wellington

  // The list above only had 12 African points, all coastal/edge cities
  // (Cairo, Lagos, Nairobi, Cape Town, Johannesburg, Casablanca, Accra,
  // Addis Ababa, Kinshasa, Dakar, Tunis, Algiers) - bots only expand by
  // marching to adjacent hexes, so a continent this size with that few seed
  // points left enormous interior stretches with no bot anywhere near them
  // to ever colonize outward from. Adding more capitals fixes the coverage
  // gap without going overboard - kept to cities a general audience would
  // actually recognize, and deliberately still fewer than Europe's list
  // below (Africa should read as less densely settled, not equally so).
  { lat: 32.89,  lng: 13.19 },   // Tripoli
  { lat: 15.5,   lng: 32.56 },   // Khartoum
  { lat: -8.84,  lng: 13.23 },   // Luanda
  { lat: -6.79,  lng: 39.21 },   // Dar es Salaam
  { lat: 0.35,   lng: 32.58 },   // Kampala
  { lat: 2.05,   lng: 45.32 },   // Mogadishu
  { lat: -15.39, lng: 28.32 },   // Lusaka
  { lat: -17.83, lng: 31.05 },   // Harare

  // Same problem, smaller scale, elsewhere: a few other large interior
  // regions with no recognizable nearby seed at all.
  { lat: -15.79, lng: -47.88 },  // Brasilia (central Brazil)
  { lat: -16.5,  lng: -68.15 },  // La Paz
  { lat: 41.3,   lng: 69.24 },   // Tashkent
  { lat: 55.03,  lng: 82.92 },   // Novosibirsk (Siberia)
  { lat: 49.9,   lng: -97.14 },  // Winnipeg
]

// Simple seeded PRNG (mulberry32) so the generated roster's names/colors/
// locations are stable across restarts instead of reshuffling every boot.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const NAME_PREFIXES = [
  'Shadow', 'Storm', 'Iron', 'Silent', 'Wild', 'Golden', 'Dark', 'Swift', 'Grim', 'Bright',
  'Frost', 'Ember', 'Stone', 'Wind', 'Blood', 'Night', 'Sun', 'Moon', 'Star', 'River',
  'Ash', 'Thorn', 'Raven', 'Wolf', 'Hawk', 'Silver', 'Crimson', 'Ivory', 'Amber', 'Obsidian',
]
const NAME_SUFFIXES = [
  'Fang', 'Reach', 'Hold', 'Watch', 'Crest', 'Vale', 'Marsh', 'Ridge', 'Fell', 'Keep',
  'Spire', 'Grove', 'Hollow', 'Barrow', 'Ford', 'Gate', 'Wraith', 'Talon', 'Warden', 'Blade',
]

function generateUsername(taken, rng) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const name = `BOT_${NAME_PREFIXES[Math.floor(rng() * NAME_PREFIXES.length)]}${NAME_SUFFIXES[Math.floor(rng() * NAME_SUFFIXES.length)]}`
    if (!taken.has(name)) { taken.add(name); return name }
  }
  // 30x20 = 600 combos, so this shouldn't trigger before BOT_COUNT is reached -
  // numbered fallback just in case the word bank ever runs dry.
  let i = 1
  while (taken.has(`BOT_Wanderer${i}`)) i++
  const name = `BOT_Wanderer${i}`
  taken.add(name)
  return name
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100
  const k = n => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  const toHex = x => Math.round(x * 255).toString(16).padStart(2, '0')
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`
}

// Golden-angle hue stepping spreads colors evenly around the wheel without
// picking each one by hand - consecutive indexes land far apart in hue.
function generateColor(index) {
  const hue = (index * 137.508) % 360
  const sat = 55 + (index % 3) * 10
  const light = 45 + (index % 4) * 6
  return hslToHex(hue, sat, light)
}

const BOT_COUNT = 200

// The pool of valid starting locations - every named city across both lists
// above, flagship and generated alike. Used for identity (name/color/
// archetype) is permanent per bot, generated once below with a fixed seed.
// Where each bot actually *starts* is a separate, per-season draw (see
// seasonBotRng/pickBotLocation) - reshuffled every season like a new game of
// Risk, rather than the same bot always opening in the same city.
const SEED_POINTS = [...FLAGSHIP_BOT_DEFS.map(d => ({ lat: d.lat, lng: d.lng })), ...EXTRA_CITY_SEEDS]
const takenBotNames = new Set(FLAGSHIP_BOT_DEFS.map(d => d.username))
const botRng = mulberry32(20260730) // fixed seed - stable identity across restarts/seasons

const GENERATED_BOT_DEFS = Array.from({ length: Math.max(0, BOT_COUNT - FLAGSHIP_BOT_DEFS.length) }, (_, i) => ({
  username: generateUsername(takenBotNames, botRng),
  color: generateColor(FLAGSHIP_BOT_DEFS.length + i),
}))

const BOT_DEFS = [...FLAGSHIP_BOT_DEFS, ...GENERATED_BOT_DEFS]
  .map((def, i) => ({ ...def, archetype: ARCHETYPE_CYCLE[i % ARCHETYPE_CYCLE.length] }))

const BOT_DEF_BY_USERNAME = new Map(BOT_DEFS.map(d => [d.username, d]))

// Seeded per-season (not per-bot, not fixed) so the whole roster's starting
// spots reshuffle at every season boundary but stay put for anyone who
// reconnects mid-season or if the server restarts mid-season. Large odd
// multiplier so consecutive season numbers don't produce correlated draws.
function seasonBotRng(seasonNumber) {
  return mulberry32(20260730 + (seasonNumber ?? 0) * 104729)
}

// Fully random pick from the whole pool (not round-robin) plus the same
// ~15km jitter as before, so two bots can land near the same city without
// stacking on the same hex.
function pickBotLocation(rng) {
  const seed = SEED_POINTS[Math.floor(rng() * SEED_POINTS.length)]
  return {
    lat: seed.lat + (rng() - 0.5) * 0.3,
    lng: seed.lng + (rng() - 0.5) * 0.3,
  }
}

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
    buildBias: ['fort', 'mine', 'barracks'], targetPref: 'weakest',
  },
  // Low bar for a fight, commits most of its force, keeps armies moving.
  // Goes after rival players over Marauder camps - it wants the map, not gold.
  warmonger: {
    attackMargin: 1.05, marchSendPct: 0.8, trainBoost: 1.3,
    buildBias: ['barracks', 'mine', 'fort'], targetPref: 'players',
  },
  // Farms weak Marauder camps for gold, small frequent hits rather than
  // committing everything to one push.
  raider: {
    attackMargin: 1.25, marchSendPct: 0.5, trainBoost: 1.0,
    buildBias: ['mine', 'barracks', 'fort'], targetPref: 'camps',
  },
  // Turtle early - once its army crosses SNOWBALL_AT troops it flips into
  // warmonger behavior for the rest of the game.
  snowballer: {
    attackMargin: 1.6, marchSendPct: 0.35, trainBoost: 0.8,
    buildBias: ['fort', 'mine', 'barracks'], targetPref: 'weakest', snowballAt: 150,
  },
  // Always picks off whoever nearby is currently weakest, player or camp -
  // a scavenger, not a strategist.
  opportunist: {
    attackMargin: 1.2, marchSendPct: 0.55, trainBoost: 1.0,
    buildBias: ['mine', 'fort', 'barracks'], targetPref: 'weakest',
  },
  // Behaves like a generalist until attacked, then biases hard toward
  // retaliating against whoever hit it most recently.
  grudgeholder: {
    attackMargin: 1.2, marchSendPct: 0.6, trainBoost: 1.0,
    buildBias: ['mine', 'fort', 'barracks'], targetPref: 'grudge',
  },
}

// A few options per archetype so bots sharing a personality don't all say
// the same line - picked once per bot with botRng, so it's stable across
// restarts like everything else in BOT_DEFS. Kept well under MOTTO_MAX (50,
// see routes/players.js) since these are hardcoded, not user input.
const MOTTOS_BY_ARCHETYPE = {
  turtle: ["Patience wins wars.", "Walls before swords.", "Strength first, war later."],
  warmonger: ["The map will be mine.", "Every border is a target.", "No quarter, no retreat."],
  raider: ["Strike, take, vanish.", "Gold over glory.", "Never linger, never lose."],
  snowballer: ["Grow quiet. Strike loud.", "Wait for the tide to turn.", "Patience, then the flood."],
  opportunist: ["Weakness is an invitation.", "I don't start fights. I finish them.", "The fallen make good neighbors."],
  grudgeholder: ["I remember every hit.", "Cross me once.", "Vengeance keeps the ledger."],
}

function pickMotto(archetype, rng) {
  const options = MOTTOS_BY_ARCHETYPE[archetype] || MOTTOS_BY_ARCHETYPE.opportunist
  return options[Math.floor(rng() * options.length)]
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }

// Weighted random order: earlier entries keep a higher chance of sorting
// first, but it's not guaranteed - classic weighted-sample-without-replacement
// via random()^(1/weight) as the sort key.
function weightedShuffle(list) {
  return list
    .map((item, i) => ({ item, key: Math.random() ** (1 / (list.length - i)) }))
    .sort((a, b) => b.key - a.key)
    .map(w => w.item)
}

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

export async function ensureBots(seasonNumber) {
  // Remove any duplicate buildings (keep only the oldest per hex)
  await pool.query(`
    DELETE FROM buildings WHERE id IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY h3_index ORDER BY created_at ASC) AS rn
        FROM buildings
      ) sub WHERE rn > 1
    )
  `)

  const rng = seasonBotRng(seasonNumber)
  for (const def of BOT_DEFS) {
    try {
      const existing = await pool.query('SELECT id, capital_hex, motto FROM players WHERE username=$1', [def.username])

      if (existing.rows.length > 0 && existing.rows[0].motto == null) {
        // Backfill bots created before mottos existed - same pickMotto call
        // ensureBots would've made at creation, just applied retroactively.
        await pool.query('UPDATE players SET motto=$1 WHERE id=$2', [pickMotto(def.archetype, botRng), existing.rows[0].id])
      }

      if (existing.rows.length === 0) {
        const result = await pool.query(
          'INSERT INTO players (username, password_hash, color, gold, mana, motto) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
          [def.username, 'BOT_NO_LOGIN', def.color, STARTING_GOLD, STARTING_MANA, pickMotto(def.archetype, botRng)]
        )
        const botId = result.rows[0].id
        const { lat, lng } = pickBotLocation(rng)
        const preferredHex = latLngToCell(lat, lng, activeResolution)
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

// Re-seed bots that lost (or never had) a capital - used after a season
// reset. Locations are drawn fresh from seasonBotRng(seasonNumber), so this
// is also where the whole roster's starting spots actually reshuffle.
export async function respawnBots(seasonNumber) {
  const rng = seasonBotRng(seasonNumber)
  for (const def of BOT_DEFS) {
    try {
      const r = await pool.query('SELECT id, capital_hex FROM players WHERE username=$1', [def.username])
      const bot = r.rows[0]
      if (!bot || bot.capital_hex) continue
      const { lat, lng } = pickBotLocation(rng)
      const startHex = await findFreeHex(latLngToCell(lat, lng, activeResolution))
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
    // profile.buildBias is a fixed preference order per archetype - applying
    // it unweighted to every hex meant a bot's whole empire ended up as one
    // repeated building type (whichever came first and was affordable).
    // Weighted-shuffling it per hex keeps the archetype's lean (fort-first
    // for a turtle, etc.) as a tendency instead of an absolute rule, so a
    // bot's territory ends up with a real mix.
    const buildOrder = isCapital ? ['barracks', ...profile.buildBias] : weightedShuffle(profile.buildBias)

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

    // Same weighted routing a human's march gets (marchPath.js) - bots don't
    // get a shortcut straight-line march while players have to route around
    // water properly.
    const { path, cost } = findMarchPath(source.h3_index, target)
    const arrivesAt = new Date(Date.now() + Math.max(1, cost) * TROOP_STATS.troop.marchMinutesPerHex * 60 * 1000)
    await pool.query(
      'INSERT INTO armies (owner_id, from_hex, to_hex, type, quantity, arrives_at, departed_at, path) VALUES ($1,$2,$3,$4,$5,$6,NOW(),$7)',
      [bot.id, source.h3_index, target, 'troop', sendQty, arrivesAt, path]
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

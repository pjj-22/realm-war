import http from 'http'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import dotenv from 'dotenv'
import playerRoutes from './routes/players.js'
import hexRoutes from './routes/hexes.js'
import buildingRoutes from './routes/buildings.js'
import militaryRoutes from './routes/military.js'
import battleRoutes from './routes/battles.js'
import eventRoutes from './routes/events.js'
import adminRoutes from './routes/admin.js'
import pushRoutes from './routes/push.js'
import worldRoutes from './routes/world.js'
import allianceRoutes from './routes/alliance.js'
import chatRoutes from './routes/chat.js'
import seasonRoutes from './routes/season.js'
import { initPush } from './push.js'
import { startTick } from './tick.js'
import { MODE, IS_DEV, STARTING_GOLD, STARTING_MANA, TICK_INTERVAL_MS, BUILDING_TIME_SECONDS, CHAT_ENABLED, TROOP_STATS, BATTLE_INTERVAL_MS, BUILDING_COSTS, FORT_ADVANTAGE_TROOPS, ENTRENCH_ADVANTAGE_PER_NEIGHBOR, ENTRENCH_MAX_NEIGHBORS, MIN_TROOPS_TO_CLAIM, DECAY_HEX_THRESHOLD, DECAY_SCALE_HEXES_PER_STEP, HEX_RESOLUTION, WORLD_HEX_COUNT } from './config.js'
import { STRATEGIC_ADVANTAGE_TROOPS } from './strategic.js'
import { FRONTLINE_CAP, MAX_ADVANTAGED_DEFENDERS } from './combat.js'
import { pool } from './db.js'
import { requireAuth } from './auth.js'
import { initSocket } from './socket.js'

dotenv.config()

// ─── Boot-time environment guards ─────────────────────────────────────────────
// Fail fast on misconfiguration instead of silently running with dev settings.
// MODE is the single source of truth for pacing (config.js) - no separate
// NODE_ENV check to keep in sync with it.
const PLACEHOLDER_SECRETS = ['change_this_to_a_random_secret', 'realmwar_dev_secret_change_in_production', 'dev_admin_1234']

function assertEnv() {
  const problems = []
  if (!process.env.JWT_SECRET) problems.push('JWT_SECRET is not set (auth would break at runtime)')
  if (MODE === 'prod') {
    if (PLACEHOLDER_SECRETS.includes(process.env.JWT_SECRET)) problems.push('JWT_SECRET is a known placeholder - generate one: openssl rand -base64 32')
    if (process.env.ADMIN_SECRET && (PLACEHOLDER_SECRETS.includes(process.env.ADMIN_SECRET) || process.env.ADMIN_SECRET.length < 16))
      problems.push('ADMIN_SECRET is a placeholder or under 16 chars - generate one: openssl rand -base64 32')
    if (!process.env.CLIENT_ORIGIN) problems.push('CLIENT_ORIGIN is not set (CORS would be wide open)')
  }
  if (problems.length) {
    console.error('[boot] Refusing to start:')
    for (const p of problems) console.error(`  - ${p}`)
    process.exit(1)
  }
}
assertEnv()

// Comma-separated list of allowed browser origins, e.g. https://realmwar.example.com
const CORS_ORIGIN = process.env.CLIENT_ORIGIN ? process.env.CLIENT_ORIGIN.split(',').map(s => s.trim()) : '*'

const app = express()
// Behind nginx/Cloudflare set TRUST_PROXY=1 (number of hops) so req.ip is the
// real client address; without a proxy leave it unset so x-forwarded-for is ignored.
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1)
app.use(helmet())
app.use(cors({ origin: CORS_ORIGIN }))
app.use(express.json())

app.use('/api/players', playerRoutes)
app.use('/api/hexes', hexRoutes)
app.use('/api/buildings', buildingRoutes)
app.use('/api/military', militaryRoutes)
app.use('/api/battles', battleRoutes)
app.use('/api/events', eventRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/push', pushRoutes)
app.use('/api/world', worldRoutes)
app.use('/api/alliance', allianceRoutes)
if (CHAT_ENABLED) app.use('/api/chat', chatRoutes)
app.use('/api/seasons', seasonRoutes)

app.get('/api/health', (_, res) => res.json({
  ok: true,
  mode: MODE,
  devMode: IS_DEV,
  tick_interval_ms: TICK_INTERVAL_MS,
  building_time_seconds: BUILDING_TIME_SECONDS,
  troop_gold_cost: TROOP_STATS.troop.gold,
  battle_interval_ms: BATTLE_INTERVAL_MS,
  battle_frontline_cap: FRONTLINE_CAP,
  // Formula constants for the client to compute a hex's defense breakdown
  // (forts/entrenchment/strategic -> advantaged defenders) itself from data
  // it already has loaded, instead of a per-hex-click API call - see
  // BottomDrawer's defenseBreakdown.
  fort_advantage_troops: FORT_ADVANTAGE_TROOPS,
  entrench_advantage_per_neighbor: ENTRENCH_ADVANTAGE_PER_NEIGHBOR,
  entrench_max_neighbors: ENTRENCH_MAX_NEIGHBORS,
  strategic_advantage_troops: STRATEGIC_ADVANTAGE_TROOPS,
  max_advantaged_defenders: MAX_ADVANTAGED_DEFENDERS,
  min_troops_to_claim: MIN_TROOPS_TO_CLAIM,
  hex_resolution: HEX_RESOLUTION,
  world_hex_count: WORLD_HEX_COUNT,
  decay_hex_threshold: DECAY_HEX_THRESHOLD,
  decay_scale_hexes_per_step: DECAY_SCALE_HEXES_PER_STEP,
  building_costs: {
    mine: BUILDING_COSTS.mine.gold,
    barracks: BUILDING_COSTS.barracks.gold,
    fort: BUILDING_COSTS.fort.gold,
  },
}))

if (IS_DEV) {
  // Top up resources without re-registering
  app.post('/api/dev/refill', requireAuth, async (req, res) => {
    await pool.query('UPDATE players SET gold=$1 WHERE id=$2', [STARTING_GOLD, req.player.id])
    res.json({ gold: STARTING_GOLD })
  })
}

const httpServer = http.createServer(app)
initSocket(httpServer, CORS_ORIGIN)

async function runMigrations() {
  await pool.query('ALTER TABLE hexes ADD COLUMN IF NOT EXISTS rally_hex TEXT')
  await pool.query('ALTER TABLE training_queue ADD COLUMN IF NOT EXISTS delivered INTEGER NOT NULL DEFAULT 0')

  // Real troop counts tracked alongside the multiplier-inclusive strength pools,
  // so survivors can be computed round-by-round instead of reconstructed at the
  // end from all-time participant totals (see tick.js processBattleRounds).
  await pool.query('ALTER TABLE battles ADD COLUMN IF NOT EXISTS attacker_troops NUMERIC NOT NULL DEFAULT 0')
  await pool.query('ALTER TABLE battles ADD COLUMN IF NOT EXISTS defender_troops NUMERIC NOT NULL DEFAULT 0')
  await pool.query('ALTER TABLE battles ADD COLUMN IF NOT EXISTS def_multiplier NUMERIC NOT NULL DEFAULT 1')

  // Frontline/reserve dice combat: only a capped frontline slice of each side's
  // troops actually fights each clash, refilled from reserve afterward - see
  // combat.js resolveBattleClash. attacker_troops/defender_troops remain the
  // total (frontline+reserve) for display.
  await pool.query('ALTER TABLE battles ADD COLUMN IF NOT EXISTS attacker_frontline NUMERIC NOT NULL DEFAULT 0')
  await pool.query('ALTER TABLE battles ADD COLUMN IF NOT EXISTS defender_frontline NUMERIC NOT NULL DEFAULT 0')
  await pool.query('ALTER TABLE battles ADD COLUMN IF NOT EXISTS attacker_reserve NUMERIC NOT NULL DEFAULT 0')
  await pool.query('ALTER TABLE battles ADD COLUMN IF NOT EXISTS defender_reserve NUMERIC NOT NULL DEFAULT 0')

  // How many of the defender's frontline fight with advantage (roll 2, take
  // the higher) from forts/entrenchment/strategic hexes - see combat.js. Both
  // def_multiplier (probability-multiplier design) and defender_frontline_cap
  // (raw capacity-increase design, which turned out exploitable - see git
  // history) are obsolete and kept around unused so historical rows still read.
  await pool.query('ALTER TABLE battles ADD COLUMN IF NOT EXISTS defender_frontline_cap INTEGER NOT NULL DEFAULT 10')
  await pool.query('ALTER TABLE battles ADD COLUMN IF NOT EXISTS defender_advantage_troops INTEGER NOT NULL DEFAULT 0')

  // battles.created_at is in schema.sql but older DBs only have the legacy started_at;
  // ensure the canonical column exists and backfill it from started_at where present
  await pool.query('ALTER TABLE battles ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()')
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='battles' AND column_name='started_at') THEN
        UPDATE battles SET created_at = started_at WHERE started_at IS NOT NULL;
      END IF;
    END $$;`)

  // players.id is SERIAL on fresh installs (schema.sql) but UUID on older databases -
  // derive the type so foreign keys match either way
  const idType = await pool.query(
    "SELECT data_type FROM information_schema.columns WHERE table_name='players' AND column_name='id'"
  )
  const PID = idType.rows[0]?.data_type === 'uuid' ? 'UUID' : 'INTEGER'

  await pool.query(`
    CREATE TABLE IF NOT EXISTS hex_history (
      id SERIAL PRIMARY KEY,
      player_id ${PID} NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      hex_count INTEGER NOT NULL,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id SERIAL PRIMARY KEY,
      player_id ${PID} NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE,
      keys JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS world_events (
      id SERIAL PRIMARY KEY,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      hex_index TEXT,
      player_id ${PID} REFERENCES players(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS country_crowns (
      country TEXT PRIMARY KEY,
      player_id ${PID} NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      crowned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS alliances (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      tag TEXT NOT NULL UNIQUE,
      code TEXT NOT NULL UNIQUE,
      created_by ${PID} REFERENCES players(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`)
  await pool.query('ALTER TABLE players ADD COLUMN IF NOT EXISTS alliance_id INTEGER REFERENCES alliances(id) ON DELETE SET NULL')
  await pool.query('ALTER TABLE players ADD COLUMN IF NOT EXISTS flag_pixels TEXT')
  await pool.query('ALTER TABLE players ADD COLUMN IF NOT EXISTS motto TEXT')
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id SERIAL PRIMARY KEY,
      player_id ${PID} NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      alliance_id INTEGER REFERENCES alliances(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS seasons (
      id SERIAL PRIMARY KEY,
      number INTEGER NOT NULL UNIQUE,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ends_at TIMESTAMPTZ NOT NULL,
      ended_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'active',
      winner_id ${PID} REFERENCES players(id) ON DELETE SET NULL,
      snapshot JSONB
    )`)
  await pool.query('ALTER TABLE seasons ADD COLUMN IF NOT EXISTS hex_resolution INTEGER NOT NULL DEFAULT 7')
  // Single-row table: an admin-set H3 resolution for the *next* season -
  // consumed (reset to NULL) the moment that season is actually created, so
  // it never silently carries over past the one season it was meant for.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS season_config (
      id INTEGER PRIMARY KEY DEFAULT 1,
      next_hex_resolution INTEGER,
      CONSTRAINT season_config_singleton CHECK (id = 1)
    )`)
  await pool.query('INSERT INTO season_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING')
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wonder_holders (
      h3_index VARCHAR(20) PRIMARY KEY,
      owner_id ${PID} NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      taken_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS monuments (
      id SERIAL PRIMARY KEY,
      season_number INTEGER NOT NULL UNIQUE,
      username TEXT NOT NULL,
      color TEXT,
      h3_index VARCHAR(20) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wonder_history (
      id SERIAL PRIMARY KEY,
      h3_index VARCHAR(20) NOT NULL,
      username TEXT NOT NULL,
      color TEXT,
      seized_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_wonder_history_hex ON wonder_history (h3_index, seized_at DESC)')

  // Round-by-round combat log for debugging balance issues - one row per
  // clash, capturing the actual dice rolled so a disputed outcome (e.g. "why
  // did the defender never lose") can be inspected exactly instead of
  // re-derived from the battle's final totals. See tick.js processBattleRounds.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS battle_rounds (
      id SERIAL PRIMARY KEY,
      battle_id INTEGER NOT NULL REFERENCES battles(id) ON DELETE CASCADE,
      round_number INTEGER NOT NULL,
      defender_advantage_troops INTEGER NOT NULL,
      atk_frontline_before INTEGER NOT NULL,
      def_frontline_before INTEGER NOT NULL,
      atk_dice INTEGER[] NOT NULL,
      def_dice INTEGER[] NOT NULL,
      atk_losses INTEGER NOT NULL,
      def_losses INTEGER NOT NULL,
      atk_troops_after NUMERIC NOT NULL,
      def_troops_after NUMERIC NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_battle_rounds_battle ON battle_rounds (battle_id, round_number)')

  // battle_rounds churned through two short-lived designs (def_multiplier,
  // then defender_frontline_cap) before landing on the advantage-dice model -
  // rename in place on any DB that still has an older column name.
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='battle_rounds' AND column_name='def_multiplier') THEN
        ALTER TABLE battle_rounds RENAME COLUMN def_multiplier TO defender_advantage_troops;
      ELSIF EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='battle_rounds' AND column_name='defender_frontline_cap') THEN
        ALTER TABLE battle_rounds RENAME COLUMN defender_frontline_cap TO defender_advantage_troops;
      END IF;
    END $$;`)

  console.log('[db] Migrations complete')
}

const PORT = process.env.PORT || 3001
httpServer.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`)
  await runMigrations()
  initPush()
  startTick()
})

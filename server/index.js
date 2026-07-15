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
import { DEV_MODE, STARTING_GOLD, STARTING_MANA, TICK_INTERVAL_MS, BUILDING_TIME_SECONDS } from './config.js'
import { pool } from './db.js'
import { requireAuth } from './auth.js'
import { initSocket } from './socket.js'

dotenv.config()

// ─── Boot-time environment guards ─────────────────────────────────────────────
// Fail fast on misconfiguration instead of silently running with dev settings.
const PROD = process.env.NODE_ENV === 'production'
const PLACEHOLDER_SECRETS = ['change_this_to_a_random_secret', 'realmwar_dev_secret_change_in_production', 'dev_admin_1234']

function assertEnv() {
  const problems = []
  if (!process.env.JWT_SECRET) problems.push('JWT_SECRET is not set (auth would break at runtime)')
  if (PROD) {
    if (DEV_MODE) problems.push('DEV_MODE must be set to false in production (dev balance: 9999 gold, 30s ticks)')
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
app.use('/api/chat', chatRoutes)
app.use('/api/seasons', seasonRoutes)

app.get('/api/health', (_, res) => res.json({
  ok: true,
  devMode: DEV_MODE,
  tick_interval_ms: TICK_INTERVAL_MS,
  building_time_seconds: BUILDING_TIME_SECONDS,
}))

if (DEV_MODE) {
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
  console.log('[db] Migrations complete')
}

const PORT = process.env.PORT || 3001
httpServer.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`)
  await runMigrations()
  initPush()
  startTick()
})

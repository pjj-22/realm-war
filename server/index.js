import http from 'http'
import express from 'express'
import cors from 'cors'
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

const app = express()
app.use(cors())
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
initSocket(httpServer)

async function runMigrations() {
  await pool.query('ALTER TABLE hexes ADD COLUMN IF NOT EXISTS rally_hex TEXT')
  await pool.query('ALTER TABLE training_queue ADD COLUMN IF NOT EXISTS delivered INTEGER NOT NULL DEFAULT 0')

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

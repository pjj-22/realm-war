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
import { startTick } from './tick.js'
import { DEV_MODE, STARTING_GOLD, STARTING_MANA } from './config.js'
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

app.get('/api/health', (_, res) => res.json({ ok: true, devMode: DEV_MODE }))

if (DEV_MODE) {
  // Top up resources without re-registering
  app.post('/api/dev/refill', requireAuth, async (req, res) => {
    await pool.query('UPDATE players SET gold=$1 WHERE id=$2', [STARTING_GOLD, req.player.id])
    res.json({ gold: STARTING_GOLD })
  })
}

const httpServer = http.createServer(app)
initSocket(httpServer)

const PORT = process.env.PORT || 3001
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
  startTick()
})

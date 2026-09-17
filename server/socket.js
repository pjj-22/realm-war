import { Server } from 'socket.io'
import { cellToParent, gridDisk } from 'h3-js'
import { REGION_RESOLUTION } from './config.js'

let io = null

// Diff a socket's currently-joined rooms with a matching prefix against a
// new desired set, leaving/joining only the delta. Shared by watch-regions
// and watch-alliance below - same pattern, different prefix/id shape.
function syncRooms(socket, prefix, wantIds) {
  const want = new Set(wantIds.map(id => `${prefix}${id}`))
  for (const room of socket.rooms) {
    if (room.startsWith(prefix) && !want.has(room)) socket.leave(room)
  }
  for (const room of want) socket.join(room)
}

export function initSocket(httpServer, origin = '*') {
  io = new Server(httpServer, {
    cors: { origin },
  })

  io.on('connection', (socket) => {
    // Personal-events room: lets insertEvent() target just the one player an
    // event belongs to instead of broadcasting to every connected client -
    // with bots numerous and constantly fighting, insertEvent fires on every
    // single battle (bot-vs-bot included), and a global emit meant every
    // connected phone/browser was doing a wasted refetch on each one.
    socket.on('join', (playerId) => {
      if (typeof playerId !== 'number' && typeof playerId !== 'string') return
      socket.join(`player-${playerId}`)
    })
    // Region rooms: the client sends its *full* desired set (home territory +
    // current viewport, both at REGION_RESOLUTION) every time it changes;
    // hex/army/battle events are scoped to the region(s) covering the
    // affected hex via emitToRegion() below instead of broadcast globally.
    // Capped defensively - a client bug (or a malicious one) sending an
    // unbounded array here shouldn't be trusted just because the current
    // client is well-behaved; this is a boundary. A well-behaved client
    // covering its actual viewport at REGION_RESOLUTION never gets close to
    // this many regions - see the zoom gate in GameMap.jsx's
    // updateWatchedRegions, added after an unguarded viewport-spanning
    // region list here caused oversized watch-regions payloads at low zoom.
    const MAX_WATCHED_REGIONS = 3000
    socket.on('watch-regions', (regionCells) => {
      if (!Array.isArray(regionCells)) return
      syncRooms(socket, 'region-', regionCells.slice(0, MAX_WATCHED_REGIONS))
    })
    // Alliance chat room - same idea, scoped to one alliance id.
    socket.on('watch-alliance', (allianceId) => {
      syncRooms(socket, 'alliance-', allianceId == null ? [] : [allianceId])
    })
    socket.on('disconnect', () => {})
  })

  return io
}

export function getIO() {
  return io
}

// Emit a gameplay event to everyone currently watching the area around
// h3Index, instead of every connected socket. Expands to the region's
// ring-1 neighbors so activity near a region boundary still reaches an
// adjacent region's watchers.
export function emitToRegion(h3Index, event, ...args) {
  if (!io || !h3Index) return
  const parent = cellToParent(h3Index, REGION_RESOLUTION)
  // io.to() accepts an array of rooms and dedupes delivery across them - a
  // client watching several of these regions still gets exactly one copy,
  // not one per matching room.
  const rooms = gridDisk(parent, 1).map(cell => `region-${cell}`)
  io.to(rooms).emit(event, ...args)
}

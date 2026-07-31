import { Server } from 'socket.io'

let io = null

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
    socket.on('disconnect', () => {})
  })

  return io
}

export function getIO() {
  return io
}

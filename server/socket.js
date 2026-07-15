import { Server } from 'socket.io'

let io = null

export function initSocket(httpServer, origin = '*') {
  io = new Server(httpServer, {
    cors: { origin },
  })

  io.on('connection', (socket) => {
    socket.on('disconnect', () => {})
  })

  return io
}

export function getIO() {
  return io
}

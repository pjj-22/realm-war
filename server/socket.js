import { Server } from 'socket.io'

let io = null

export function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: '*' },
  })

  io.on('connection', (socket) => {
    console.log(`[socket] client connected: ${socket.id}`)
    socket.on('disconnect', () => {
      console.log(`[socket] client disconnected: ${socket.id}`)
    })
  })

  return io
}

export function getIO() {
  return io
}

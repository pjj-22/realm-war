import { useEffect } from 'react'
import { io } from 'socket.io-client'

const SOCKET_URL = 'http://localhost:3001'

let socket = null

export function getSocket() {
  if (!socket) {
    socket = io(SOCKET_URL, { transports: ['websocket'] })
  }
  return socket
}

// useSocket(handlers) — registers socket event listeners, cleans up on unmount
// handlers: { 'event': callbackFn, ... }
export function useSocket(handlers) {
  useEffect(() => {
    const s = getSocket()
    const entries = Object.entries(handlers)
    entries.forEach(([event, fn]) => s.on(event, fn))
    return () => entries.forEach(([event, fn]) => s.off(event, fn))
  })
}

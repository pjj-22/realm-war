import { useEffect, useRef } from 'react'
import { io } from 'socket.io-client'

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001'

let socket = null
let currentPlayerId = null

export function getSocket() {
  if (!socket) {
    socket = io(SOCKET_URL, { transports: ['polling', 'websocket'] })
    // Re-join on every (re)connect, not just once - a dropped connection
    // (mobile backgrounding, a network blip) gets a fresh socket id
    // server-side, so the room membership from the last connect is gone.
    socket.on('connect', () => { if (currentPlayerId != null) socket.emit('join', currentPlayerId) })
  }
  return socket
}

// Tells the server which player's personal-events room this connection
// belongs to (see server/socket.js) - lets insertEvent() target just this
// client instead of broadcasting to everyone on every battle in the game.
export function identifySocket(playerId) {
  currentPlayerId = playerId ?? null
  if (currentPlayerId != null) getSocket().emit('join', currentPlayerId)
}

// useSocket(handlers) - registers socket event listeners, cleans up on unmount.
// handlers object may change each render; we keep a ref so the stable effect
// always calls the latest version without re-subscribing.
export function useSocket(handlers) {
  const handlersRef = useRef(handlers)
  useEffect(() => { handlersRef.current = handlers })

  useEffect(() => {
    const s = getSocket()
    const wrapped = {}
    for (const event of Object.keys(handlersRef.current)) {
      wrapped[event] = (...args) => handlersRef.current[event]?.(...args)
      s.on(event, wrapped[event])
    }
    return () => {
      for (const [event, fn] of Object.entries(wrapped)) {
        s.off(event, fn)
      }
    }
  }, [])
}

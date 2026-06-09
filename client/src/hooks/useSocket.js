import { useEffect, useRef } from 'react'
import { io } from 'socket.io-client'

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001'

let socket = null

export function getSocket() {
  if (!socket) {
    socket = io(SOCKET_URL, { transports: ['websocket'] })
  }
  return socket
}

// useSocket(handlers) - registers socket event listeners, cleans up on unmount.
// handlers object may change each render; we keep a ref so the stable effect
// always calls the latest version without re-subscribing.
export function useSocket(handlers) {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

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

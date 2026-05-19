import { useState, useEffect, useRef } from 'react'

export function useResourceTicker(player, hexCount = 0, buildings = [], tickIntervalMs = 10 * 60 * 1000) {
  const [display, setDisplay] = useState({ gold: player?.gold || 0 })
  const lastSyncRef = useRef(Date.now())

  const goldPerTick = hexCount + buildings.filter(b => b.type === 'mine').length * 3
  const goldPerSec = goldPerTick / (tickIntervalMs / 1000)

  useEffect(() => {
    if (!player) return
    setDisplay({ gold: player.gold })
    lastSyncRef.current = Date.now()
  }, [player?.gold])

  useEffect(() => {
    if (!player) return
    const interval = setInterval(() => {
      const elapsed = (Date.now() - lastSyncRef.current) / 1000
      setDisplay({ gold: Math.floor(player.gold + goldPerSec * elapsed) })
    }, 1000)
    return () => clearInterval(interval)
  }, [player?.gold, goldPerSec])

  return { display, goldPerTick }
}

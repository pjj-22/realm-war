import { useState, useEffect, useRef } from 'react'

const TICK_MS = 10 * 60 * 1000 // 10 minutes

// Smoothly interpolates gold/mana between server ticks
export function useResourceTicker(player, hexCount = 0, buildings = []) {
  const [display, setDisplay] = useState({ gold: player?.gold || 0, mana: player?.mana || 0 })
  const lastSyncRef = useRef(Date.now())

  // Calculate income per second
  const goldPerTick = hexCount + buildings.filter(b => b.type === 'mine').length * 3
  const manaPerTick = buildings.filter(b => b.type === 'mana_well').length * 3
  const goldPerSec = goldPerTick / (TICK_MS / 1000)
  const manaPerSec = manaPerTick / (TICK_MS / 1000)

  // Snap to real value when player updates from server
  useEffect(() => {
    if (!player) return
    setDisplay({ gold: player.gold, mana: player.mana })
    lastSyncRef.current = Date.now()
  }, [player?.gold, player?.mana])

  // Interpolate every second
  useEffect(() => {
    if (!player) return
    const interval = setInterval(() => {
      const elapsed = (Date.now() - lastSyncRef.current) / 1000
      setDisplay({
        gold: Math.floor(player.gold + goldPerSec * elapsed),
        mana: Math.floor(player.mana + manaPerSec * elapsed),
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [player?.gold, player?.mana, goldPerSec, manaPerSec])

  return { display, goldPerTick, manaPerTick }
}

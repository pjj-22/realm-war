import { useState, useEffect } from 'react'
import { api } from '../api/client'

export default function LeaderboardPanel({ player }) {
  const [board, setBoard] = useState([])

  useEffect(() => {
    load()
    const interval = setInterval(load, 30000)
    return () => clearInterval(interval)
  }, [])

  async function load() {
    try { setBoard(await api.getLeaderboard()) } catch {}
  }

  if (board.length === 0) return null

  return (
    <div style={{
      position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
      background: 'rgba(10,8,25,0.85)', border: '1px solid #4a3a7a',
      borderRadius: 6, padding: '8px 16px',
      color: '#c9b99a', fontFamily: 'Georgia, serif',
      boxShadow: '0 0 20px rgba(80,40,160,0.3)',
      display: 'flex', gap: 20, alignItems: 'center',
      pointerEvents: 'none',
    }}>
      <span style={{ fontSize: 10, letterSpacing: 2, color: '#5a4a7a', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
        Leaderboard
      </span>
      {board.slice(0, 5).map((p, i) => (
        <div key={p.username} style={{
          display: 'flex', alignItems: 'center', gap: 5,
          opacity: p.username === player?.username ? 1 : 0.8,
          fontWeight: p.username === player?.username ? 'bold' : 'normal',
        }}>
          <span style={{ fontSize: 11, color: '#5a4a7a' }}>{i + 1}.</span>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, display: 'inline-block', flexShrink: 0 }} />
          <span style={{ fontSize: 12 }}>{p.username}</span>
          <span style={{ fontSize: 11, color: '#7a6a9a' }}>{p.hex_count}▲</span>
          <span style={{ fontSize: 11, color: '#9a7a9a' }}>{Math.round(p.total_strength)}⚔</span>
        </div>
      ))}
    </div>
  )
}

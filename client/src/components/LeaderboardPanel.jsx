import { useState, useEffect } from 'react'
import { cellToLatLng } from 'h3-js'
import { api } from '../api/client'
import { useIsMobile } from '../hooks/useIsMobile'
import { useSocket } from '../hooks/useSocket'
import HistoryChart from './HistoryChart'

export default function LeaderboardPanel({ player, onFlyTo }) {
  const isMobile = useIsMobile()
  const [board, setBoard] = useState([])
  const [open, setOpen] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  useEffect(() => { load() }, [])
  useSocket({ tick: load, 'hexes:update': load })

  async function load() {
    try { setBoard(await api.getLeaderboard()) } catch {}
  }

  if (board.length === 0) return null

  const top5 = board.slice(0, 5)
  const playerInTop5 = top5.some(p => p.username === player?.username)
  const playerRow = !playerInTop5 && player
    ? board.find(p => p.username === player.username)
    : null
  const playerRank = playerRow ? board.indexOf(playerRow) + 1 : null

  function flyToPlayer(p) {
    if (!p.capital_hex || !onFlyTo) return
    const [lat, lng] = cellToLatLng(p.capital_hex)
    onFlyTo(lng, lat)
  }

  function displayName(username) {
    return username.startsWith('BOT_') ? username.slice(4) : username
  }

  function Entry({ p, rank }) {
    const isMe = p.username === player?.username
    const isBot = p.username.startsWith('BOT_')
    const canFly = !!p.capital_hex && !!onFlyTo
    return (
      <div
        onClick={() => isMe ? setShowHistory(h => !h) : flyToPlayer(p)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 4px',
          opacity: isMe ? 1 : 0.85,
          fontWeight: isMe ? 'bold' : 'normal',
          borderBottom: '1px solid rgba(74,58,122,0.3)',
          cursor: 'pointer',
          borderRadius: 3,
          transition: 'background 0.1s',
          background: isMe && showHistory ? 'rgba(80,40,160,0.12)' : '',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(80,40,160,0.15)' }}
        onMouseLeave={e => { e.currentTarget.style.background = isMe && showHistory ? 'rgba(80,40,160,0.12)' : '' }}
        title={isMe ? 'View your history' : canFly ? `Go to ${displayName(p.username)}'s capital` : ''}
      >
        <span style={{ fontSize: 14, color: '#8a7a9a', minWidth: 18, textAlign: 'right' }}>{rank}.</span>
        <span style={{ width: 9, height: 9, borderRadius: '50%', background: p.color, display: 'inline-block', flexShrink: 0 }} />
        <span style={{ fontSize: 14, flex: 1 }}>
          {p.alliance_tag && <span style={{ color: '#9070c0', fontSize: 11 }}>[{p.alliance_tag}] </span>}
          {displayName(p.username)}
        </span>
        {isBot && <span style={{ fontSize: 9, color: '#4a3a6a', letterSpacing: 1 }}>AI</span>}
        <span style={{ fontSize: 14, color: '#9a8aaa' }}>{p.hex_count}▲</span>
        <span style={{ fontSize: 14, color: '#8a7aaa' }}>{p.total_troops}⚔</span>
        {isMe
          ? <span style={{ fontSize: 11, color: '#6a5a8a' }}>{showHistory ? '▲' : '📈'}</span>
          : canFly && <span style={{ fontSize: 14, color: '#5a4a7a' }}>⌖</span>
        }
      </div>
    )
  }

  return (
    <div style={{
      position: 'absolute', top: 56, right: isMobile ? 8 : 16,
      background: 'rgba(10,8,25,0.88)', border: '1px solid #4a3a7a',
      borderRadius: 6,
      color: '#c9b99a', fontFamily: 'Georgia, serif',
      boxShadow: '0 0 20px rgba(80,40,160,0.3)',
      minWidth: isMobile ? 160 : 220, zIndex: 10,
    }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', padding: '8px 14px',
          background: 'none', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          color: '#9a8aaa', fontFamily: 'Georgia, serif', fontSize: 14,
          letterSpacing: 2, textTransform: 'uppercase',
        }}>
        <span>🏆 Leaderboard</span>
        <span style={{ fontSize: 13 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{ padding: '2px 12px 10px' }}>
          {top5.map((p, i) => <Entry key={p.username} p={p} rank={i + 1} />)}
          {playerRow && (
            <>
              <div style={{ fontSize: 14, color: '#6a5878', textAlign: 'center', padding: '3px 0' }}>···</div>
              <Entry p={playerRow} rank={playerRank} />
            </>
          )}
          {player && !playerRow && !playerInTop5 && (
            <>
              <div style={{ fontSize: 14, color: '#6a5878', textAlign: 'center', padding: '3px 0' }}>···</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px', fontWeight: 'bold' }}>
                <span style={{ fontSize: 14, color: '#8a7a9a', minWidth: 18, textAlign: 'right' }}>?.</span>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: player.color, display: 'inline-block', flexShrink: 0 }} />
                <span style={{ fontSize: 13 }}>{player.username}</span>
              </div>
            </>
          )}

          {/* History chart - expands when player clicks their own entry */}
          {showHistory && player && (
            <div style={{
              marginTop: 8, paddingTop: 10,
              borderTop: '1px solid rgba(255,255,255,0.07)',
              width: 340,
            }}>
              <HistoryChart player={player} />
            </div>
          )}

          <div style={{ fontSize: 11, color: '#4a3a6a', textAlign: 'center', marginTop: 8 }}>
            {player ? 'Click your name for history · others to visit' : 'Click a player to visit their capital'}
          </div>
        </div>
      )}
    </div>
  )
}

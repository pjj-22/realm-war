import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { cellToLatLng } from 'h3-js'
import { api } from '../api/client'
import { useIsMobile } from '../hooks/useIsMobile'
import { useSocket } from '../hooks/useSocket'
import HistoryChart from './HistoryChart'
import { TrophyIcon, SwordsIcon, ChartIcon } from './Icons'
import { resolveFlag, drawFlagToCanvas } from '../flags'

function RowFlag({ p, size = 14 }) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current) drawFlagToCanvas(resolveFlag(p), ref.current, size / 16)
  }, [p.flag_pixels, p.username, size])
  return <canvas ref={ref} style={{ width: size, height: size, borderRadius: 2, imageRendering: 'pixelated', flexShrink: 0 }} />
}

export default function LeaderboardPanel({ player, onFlyTo }) {
  const isMobile = useIsMobile()
  const [board, setBoard] = useState([])
  const [open, setOpen] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  const debounceRef = useRef(null)
  const rowRefs = useRef(new Map())
  const prevRectsRef = useRef(new Map())

  // FLIP: when close bot rankings swap positions, the row list just re-sorts
  // instantly with no transition, which reads as a flicker/jump. Capture each
  // row's position before the reorder, then on the next paint invert it back
  // to where it was and transition to the real spot - a smooth slide instead.
  useLayoutEffect(() => {
    const newRects = new Map()
    rowRefs.current.forEach((el, key) => { if (el) newRects.set(key, el.getBoundingClientRect()) })
    const prevRects = prevRectsRef.current
    rowRefs.current.forEach((el, key) => {
      if (!el) return
      const prev = prevRects.get(key)
      const next = newRects.get(key)
      if (!prev || !next) return
      const dy = prev.top - next.top
      if (dy) {
        el.style.transition = 'none'
        el.style.transform = `translateY(${dy}px)`
        requestAnimationFrame(() => {
          el.style.transition = 'transform 0.35s ease'
          el.style.transform = ''
        })
      }
    })
    prevRectsRef.current = newRects
  }, [board])

  useEffect(() => { load() }, [])
  // hexes:update fires very often during active bot combat - debounce it so a
  // burst of captures collapses into one reload instead of reshuffling
  // near-tied rows (and remounting their flag canvases) many times a second.
  useSocket({ tick: load, 'hexes:update': () => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(load, 800)
  } })

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
        ref={el => { if (el) rowRefs.current.set(p.username, el); else rowRefs.current.delete(p.username) }}
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
        <RowFlag p={p} />
        <span style={{ fontSize: 14, flex: 1 }}>
          {p.alliance_tag && <span style={{ color: '#9070c0', fontSize: 11 }}>[{p.alliance_tag}] </span>}
          {displayName(p.username)}
          {p.champion_titles > 0 && (
            <span title={`${p.champion_titles} season championship${p.champion_titles > 1 ? 's' : ''}`} style={{ fontSize: 11, marginLeft: 4 }}>
              <TrophyIcon size={11} />{p.champion_titles > 1 ? `×${p.champion_titles}` : ''}
            </span>
          )}
        </span>
        {isBot && <span style={{ fontSize: 9, color: '#4a3a6a', letterSpacing: 1 }}>AI</span>}
        <span style={{ fontSize: 14, color: '#9a8aaa' }}>{p.hex_count}⬢</span>
        <span style={{ fontSize: 14, color: '#8a7aaa' }}>{p.total_troops}<SwordsIcon size={11} color="#8a7aaa" /></span>
        {isMe
          ? <span style={{ fontSize: 11, color: '#6a5a8a' }}>{showHistory ? '▲' : <ChartIcon size={12} color="#6a5a8a" />}</span>
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
      minWidth: isMobile ? 160 : 220, maxWidth: 'calc(100vw - 16px)', zIndex: 10,
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
        <span><TrophyIcon size={13} /> Leaderboard</span>
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
              <div
                onClick={() => setShowHistory(h => !h)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px', fontWeight: 'bold',
                  cursor: 'pointer', borderRadius: 3, transition: 'background 0.1s',
                  background: showHistory ? 'rgba(80,40,160,0.12)' : '',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(80,40,160,0.15)' }}
                onMouseLeave={e => { e.currentTarget.style.background = showHistory ? 'rgba(80,40,160,0.12)' : '' }}
                title="View your history"
              >
                <span style={{ fontSize: 14, color: '#8a7a9a', minWidth: 18, textAlign: 'right' }}>?.</span>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: player.color, display: 'inline-block', flexShrink: 0 }} />
                <span style={{ fontSize: 13, flex: 1 }}>{player.username}</span>
                <span style={{ fontSize: 11, color: '#6a5a8a' }}>{showHistory ? '▲' : <ChartIcon size={12} color="#6a5a8a" />}</span>
              </div>
            </>
          )}

          {/* History chart - expands when player clicks their own entry */}
          {showHistory && player && (
            <div style={{
              marginTop: 8, paddingTop: 10,
              borderTop: '1px solid rgba(255,255,255,0.07)',
              width: '100%', maxWidth: 340,
            }}>
              <HistoryChart player={player} />
            </div>
          )}

          <div style={{ fontSize: 11, color: '#857599', textAlign: 'center', marginTop: 8 }}>
            {player ? 'Click your name for history · others to visit' : 'Click a player to visit their capital'}
          </div>
        </div>
      )}
    </div>
  )
}

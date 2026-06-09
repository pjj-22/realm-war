import { useState, useEffect } from 'react'

function fmtRemaining(ms) {
  if (ms <= 0) return 'ending…'
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  if (d >= 1) return `${d}d ${Math.floor((s % 86400) / 3600)}h`
  const h = Math.floor(s / 3600)
  if (h >= 1) return `${h}h ${Math.floor((s % 3600) / 60)}m`
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

function useCountdown(endsAt) {
  const [left, setLeft] = useState(() => new Date(endsAt) - Date.now())
  useEffect(() => {
    const id = setInterval(() => setLeft(new Date(endsAt) - Date.now()), 1000)
    return () => clearInterval(id)
  }, [endsAt])
  return left
}

// Top-bar chip: season number + live countdown
export function SeasonChip({ season, onClick, isMobile }) {
  const left = useCountdown(season.ends_at)
  const urgent = left < 60 * 1000
  return (
    <button
      onClick={onClick}
      title={`Season ${season.number} - most hexes at the horn wins. Click for standings.`}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '3px 10px', marginLeft: 8,
        background: urgent ? 'rgba(200,60,40,0.2)' : 'rgba(120,80,200,0.12)',
        border: `1px solid ${urgent ? 'rgba(220,90,60,0.55)' : 'rgba(120,80,200,0.35)'}`,
        borderRadius: 12, cursor: 'pointer',
        color: urgent ? '#e08060' : '#9a8ac0',
        fontSize: 12, fontFamily: 'Georgia, serif', whiteSpace: 'nowrap',
      }}>
      🏁 {!isMobile && `S${season.number} · `}{fmtRemaining(left)}
    </button>
  )
}

function StandingsTable({ rows, highlight }) {
  if (!rows?.length) return <div style={{ color: '#6a5878', fontSize: 13 }}>No contenders yet.</div>
  return (
    <div>
      {rows.map((r, i) => (
        <div key={r.id || r.username} style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
          fontWeight: r.username === highlight ? 'bold' : 'normal',
          background: r.username === highlight ? 'rgba(120,80,200,0.1)' : 'none',
          borderRadius: 3,
        }}>
          <span style={{ width: 22, textAlign: 'right', color: '#8a7a9a', fontSize: 13 }}>
            {['🥇', '🥈', '🥉'][i] || `${i + 1}.`}
          </span>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: r.color, flexShrink: 0 }} />
          <span style={{ flex: 1, fontSize: 14, color: '#c4b498' }}>
            {r.alliance_tag && <span style={{ color: '#9070c0', fontSize: 11 }}>[{r.alliance_tag}] </span>}
            {r.username.startsWith('BOT_') ? r.username.slice(4) : r.username}
            {r.username.startsWith('BOT_') && <span style={{ fontSize: 9, color: '#4a3a6a', marginLeft: 4 }}>AI</span>}
          </span>
          <span style={{ fontSize: 13, color: '#9a8aaa' }}>{r.hex_count}▲</span>
          <span style={{ fontSize: 13, color: '#8a7aaa' }}>{r.total_troops}⚔</span>
          {r.crowns > 0 && <span style={{ fontSize: 13, color: '#c9a040' }}>{r.crowns}👑</span>}
        </div>
      ))}
    </div>
  )
}

const overlayStyle = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.82)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 160, padding: 16,
}
const boxStyle = {
  background: 'rgba(10,8,24,0.98)', border: '1px solid #4a3a7a', borderRadius: 10,
  padding: '24px 28px', width: '100%', maxWidth: 440,
  maxHeight: '85vh', overflowY: 'auto',
  boxShadow: '0 0 50px rgba(80,40,160,0.35)',
  fontFamily: 'Georgia, serif', color: '#c9b99a',
}

// Season dashboard: countdown, win condition, live standings, hall of fame
export default function SeasonPanel({ season, history, player, onClose }) {
  const left = useCountdown(season.ends_at)
  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={boxStyle} onClick={e => e.stopPropagation()}>
        <button onClick={onClose} style={{
          float: 'right', background: 'none', border: 'none',
          color: '#7a6890', fontSize: 20, cursor: 'pointer', lineHeight: 1,
        }}>×</button>
        <div style={{ fontSize: 18, letterSpacing: 4, textTransform: 'uppercase', textAlign: 'center', color: '#c0a0f0', marginBottom: 4 }}>
          🏁 Season {season.number}
        </div>
        <div style={{ textAlign: 'center', marginBottom: 14 }}>
          <span style={{ fontSize: 26, color: left < 60000 ? '#e08060' : '#e0d0b0', fontVariantNumeric: 'tabular-nums' }}>
            {fmtRemaining(left)}
          </span>
          <span style={{ fontSize: 13, color: '#7a6890' }}> until the horn</span>
        </div>

        <div style={{
          fontSize: 13, color: '#9a8aaa', lineHeight: 1.6, marginBottom: 16,
          padding: '10px 14px', background: 'rgba(120,80,200,0.08)',
          border: '1px solid rgba(120,80,200,0.2)', borderRadius: 6,
        }}>
          <b style={{ color: '#c0a0f0' }}>Win condition:</b> hold the most hexes when the season ends
          (ties broken by total troops). The Champion is immortalized in the Hall of Fame,
          then the map resets for a new age. Accounts, alliances, and history persist.
        </div>

        <div style={{ fontSize: 12, letterSpacing: 2, textTransform: 'uppercase', color: '#7a6890', marginBottom: 8 }}>
          Current standings
        </div>
        <StandingsTable rows={season.standings} highlight={player?.username} />

        {history?.length > 0 && (
          <>
            <div style={{ fontSize: 12, letterSpacing: 2, textTransform: 'uppercase', color: '#7a6890', margin: '18px 0 8px' }}>
              Hall of Fame
            </div>
            {history.map(s => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 4px', fontSize: 14 }}>
                <span style={{ color: '#8a7a9a', fontSize: 13, width: 32 }}>S{s.number}</span>
                {s.winner_username ? (
                  <>
                    <span style={{ width: 9, height: 9, borderRadius: '50%', background: s.winner_color, flexShrink: 0 }} />
                    <span style={{ color: '#e0c070' }}>👑 {s.winner_username.startsWith('BOT_') ? s.winner_username.slice(4) : s.winner_username}</span>
                    {s.snapshot?.[0] && <span style={{ fontSize: 12, color: '#7a6890' }}>{s.snapshot[0].hex_count} hexes</span>}
                  </>
                ) : (
                  <span style={{ color: '#6a5878' }}>no champion</span>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

// Full-screen moment when a season you played just ended
export function SeasonEndOverlay({ endedSeason, newNumber, player, onDismiss }) {
  const snapshot = endedSeason.snapshot || []
  const champion = snapshot[0]
  return (
    <div style={{ ...overlayStyle, zIndex: 180, background: 'rgba(0,0,0,0.9)' }}>
      <div style={{ ...boxStyle, maxWidth: 480, textAlign: 'center' }}>
        <div style={{ fontSize: 13, letterSpacing: 5, textTransform: 'uppercase', color: '#7a6890', marginBottom: 6 }}>
          The horn has sounded
        </div>
        <div style={{ fontSize: 26, letterSpacing: 3, color: '#e0c070', marginBottom: 14 }}>
          SEASON {endedSeason.number} COMPLETE
        </div>
        {champion && (
          <div style={{
            margin: '0 0 18px', padding: '14px 16px',
            background: 'rgba(200,150,40,0.1)', border: '1px solid rgba(200,150,40,0.35)',
            borderRadius: 8,
          }}>
            <div style={{ fontSize: 12, letterSpacing: 3, textTransform: 'uppercase', color: '#b08040', marginBottom: 6 }}>Champion</div>
            <div style={{ fontSize: 22, color: '#f0d080', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
              <span style={{ width: 13, height: 13, borderRadius: '50%', background: champion.color, display: 'inline-block' }} />
              👑 {champion.username.startsWith('BOT_') ? champion.username.slice(4) : champion.username}
            </div>
            <div style={{ fontSize: 13, color: '#9a8060', marginTop: 4 }}>
              {champion.hex_count} hexes · {champion.total_troops} troops{champion.crowns > 0 ? ` · ${champion.crowns} crowns` : ''}
            </div>
          </div>
        )}
        <div style={{ textAlign: 'left', marginBottom: 18 }}>
          <div style={{ fontSize: 12, letterSpacing: 2, textTransform: 'uppercase', color: '#7a6890', marginBottom: 8 }}>
            Final standings
          </div>
          <StandingsTable rows={snapshot} highlight={player?.username} />
        </div>
        <div style={{ fontSize: 13, color: '#9a8aaa', lineHeight: 1.6, marginBottom: 16 }}>
          The map has been reset. Claim a new capital and write the next chapter.
        </div>
        <button onClick={onDismiss} style={{
          width: '100%', padding: '12px 0',
          background: 'rgba(120,60,200,0.25)', border: '1px solid rgba(160,80,220,0.4)',
          borderRadius: 6, color: '#c090f0', cursor: 'pointer',
          fontSize: 14, letterSpacing: 3, textTransform: 'uppercase', fontFamily: 'Georgia, serif',
        }}>
          Begin Season {newNumber} →
        </button>
      </div>
    </div>
  )
}

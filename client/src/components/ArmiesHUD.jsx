import { useState, useEffect } from 'react'
import { cellToLatLng, gridDistance } from 'h3-js'
import { api } from '../api/client'
import { useIsMobile } from '../hooks/useIsMobile'
import { toast } from './Toast'
import { TroopFigure } from './BuildingArt'

const BUILDING_ICON = { mine: '⛏', barracks: '🏰', fort: '🛡' }

function parseTypes(types) {
  if (!types) return []
  if (Array.isArray(types)) return types
  return types.replace(/[{}"]/g, '').split(',').filter(Boolean)
}

// ── Hex row ──────────────────────────────────────────────────────────────────
function HexRow({ hex, isCapital, onFlyTo }) {
  return (
    <div
      onClick={() => onFlyTo?.(hex.h3_index)}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '4px 6px', borderRadius: 3,
        background: isCapital ? 'rgba(80,60,20,0.25)' : 'transparent',
        border: `1px solid ${isCapital ? 'rgba(200,160,40,0.2)' : 'transparent'}`,
        cursor: onFlyTo ? 'pointer' : 'default',
        transition: 'background 0.1s',
      }}
      onMouseEnter={e => { if (onFlyTo) e.currentTarget.style.background = 'rgba(80,40,160,0.18)' }}
      onMouseLeave={e => { e.currentTarget.style.background = isCapital ? 'rgba(80,60,20,0.25)' : 'transparent' }}
    >
      {isCapital
        ? <span style={{ fontSize: 14, color: '#c9a020', width: 12, flexShrink: 0 }}>★</span>
        : <span style={{ width: 12, flexShrink: 0 }} />
      }
      <span style={{ fontSize: 13, color: '#c9b99a', minWidth: 26, textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
        {hex.troop_count}
      </span>
      <span style={{ fontSize: 13, color: '#5a4a7a', flexShrink: 0 }}>⚔</span>
      <span style={{ fontSize: 9, color: '#4a3a6a', flex: 1, fontFamily: hex.country_name ? 'Georgia, serif' : 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: 0 }}>
        {hex.country_name || hex.h3_index}
      </span>
      {onFlyTo && <span style={{ fontSize: 9, color: '#3a2a5a', flexShrink: 0 }}>⌖</span>}
    </div>
  )
}

// ── Marching army row ─────────────────────────────────────────────────────────
function MarchRow({ army, isOwn, canRecall, onRecall, showDistance }) {
  const [progress, setProgress] = useState(0)
  const [remaining, setRemaining] = useState(0)
  const [hexesAway, setHexesAway] = useState(0)

  const totalHexes = (() => {
    try { return Math.max(1, gridDistance(army.from_hex, army.to_hex)) } catch { return 1 }
  })()

  useEffect(() => {
    function update() {
      const total   = new Date(army.arrives_at) - new Date(army.departed_at)
      const elapsed = Date.now() - new Date(army.departed_at)
      const pct     = Math.min(1, elapsed / total)
      setProgress(pct * 100)
      setRemaining(Math.max(0, Math.ceil((new Date(army.arrives_at) - Date.now()) / 1000)))
      setHexesAway(Math.max(0, Math.ceil(totalHexes * (1 - pct))))
    }
    update()
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [army.arrives_at, army.departed_at, totalHexes])

  const mins = Math.floor(remaining / 60)
  const secs = remaining % 60
  const eta  = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`

  return (
    <div style={{
      padding: '6px 8px', borderRadius: 3, marginBottom: 4,
      background: isOwn ? 'rgba(80,40,160,0.15)' : 'rgba(160,30,30,0.12)',
      border: `1px solid ${isOwn ? '#3a2a6a' : '#5a2a2a'}`,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, color: '#c9b99a' }}>
          <TroopFigure
            color={isOwn ? '#c9b99a' : (army.color || '#c06060')}
            size={20}
            animate
            count={army.quantity}
          />
          {!isOwn && <span style={{ color: '#9a8aaa' }}>{army.username}</span>}
        </span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {showDistance && (
            <span style={{ fontSize: 14, color: hexesAway <= 1 ? '#ff6060' : '#9a6a4a' }}>
              {hexesAway} hex{hexesAway !== 1 ? 'es' : ''} away
            </span>
          )}
          <span style={{ fontSize: 14, color: '#7a6a9a' }}>{eta}</span>
          {canRecall && (
            <button onClick={() => onRecall(army.id)} style={{
              padding: '1px 6px', background: 'rgba(100,30,30,0.4)',
              border: '1px solid #6a2a2a', borderRadius: 3,
              color: '#c09090', cursor: 'pointer', fontSize: 14, fontFamily: 'Georgia, serif',
            }}>Recall</button>
          )}
        </div>
      </div>
      <div style={{ height: 2, background: 'rgba(255,255,255,0.07)', borderRadius: 1 }}>
        <div style={{
          height: '100%', borderRadius: 1,
          background: isOwn ? '#6050b0' : '#903030',
          width: `${progress}%`, transition: 'width 1s linear',
        }} />
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ArmiesHUD({ armies, activeBattles = [], player, claimedRef, onRefresh, onFlyTo }) {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)

  const myArmies = armies.filter(a => a.owner_id === player?.id)
  const threats  = armies.filter(a =>
    player && a.owner_id !== player.id && claimedRef.current[a.to_hex]?.owner_id === player.id
  )

  const ownedHexes = Object.values(claimedRef.current)
    .filter(h => h.owner_id === player?.id)
    .sort((a, b) => b.troop_count - a.troop_count)

  const alertCount = myArmies.length + threats.length

  async function handleRecall(id) {
    try {
      await api.recallArmy(id)
      onRefresh?.()
    } catch (err) {
      toast(err.message)
    }
  }

  if (!player) return null

  return (
    <div style={{ position: 'absolute', top: 56, left: 16, fontFamily: 'Georgia, serif', zIndex: 10 }}>
      {/* Toggle button */}
      <button onClick={() => setOpen(o => !o)} style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px',
        background: 'rgba(10,8,25,0.85)',
        border: `1px solid ${threats.length > 0 ? '#7a2a2a' : '#4a3a7a'}`,
        borderRadius: 6, color: '#c9b99a', cursor: 'pointer', fontSize: 14, letterSpacing: 1,
        boxShadow: threats.length > 0 ? '0 0 12px rgba(180,40,40,0.4)' : '0 0 12px rgba(80,40,160,0.3)',
      }}>
        <span>⚔ Armies</span>
        {ownedHexes.length > 0 && (
          <span style={{ background: '#3a2a6a', borderRadius: 10, padding: '2px 8px', fontSize: 12 }}>
            {ownedHexes.length}▲
          </span>
        )}
        {threats.length > 0 && <span style={{ color: '#ff6060', fontSize: 12 }}>⚠{threats.length}</span>}
        {activeBattles.length > 0 && <span style={{ color: '#ff4444', fontSize: 12 }}>⚔{activeBattles.length}</span>}
      </button>

      {/* Panel */}
      {open && (
        <div style={{
          marginTop: 4,
          background: 'rgba(10,8,25,0.93)', border: '1px solid #4a3a7a',
          borderRadius: 6, padding: '12px 14px',
          width: isMobile ? 'calc(100vw - 32px)' : 210,
          boxShadow: '0 0 30px rgba(80,40,160,0.4)',
          maxHeight: '65vh', overflowY: 'auto',
        }}>

          {/* Threats */}
          {threats.length > 0 && (
            <>
              <SectionLabel color="#c06060">⚠ Incoming ({threats.length})</SectionLabel>
              {threats.map(a => (
                <MarchRow key={a.id} army={a} isOwn={false} canRecall={false} showDistance />
              ))}
              <Divider />
            </>
          )}

          {/* Your marching armies */}
          {myArmies.length > 0 && (
            <>
              <SectionLabel color="#8a7aaa">Marching ({myArmies.length})</SectionLabel>
              {myArmies.map(a => (
                <MarchRow key={a.id} army={a} isOwn canRecall onRecall={handleRecall} />
              ))}
              <Divider />
            </>
          )}

          {/* Hex list */}
          {ownedHexes.length > 0 ? (
            <>
              <SectionLabel color="#6a5a8a">Territory ({ownedHexes.length})</SectionLabel>
              {ownedHexes.map(h => (
                <HexRow
                  key={h.h3_index}
                  hex={h}
                  isCapital={h.h3_index === h.capital_hex}
                  onFlyTo={onFlyTo}
                />
              ))}
            </>
          ) : (
            <div style={{ fontSize: 14, color: '#5a4a7a', textAlign: 'center', padding: '10px 0' }}>
              No territory - claim a hex to start
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SectionLabel({ color, children }) {
  return (
    <div style={{ fontSize: 14, color, letterSpacing: 2, marginBottom: 5, textTransform: 'uppercase' }}>
      {children}
    </div>
  )
}

function Divider() {
  return <div style={{ borderTop: '1px solid #2a1a4a', margin: '8px 0' }} />
}

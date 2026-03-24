import { useState, useEffect } from 'react'
import { api } from '../api/client'

const BUILDINGS = [
  { type: 'mine',        label: 'Mine',         cost: '50g',  effect: '+3 gold/tick' },
  { type: 'mana_well',   label: 'Mana Well',    cost: '50g',  effect: '+3 mana/tick' },
  { type: 'barracks',    label: 'Barracks',     cost: '75g',  effect: 'Faster training' },
  { type: 'watch_tower', label: 'Watch Tower',  cost: '60g',  effect: 'Early warning' },
]

const COMBAT_STRENGTH = { knight: 1, archer: 1.2, trebuchet: 3 }

export default function HexPanel({ hex, player, onClaim, onLoginRequired, onBuild, onClose }) {
  const [building, setBuilding] = useState(null)
  const [defStrength, setDefStrength] = useState(null)
  const [loading, setLoading] = useState(false)
  const isClaimed = !!hex.owner
  const isOwn = player && hex.username === player.username

  useEffect(() => {
    if (!isClaimed) setBuilding(null)
    else api.getBuilding(hex.h3).then(setBuilding).catch(() => setBuilding(null))

    // Fetch military data for any hex (shows your troops on unclaimed hexes too)
    if (player) {
      api.getMilitary(hex.h3).then(data => {
        const str = (data.troops || []).reduce((s, t) => s + t.quantity * (COMBAT_STRENGTH[t.type] || 1), 0)
        setDefStrength(str > 0 ? str : null)
      }).catch(() => setDefStrength(null))
    } else {
      setDefStrength(null)
    }
  }, [hex.h3, isClaimed, player?.id])

  async function handleBuild(type) {
    setLoading(true)
    try {
      const result = await api.build(hex.h3, type)
      setBuilding({ type })
      onBuild?.(result.player)
    } catch (err) {
      alert(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleDemolish() {
    setLoading(true)
    try {
      await api.demolish(hex.h3)
      setBuilding(null)
    } catch (err) {
      alert(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      position: 'absolute', bottom: 30, right: 30,
      background: 'rgba(10,8,25,0.92)', border: '1px solid #4a3a7a',
      borderRadius: 8, padding: '20px 24px', minWidth: 300,
      color: '#c9b99a', fontFamily: 'Georgia, serif',
      boxShadow: '0 0 30px rgba(80,40,160,0.4)',
      maxHeight: '80vh', overflowY: 'auto',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <span style={{ fontSize: 13, letterSpacing: 3, color: '#7a6a9a', textTransform: 'uppercase' }}>
          {isClaimed ? 'Territory' : 'Wildlands'}
        </span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#7a6a9a', cursor: 'pointer', fontSize: 20 }}>×</button>
      </div>

      <div style={{ fontSize: 11, color: '#5a4a7a', marginBottom: 12, wordBreak: 'break-all' }}>{hex.h3}</div>

      {/* Stats */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 14, marginBottom: 16 }}>
        <Row label="Status" value={isClaimed ? 'Claimed' : 'Unclaimed'} color={isClaimed ? '#a0c080' : '#7a6a5a'} />
        <Row label="Owner" value={
          isClaimed
            ? <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 11, height: 11, borderRadius: '50%', background: hex.color, display: 'inline-block' }} />
                {hex.username}
              </span>
            : 'Unclaimed'
        } />
        <Row label="Building" value={building ? BUILDINGS.find(b => b.type === building.type)?.label || building.type : 'None'} />
        {isClaimed && <Row label="Troops" value={hex.troop_count ?? '—'} color="#a0c0e0" />}
        {!isClaimed && defStrength !== null && defStrength > 0 && (
          <Row label="Your Troops" value={`${Math.round(defStrength)} str — ready to claim`} color="#a0e0a0" />
        )}
        {isClaimed && defStrength !== null && <Row label="Defense" value={`${Math.round(defStrength)} str`} color="#c0a0e0" />}
        {isClaimed && <Row label="Income" value={
          building?.type === 'mine' ? '+4 gold/tick'
          : building?.type === 'mana_well' ? '+1 gold · +3 mana/tick'
          : '+1 gold/tick'
        } color="#d0b060" />}
      </div>

      {/* Claim button for guests */}
      {!isClaimed && !player && (
        <PanelButton onClick={onLoginRequired} muted>Login to Claim</PanelButton>
      )}

      {/* Claim button for logged-in players */}
      {!isClaimed && player && (
        <PanelButton onClick={() => onClaim(hex.h3)}>Claim Territory</PanelButton>
      )}

      {/* Build menu for own hex */}
      {isOwn && (
        <>
          <div style={{ borderTop: '1px solid #2a1a4a', margin: '14px 0 12px' }} />
          {building ? (
            <>
              <div style={{ fontSize: 12, color: '#7a6a9a', letterSpacing: 2, marginBottom: 8, textTransform: 'uppercase' }}>
                {BUILDINGS.find(b => b.type === building.type)?.label} Built
              </div>
              <div style={{ fontSize: 13, color: '#a090c0', marginBottom: 12 }}>
                {BUILDINGS.find(b => b.type === building.type)?.effect}
              </div>
              <PanelButton onClick={handleDemolish} muted disabled={loading}>Demolish</PanelButton>
            </>
          ) : (
            <>
              <div style={{ fontSize: 12, color: '#7a6a9a', letterSpacing: 2, marginBottom: 12, textTransform: 'uppercase' }}>Build</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {BUILDINGS.map(b => (
                  <button
                    key={b.type}
                    onClick={() => handleBuild(b.type)}
                    disabled={loading}
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '10px 12px', background: 'rgba(80,40,160,0.2)',
                      border: '1px solid #4a3a7a', borderRadius: 4,
                      color: '#c9b99a', cursor: 'pointer', fontSize: 13,
                      fontFamily: 'Georgia, serif',
                    }}>
                    <span>{b.label}</span>
                    <span style={{ color: '#7a6a9a', fontSize: 12 }}>{b.cost} · {b.effect}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

function Row({ label, value, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ color: '#7a6a9a' }}>{label}</span>
      <span style={{ color: color || '#c9b99a' }}>{value}</span>
    </div>
  )
}

function PanelButton({ onClick, children, muted, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      width: '100%', padding: '10px 0',
      background: muted ? 'rgba(40,20,80,0.3)' : 'rgba(80,40,160,0.3)',
      border: '1px solid #4a3a7a', borderRadius: 4,
      color: muted ? '#7a6a9a' : '#c9b99a', cursor: 'pointer',
      fontSize: 13, letterSpacing: 2, textTransform: 'uppercase',
      fontFamily: 'Georgia, serif',
    }}>
      {children}
    </button>
  )
}

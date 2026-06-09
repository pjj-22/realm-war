import { useState, useEffect, useCallback } from 'react'
import { api } from '../api/client'
import { toast } from './Toast'

const BUILDINGS = [
  { type: 'mine',     label: 'Mine',     icon: '⛏',  cost: '5g',  effect: '+3 gold/income' },
  { type: 'barracks', label: 'Barracks', icon: '🏰',  cost: '10g', effect: 'Train troops faster' },
  { type: 'fort',     label: 'Fort',     icon: '🛡',  cost: '10g', effect: '+40% defense' },
]

const UPGRADE_COST = { gold: 20 }

export default function HexPanel({ hex, player, onClaim, onLoginRequired, onBuild, onClose }) {
  const [buildingData, setBuildingData] = useState(null) // { buildings[], slots, usedSlots, upgradeLevel, upgrading }
  const [defStrength, setDefStrength] = useState(null)
  const [loading, setLoading] = useState(false)
  const isClaimed = !!hex.owner
  const isOwn = player && hex.username === player.username

  const loadBuildings = useCallback(() => {
    if (!isClaimed) { setBuildingData(null); return }
    api.getBuildings(hex.h3).then(setBuildingData).catch(() => setBuildingData(null))
  }, [hex.h3, isClaimed])

  useEffect(() => {
    loadBuildings()

    if (player) {
      api.getMilitary(hex.h3).then(data => {
        const str = (data.troops || []).reduce((s, t) => s + t.quantity, 0)
        setDefStrength(str > 0 ? str : null)
      }).catch(() => setDefStrength(null))
    } else {
      setDefStrength(null)
    }
  }, [hex.h3, isClaimed, player?.id, loadBuildings])

  // Auto-refresh when upgrade timer expires
  useEffect(() => {
    if (!buildingData?.upgrading) return
    const ms = new Date(buildingData.upgrading.completes_at) - Date.now()
    if (ms <= 0) { loadBuildings(); return }
    const timer = setTimeout(loadBuildings, ms + 500)
    return () => clearTimeout(timer)
  }, [buildingData?.upgrading?.completes_at, loadBuildings])

  async function handleBuild(type) {
    // Optimistic update - immediately show building as pending
    setBuildingData(prev => prev ? {
      ...prev,
      buildings: [...prev.buildings, { id: '__pending__', type, pending: true }],
      usedSlots: prev.usedSlots + 1,
    } : prev)
    setLoading(true)
    try {
      const result = await api.build(hex.h3, type)
      onBuild?.(result.player, hex.h3, type)
      loadBuildings() // sync real data from server
    } catch (err) {
      // Roll back
      setBuildingData(prev => prev ? {
        ...prev,
        buildings: prev.buildings.filter(b => b.id !== '__pending__'),
        usedSlots: prev.usedSlots - 1,
      } : prev)
      toast(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleDemolish(buildingId) {
    setLoading(true)
    try {
      await api.demolish(buildingId)
      loadBuildings()
    } catch (err) {
      toast(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleUpgrade() {
    setLoading(true)
    try {
      const result = await api.upgradeHex(hex.h3)
      loadBuildings()
      onBuild?.(result.player)
    } catch (err) {
      toast(err.message)
    } finally {
      setLoading(false)
    }
  }

  // Compute income from current buildings
  const income = (() => {
    if (!buildingData?.buildings) return { gold: 1 }
    let gold = 1
    for (const b of buildingData.buildings) {
      if (b.type === 'mine') gold += 3
    }
    return { gold }
  })()

  // Grouped building counts for the "Built" section
  const builtGroups = (() => {
    if (!buildingData?.buildings?.length) return []
    const counts = {}
    for (const b of buildingData.buildings) {
      if (!counts[b.type]) counts[b.type] = { type: b.type, ids: [], pending: false }
      counts[b.type].ids.push(b.id)
      if (b.pending) counts[b.type].pending = true
    }
    return Object.values(counts)
  })()

  const upgradeInProgress = !!buildingData?.upgrading && new Date(buildingData.upgrading.completes_at) > Date.now()

  return (
    <div style={{
      position: 'absolute', bottom: 30, right: 30,
      background: 'rgba(10,8,25,0.92)', border: '1px solid #4a3a7a',
      borderRadius: 8, padding: '20px 24px', minWidth: 340,
      color: '#c9b99a', fontFamily: 'Georgia, serif',
      boxShadow: '0 0 30px rgba(80,40,160,0.4)',
      maxHeight: '80vh', overflowY: 'auto',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div>
          <span style={{ fontSize: 15, letterSpacing: 3, color: '#7a6a9a', textTransform: 'uppercase' }}>
            {isClaimed ? 'Territory' : 'Wildlands'}
          </span>
          {hex.country_name && (
            <div style={{ fontSize: 12, color: '#9a8a6a', marginTop: 2 }}>
              {hex.country_name}{hex.country_continent ? ` · ${hex.country_continent}` : ''}
            </div>
          )}
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#7a6a9a', cursor: 'pointer', fontSize: 22 }}>×</button>
      </div>

      <div style={{ fontSize: 11, color: '#5a4a7a', marginBottom: 12, wordBreak: 'break-all' }}>{hex.h3}</div>

      {/* Stats */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 15, marginBottom: 16 }}>
        <Row label="Status" value={isClaimed ? 'Claimed' : 'Unclaimed'} color={isClaimed ? '#a0c080' : '#7a6a5a'} />
        <Row label="Owner" value={
          isClaimed
            ? <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 11, height: 11, borderRadius: '50%', background: hex.color, display: 'inline-block' }} />
                {hex.username}
              </span>
            : 'Unclaimed'
        } />
        {isClaimed && buildingData && (
          <Row label="Slots" value={`${buildingData.usedSlots} / ${buildingData.slots}`} color="#b090e0" />
        )}
        {isClaimed && <Row label="Troops" value={hex.troop_count ?? '-'} color="#a0c0e0" />}
        {!isClaimed && defStrength !== null && defStrength > 0 && (
          <Row label="Your Troops" value={`${Math.round(defStrength)} str - ready to claim`} color="#a0e0a0" />
        )}
        {isClaimed && defStrength !== null && <Row label="Defense" value={`${Math.round(defStrength)} str`} color="#c0a0e0" />}
        {isClaimed && (
          <Row label="Income" value={`+${income.gold} gold/harvest`} color="#d0b060" />
        )}
      </div>

      {/* Claim button */}
      {!isClaimed && !player && (
        <PanelButton onClick={onLoginRequired} muted>Login to Claim</PanelButton>
      )}
      {!isClaimed && player && (
        <PanelButton onClick={() => onClaim(hex.h3)}>Claim Territory</PanelButton>
      )}

      {/* Buildings section */}
      {isOwn && (
        <>
          <div style={{ borderTop: '1px solid #2a1a4a', margin: '14px 0 12px' }} />

          {/* Existing buildings - grouped by type with count */}
          {builtGroups.length > 0 && (
            <>
              <div style={{ fontSize: 13, color: '#7a6a9a', letterSpacing: 2, marginBottom: 10, textTransform: 'uppercase' }}>
                Built
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
                {builtGroups.map(group => {
                  const def = BUILDINGS.find(x => x.type === group.type)
                  const count = group.ids.length
                  return (
                    <div key={group.type} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '9px 12px', background: group.pending ? 'rgba(80,60,120,0.35)' : 'rgba(60,40,100,0.25)',
                      border: `1px solid ${group.pending ? '#6a5a9a' : '#3a2a6a'}`, borderRadius: 4,
                    }}>
                      <span style={{ fontSize: 15 }}>
                        {def?.icon} {def?.label || group.type}
                        {count > 1 && <span style={{ marginLeft: 6, fontSize: 13, color: '#a090e0' }}>×{count}</span>}
                        {group.pending && <span style={{ marginLeft: 6, fontSize: 11, color: '#8a7aaa' }}>building…</span>}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 12, color: '#8a7aaa' }}>{def?.effect}</span>
                        {!group.pending && (
                          <button
                            onClick={() => handleDemolish(group.ids[group.ids.length - 1])}
                            disabled={loading}
                            style={{
                              background: 'rgba(100,30,30,0.3)', border: '1px solid #7a3a3a',
                              borderRadius: 3, color: '#c07070', cursor: 'pointer',
                              fontSize: 12, padding: '2px 8px', fontFamily: 'Georgia, serif',
                            }}>
                            ✕
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {/* Build more (if slots available) */}
          {buildingData && buildingData.usedSlots < buildingData.slots && (
            <>
              <div style={{ fontSize: 13, color: '#7a6a9a', letterSpacing: 2, marginBottom: 10, textTransform: 'uppercase' }}>
                Build
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
                {BUILDINGS.map(b => (
                  <button
                    key={b.type}
                    onClick={() => handleBuild(b.type)}
                    disabled={loading}
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '11px 12px', background: 'rgba(80,40,160,0.2)',
                      border: '1px solid #4a3a7a', borderRadius: 4,
                      color: '#c9b99a', cursor: 'pointer', fontSize: 14,
                      fontFamily: 'Georgia, serif',
                    }}>
                    <span>{b.icon} {b.label}</span>
                    <span style={{ color: '#7a6a9a', fontSize: 13 }}>{b.cost} · {b.effect}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Upgrade section */}
          {buildingData && (
            <>
              <div style={{ borderTop: '1px solid #2a1a4a', marginBottom: 12 }} />
              <div style={{ fontSize: 13, color: '#7a6a9a', letterSpacing: 2, marginBottom: 10, textTransform: 'uppercase' }}>
                Hex Upgrade - Level {buildingData.upgradeLevel} / {buildingData.maxUpgradeLevel}
              </div>
              {upgradeInProgress ? (
                <UpgradeTimer completes_at={buildingData.upgrading.completes_at} upgradeMinutes={buildingData.upgrade_minutes || 0.5} onExpire={loadBuildings} />
              ) : buildingData.upgradeLevel < buildingData.maxUpgradeLevel ? (
                <>
                  <div style={{ fontSize: 13, color: '#8a7a9a', marginBottom: 8 }}>
                    +2 building slots · costs {UPGRADE_COST.gold}g
                  </div>
                  <PanelButton onClick={handleUpgrade} disabled={loading}>
                    Upgrade Hex
                  </PanelButton>
                </>
              ) : (
                <div style={{ fontSize: 14, color: '#6a5a8a' }}>Max level reached</div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

function UpgradeTimer({ completes_at, upgradeMinutes, onExpire }) {
  const [pct, setPct] = useState(0)
  const [secsLeft, setSecsLeft] = useState(0)

  useEffect(() => {
    function update() {
      const now = Date.now()
      const end = new Date(completes_at).getTime()
      const start = end - upgradeMinutes * 60 * 1000
      const newPct = Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100))
      const secs = Math.max(0, Math.round((end - now) / 1000))
      setPct(newPct)
      setSecsLeft(secs)
      if (secs === 0) onExpire()
    }
    update()
    const interval = setInterval(update, 500)
    return () => clearInterval(interval)
  }, [completes_at, onExpire])

  return (
    <>
      <div style={{ fontSize: 13, color: '#a090c0', marginBottom: 6 }}>
        Upgrading… {secsLeft > 0 ? `${secsLeft}s remaining` : 'Complete! Refreshing…'}
      </div>
      <div style={{ height: 8, background: '#1a1030', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{
          width: `${pct}%`, height: '100%',
          background: 'linear-gradient(90deg, #6030c0, #9060f0)',
          transition: 'width 0.3s',
        }} />
      </div>
    </>
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
      width: '100%', padding: '11px 0',
      background: muted ? 'rgba(40,20,80,0.3)' : 'rgba(80,40,160,0.3)',
      border: '1px solid #4a3a7a', borderRadius: 4,
      color: muted ? '#7a6a9a' : '#c9b99a', cursor: 'pointer',
      fontSize: 14, letterSpacing: 2, textTransform: 'uppercase',
      fontFamily: 'Georgia, serif',
    }}>
      {children}
    </button>
  )
}

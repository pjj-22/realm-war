import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '../api/client'
import { GoldIcon } from './Icons'
import { useIsMobile } from '../hooks/useIsMobile'

// ── constants ─────────────────────────────────────────────────────────────────

const BUILDING_DEFS = [
  {
    type: 'mine', label: 'Mine', color: '#c9902a', goldCost: 5,
    effect: '+3 gold per harvest',
    desc: 'Extracts gold from the land each harvest cycle. Stack multiple mines on one hex to maximize income from your richest territories.',
  },
  {
    type: 'barracks', label: 'Barracks', color: '#a84040', goldCost: 10,
    effect: 'Enables training · halves train time',
    desc: 'Without a barracks you cannot train troops on this hex. Building one also cuts all training times in half. Only one barracks per hex.',
  },
  {
    type: 'fort', label: 'Fort', color: '#5a9840', goldCost: 10,
    effect: '+40% defender strength',
    desc: 'A fortified position that strengthens your garrison. Each fort adds 40% to the defensive strength of troops holding this hex.',
  },
]

const TROOP_DEFS = [
  {
    type: 'troop', label: 'Troops', goldCost: 1, time: '6s',
    desc: 'Versatile soldiers for claiming territory, garrisoning hexes, and attacking enemies. Train in bulk and march them across the map.',
  },
]

const UPGRADE_COST = { gold: 20 }
const UPGRADE_MINUTES = 0.5

// ── small utilities ───────────────────────────────────────────────────────────

function Label({ children }) {
  return (
    <div style={{ fontSize: 10, color: '#9a8060', letterSpacing: 3, textTransform: 'uppercase', marginBottom: 10 }}>
      {children}
    </div>
  )
}

function Dot({ color }) {
  return <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }} />
}

function Btn({ onClick, children, disabled, danger, muted }) {
  const bg = danger ? 'rgba(140,30,30,0.3)' : muted ? 'rgba(255,255,255,0.03)' : 'rgba(150,100,20,0.25)'
  const border = danger ? 'rgba(180,50,50,0.4)' : muted ? 'rgba(255,255,255,0.07)' : 'rgba(200,150,40,0.4)'
  const color = danger ? '#c08080' : muted ? '#7a6860' : '#d4b870'
  return (
    <button onClick={onClick} disabled={disabled} style={{
      padding: '7px 16px', background: bg,
      border: `1px solid ${border}`, borderRadius: 4,
      color, cursor: disabled ? 'default' : 'pointer',
      fontSize: 12, letterSpacing: 1, fontFamily: 'Georgia, serif',
      opacity: disabled ? 0.5 : 1,
    }}>
      {children}
    </button>
  )
}

function ProgressBar({ pct, color = 'linear-gradient(90deg, #5030a0, #8060d0)' }) {
  return (
    <div style={{ height: 3, background: 'rgba(255,255,255,0.07)', borderRadius: 2, overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.5s linear' }} />
    </div>
  )
}

function TrainBar({ job }) {
  const barRef   = useRef(null)
  const labelRef = useRef(null)

  useEffect(() => {
    const start    = new Date(job.started_at).getTime()
    const end      = new Date(job.completes_at).getTime()
    const perTroop = (end - start) / job.quantity
    let raf

    function tick() {
      const now        = Date.now()
      const elapsed    = now - start
      const troopsDone = Math.min(job.quantity, Math.floor(elapsed / perTroop))
      const remaining  = job.quantity - troopsDone
      const slotStart  = start + troopsDone * perTroop
      const pct        = troopsDone >= job.quantity ? 100
                         : Math.min(100, ((now - slotStart) / perTroop) * 100)
      const remSecs    = Math.max(0, Math.ceil((slotStart + perTroop - now) / 1000))

      if (barRef.current)   barRef.current.style.width = `${pct}%`
      if (labelRef.current) {
        const m = Math.floor(remSecs / 60), s = remSecs % 60
        const eta = m > 0 ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`
        labelRef.current.textContent = remaining > 1 ? `×${remaining}  ${eta}` : eta
      }

      raf = requestAnimationFrame(tick)
    }

    tick()
    return () => cancelAnimationFrame(raf)
  }, [job.started_at, job.completes_at, job.quantity])

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
        <span style={{ color: '#a090c0' }}>{job.type}s</span>
        <span style={{ color: '#8070a0' }} ref={labelRef} />
      </div>
      <div style={{ height: 3, background: 'rgba(255,255,255,0.07)', borderRadius: 2, overflow: 'hidden' }}>
        <div ref={barRef} style={{ width: '0%', height: '100%', borderRadius: 2, background: 'linear-gradient(90deg, #5030a0, #8060d0)' }} />
      </div>
    </div>
  )
}

function UpgradeBar({ completes_at, onExpire }) {
  const [pct, setPct] = useState(0)
  const [secs, setSecs] = useState(0)
  useEffect(() => {
    function tick() {
      const end = new Date(completes_at).getTime()
      const start = end - UPGRADE_MINUTES * 60 * 1000
      const now = Date.now()
      setPct(Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100)))
      const s = Math.max(0, Math.round((end - now) / 1000))
      setSecs(s)
      if (s === 0) onExpire()
    }
    tick()
    const id = setInterval(tick, 500)
    return () => clearInterval(id)
  }, [completes_at, onExpire])
  return (
    <div>
      <div style={{ fontSize: 12, color: '#8070a8', marginBottom: 4 }}>
        Upgrading — {secs > 0 ? `${secs}s remaining` : 'Complete…'}
      </div>
      <ProgressBar pct={pct} color="linear-gradient(90deg, #5030c0, #9060f0)" />
    </div>
  )
}

// ── main component ────────────────────────────────────────────────────────────

export default function BottomDrawer({ hex, player, onClaim, onLoginRequired, onBuild, onPlayerUpdate, onMarchStart, onClose }) {
  const isMobile = useIsMobile()
  const isOwn    = !!(player && hex?.username === player.username)
  const isClaimed = !!hex?.owner
  const tabs = isOwn ? ['territory', 'buildings', 'military'] : ['territory']

  const [tab, setTab] = useState('territory')
  const [buildingData, setBuildingData] = useState(null)
  const [military, setMilitary] = useState(null)
  const [trainQty, setTrainQty] = useState(10)
  const [dispatchQty, setDispatchQty] = useState({ troop: 0 })
  const [busy, setBusy] = useState(false)

  useEffect(() => { setTab('territory') }, [hex?.h3])

  const loadBuildings = useCallback(() => {
    if (!isClaimed || !hex?.h3) return
    api.getBuildings(hex.h3).then(setBuildingData).catch(() => {})
  }, [hex?.h3, isClaimed])

  const loadMilitary = useCallback(() => {
    if (!hex?.h3) return
    api.getMilitary(hex.h3).then(setMilitary).catch(() => {})
  }, [hex?.h3])

  useEffect(() => {
    setBuildingData(null)
    setMilitary(null)
    if (!hex) return
    loadBuildings()
    loadMilitary()
    const id = setInterval(loadMilitary, 5000)
    return () => clearInterval(id)
  }, [hex?.h3, loadBuildings, loadMilitary])

  // Auto-refresh when upgrade timer expires
  useEffect(() => {
    if (!buildingData?.upgrading) return
    const ms = new Date(buildingData.upgrading.completes_at) - Date.now()
    if (ms <= 0) { loadBuildings(); return }
    const t = setTimeout(loadBuildings, ms + 500)
    return () => clearTimeout(t)
  }, [buildingData?.upgrading?.completes_at, loadBuildings])

  // ── derived data ─────────────────────────────────────────────

  const income = (() => {
    if (!buildingData?.buildings) return { gold: 1 }
    let gold = 1
    for (const b of buildingData.buildings) {
      if (b.type === 'mine') gold += 3
    }
    return { gold }
  })()

  const troopMap = {}
  military?.troops?.forEach(t => { troopMap[t.type] = t.quantity })

  const builtGroups = (() => {
    if (!buildingData?.buildings?.length) return []
    const m = {}
    for (const b of buildingData.buildings) {
      if (!m[b.type]) m[b.type] = { type: b.type, ids: [], pending: false }
      m[b.type].ids.push(b.id)
      if (b.pending) m[b.type].pending = true
    }
    return Object.values(m)
  })()

  // ── actions ──────────────────────────────────────────────────

  async function handleBuild(type) {
    setBuildingData(prev => prev ? {
      ...prev,
      buildings: [...prev.buildings, { id: '__pending__', type, pending: true }],
      usedSlots: prev.usedSlots + 1,
    } : prev)
    setBusy(true)
    try {
      const r = await api.build(hex.h3, type)
      onBuild?.(r.player, hex.h3, type)
      loadBuildings()
    } catch (err) {
      setBuildingData(prev => prev ? {
        ...prev,
        buildings: prev.buildings.filter(b => b.id !== '__pending__'),
        usedSlots: prev.usedSlots - 1,
      } : prev)
      alert(err.message)
    } finally { setBusy(false) }
  }

  async function handleDemolish(id) {
    setBusy(true)
    try { await api.demolish(id); loadBuildings() }
    catch (err) { alert(err.message) }
    finally { setBusy(false) }
  }

  async function handleUpgrade() {
    setBusy(true)
    try {
      const r = await api.upgradeHex(hex.h3)
      onPlayerUpdate?.(r.player)
      loadBuildings()
    } catch (err) { alert(err.message) }
    finally { setBusy(false) }
  }

  async function handleTrain(type) {
    const qty = trainQty
    setBusy(true)
    try {
      const r = await api.trainTroops(hex.h3, type, qty)
      onPlayerUpdate?.(r.player)
      loadMilitary()
    } catch (err) { alert(err.message) }
    finally { setBusy(false) }
  }

  function handleDispatch() {
    const hasAny = Object.values(dispatchQty).some(n => n > 0)
    if (!hasAny) return
    onMarchStart?.(hex.h3, dispatchQty)
  }

  // ── tab panels ───────────────────────────────────────────────

  function TerritoryPanel() {
    const troops = Object.entries(troopMap).filter(([, n]) => n > 0)
    return (
      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 20 : 48 }}>
        <div style={{ flex: 1 }}>
          {isClaimed ? (
            <>
              <Label>Income</Label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 18, color: '#c9902a', marginBottom: 16 }}>
                <GoldIcon size={16} />
                <span>+{income.gold}</span>
                <span style={{ fontSize: 12, color: '#7a6040' }}>per harvest</span>
              </div>
              {troops.length > 0 && (
                <>
                  <Label>Stationed</Label>
                  <div style={{ fontSize: 18, color: '#d4b870' }}>
                    {troops.map(([type, n]) => `${n} ${type}s`).join(' · ')}
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <div style={{ fontSize: 15, color: '#6a5838', marginBottom: 16 }}>Unclaimed territory</div>
              {!player
                ? <Btn onClick={onLoginRequired} muted>Login to Claim</Btn>
                : <Btn onClick={() => onClaim(hex.h3)}>Claim Territory</Btn>
              }
            </>
          )}
        </div>
        <div style={{ flex: 1 }}>
          {isClaimed && buildingData?.buildings?.length > 0 && (
            <>
              <Label>Building</Label>
              {buildingData.buildings.map(b => {
                const def = BUILDING_DEFS.find(d => d.type === b.type)
                return (
                  <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15 }}>
                    <Dot color={def?.color || '#888'} />
                    <span style={{ color: '#d4c498' }}>{def?.label}</span>
                    <span style={{ fontSize: 11, color: '#7a6040', marginLeft: 4 }}>{def?.effect}</span>
                  </div>
                )
              })}
            </>
          )}
        </div>
      </div>
    )
  }

  function BuildingsPanel() {
    if (!isOwn) return null
    const hasBuilding = buildingData && buildingData.buildings.length > 0
    const buildableTypes = buildingData
      ? BUILDING_DEFS.filter(b => !buildingData.buildings.some(x => x.type === b.type))
      : []

    return (
      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 20 : 48 }}>
        {/* Built */}
        <div style={{ flex: 1 }}>
          <Label>Building</Label>
          {builtGroups.length === 0 && (
            <div style={{ fontSize: 13, color: '#6a5878' }}>No building constructed yet.</div>
          )}
          {builtGroups.map(g => {
            const def = BUILDING_DEFS.find(d => d.type === g.type)
            return (
              <div key={g.type} style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Dot color={def?.color || '#888'} />
                  <span style={{ fontSize: 14, color: '#c4b498', flex: 1 }}>
                    {def?.label}
                    {g.pending && <span style={{ color: '#7a6890', marginLeft: 6, fontSize: 12 }}>building…</span>}
                  </span>
                  <span style={{ fontSize: 11, color: '#8070a0' }}>{def?.effect}</span>
                  {!g.pending && (
                    <button onClick={() => handleDemolish(g.ids[0])} disabled={busy}
                      style={{ background: 'none', border: 'none', color: '#7a4848', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 4px' }}>
                      ×
                    </button>
                  )}
                </div>
                {def?.desc && (
                  <div style={{ fontSize: 11, color: '#6a5878', marginTop: 3, marginLeft: 16, lineHeight: 1.5 }}>{def.desc}</div>
                )}
              </div>
            )
          })}
        </div>

        {/* Build */}
        <div style={{ flex: 1 }}>
          {!hasBuilding && buildableTypes.length > 0 && (
            <>
              <Label>Build</Label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {buildableTypes.map(b => (
                  <button key={b.type} onClick={() => handleBuild(b.type)} disabled={busy}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 10, textAlign: 'left',
                      padding: '8px 12px', background: 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(255,255,255,0.09)', borderRadius: 4,
                      color: '#b4a488', cursor: 'pointer', fontFamily: 'Georgia, serif',
                    }}>
                    <Dot color={b.color} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                        <span>{b.label}</span>
                        <span style={{ color: '#7a6890', fontSize: 11 }}>
                          <GoldIcon size={10} /> {b.goldCost}
                        </span>
                        <span style={{ color: '#8070a0', fontSize: 11, marginLeft: 'auto' }}>{b.effect}</span>
                      </div>
                      <div style={{ fontSize: 11, color: '#6a5878', lineHeight: 1.4 }}>{b.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
          {hasBuilding && (
            <div style={{ fontSize: 12, color: '#6a5878' }}>
              Demolish the current building to build a different one.
            </div>
          )}
        </div>
      </div>
    )
  }

  const TRAIN_PRESETS = [1, 2, 5, 10, 25, 50, 100]
  const DISPATCH_PRESETS = [1, 5, 10, 25, 50, 100]

  function MilitaryPanel() {
    if (!isOwn) return null
    const ready = troopMap.troop || 0
    const sendQty = Math.min(dispatchQty.troop || ready, ready)

    return (
      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 20 : 48 }}>

        {/* Left: garrison + march */}
        <div style={{ flex: 1 }}>
          <Label>Garrison</Label>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 16 }}>
            <span style={{ fontSize: 28, color: ready > 0 ? '#d4b870' : '#6a5848', fontVariantNumeric: 'tabular-nums' }}>{ready}</span>
            <span style={{ fontSize: 13, color: '#9a8060' }}>troops ready</span>
          </div>

          {ready > 0 && (
            <>
              <Label>Send how many</Label>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 12 }}>
                {DISPATCH_PRESETS.map(n => (
                  <button key={n}
                    onClick={() => setDispatchQty({ troop: Math.min(ready, n) })}
                    style={{
                      padding: '4px 10px', borderRadius: 3, fontSize: 12, fontFamily: 'Georgia, serif', cursor: 'pointer',
                      background: sendQty === Math.min(ready, n) ? 'rgba(180,130,30,0.3)' : 'rgba(255,255,255,0.04)',
                      border: `1px solid ${sendQty === Math.min(ready, n) ? 'rgba(200,150,40,0.6)' : 'rgba(255,255,255,0.09)'}`,
                      color: ready >= n ? '#d4b870' : '#6a5848',
                      opacity: ready === 0 ? 0.4 : 1,
                    }}>{n}</button>
                ))}
                <button
                  onClick={() => setDispatchQty({ troop: ready })}
                  style={{
                    padding: '4px 10px', borderRadius: 3, fontSize: 12, fontFamily: 'Georgia, serif', cursor: 'pointer',
                    background: sendQty === ready ? 'rgba(180,130,30,0.3)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${sendQty === ready ? 'rgba(200,150,40,0.6)' : 'rgba(255,255,255,0.09)'}`,
                    color: '#d4b870',
                  }}>All</button>
              </div>
              <Btn onClick={handleDispatch} danger>
                March {sendQty} → Click target hex
              </Btn>
            </>
          )}

          {ready === 0 && (
            <div style={{ fontSize: 12, color: '#6a5848' }}>
              No troops stationed here. Train some first.
            </div>
          )}

          {military?.armies?.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <Label>Marching</Label>
              {military.armies.map(a => {
                const pct = Math.min(100, ((Date.now() - new Date(a.departed_at)) / (new Date(a.arrives_at) - new Date(a.departed_at))) * 100)
                const mins = Math.max(0, Math.ceil((new Date(a.arrives_at) - Date.now()) / 60000))
                return (
                  <div key={a.id} style={{ marginBottom: 9 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#9a8060', marginBottom: 3 }}>
                      <span>{a.quantity} troops</span>
                      <span>{mins}m remaining</span>
                    </div>
                    <ProgressBar pct={pct} color="linear-gradient(90deg, #802020, #c04040)" />
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Right: train + queues */}
        <div style={{ flex: 1 }}>
          <Label>Train Troops · <GoldIcon size={10} /> 1 each</Label>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 12 }}>
            {TRAIN_PRESETS.map(n => (
              <button key={n} onClick={() => setTrainQty(n)} style={{
                padding: '4px 10px', borderRadius: 3, fontSize: 12, fontFamily: 'Georgia, serif', cursor: 'pointer',
                background: trainQty === n ? 'rgba(180,130,30,0.3)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${trainQty === n ? 'rgba(200,150,40,0.6)' : 'rgba(255,255,255,0.09)'}`,
                color: trainQty === n ? '#d4b870' : '#6a5848',
              }}>{n}</button>
            ))}
          </div>
          <Btn onClick={() => handleTrain('troop')} disabled={busy}>
            Train {trainQty}
          </Btn>
          {!buildingData?.buildings?.some(b => b.type === 'barracks') && (
            <div style={{ fontSize: 11, color: '#8a6040', marginTop: 8 }}>
              Build a Barracks first to train troops here.
            </div>
          )}

          {military?.training?.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <Label>Training Queue</Label>
              {military.training.map(j => <TrainBar key={j.id} job={j} />)}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── render ───────────────────────────────────────────────────

  const [collapsed, setCollapsed] = useState(false)
  const ownerLabel = isClaimed ? hex.username : 'Wildlands'

  return (
    <div style={{
      position: 'absolute', bottom: 0,
      left: isMobile ? 0 : '50%',
      transform: isMobile ? 'none' : 'translateX(-50%)',
      width: isMobile ? '100vw' : 'min(780px, 96vw)',
      background: 'linear-gradient(180deg, rgba(18,12,4,0.98) 0%, rgba(10,7,2,0.99) 100%)',
      border: '1px solid rgba(160,110,30,0.45)',
      borderBottom: 'none',
      borderRadius: isMobile ? '10px 10px 0 0' : '14px 14px 0 0',
      boxShadow: '0 -4px 40px rgba(0,0,0,0.7), inset 0 1px 0 rgba(200,150,40,0.15)',
      fontFamily: 'Georgia, serif',
      color: '#c4b498',
      zIndex: 20,
    }}>
      {/* Header — always visible */}
      <div
        onClick={() => setCollapsed(c => !c)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: isMobile ? '12px 16px 12px 18px' : '13px 20px 13px 28px',
          cursor: 'pointer',
          borderBottom: collapsed ? 'none' : '1px solid rgba(160,110,30,0.15)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {isClaimed && <Dot color={hex.color} />}
          <span style={{ fontSize: 16, color: isClaimed ? '#e8d090' : '#5a4a28', letterSpacing: 2 }}>
            {ownerLabel}
          </span>
          {hex.capital_hex === hex.h3 && (
            <span style={{ fontSize: 10, color: '#b08030', letterSpacing: 2, textTransform: 'uppercase', border: '1px solid rgba(160,110,30,0.4)', borderRadius: 3, padding: '1px 6px' }}>Capital</span>
          )}
        </div>
        <span style={{ fontSize: 13, color: '#5a4828', userSelect: 'none' }}>{collapsed ? '▲' : '▼'}</span>
      </div>

      {/* Tabs + content — hidden when collapsed */}
      {!collapsed && (
        <>
          <div style={{
            display: 'flex', alignItems: 'flex-end', gap: 2,
            padding: isMobile ? '8px 16px 0' : '10px 28px 0',
            borderBottom: '1px solid rgba(160,110,30,0.2)',
          }}>
            {tabs.map(t => (
              <button key={t} onClick={() => setTab(t)} style={{
                padding: isMobile ? '10px 16px 12px' : '8px 20px 10px',
                background: tab === t ? 'rgba(160,110,30,0.12)' : 'none',
                border: tab === t ? '1px solid rgba(160,110,30,0.3)' : '1px solid transparent',
                borderBottom: tab === t ? '1px solid rgba(18,12,4,0.98)' : '1px solid transparent',
                borderRadius: '6px 6px 0 0',
                color: tab === t ? '#e0c070' : '#6a5838',
                cursor: 'pointer', fontSize: 11, letterSpacing: 3,
                textTransform: 'uppercase', fontFamily: 'Georgia, serif',
                marginBottom: -1,
              }}>
                {t}
              </button>
            ))}
          </div>

          <div style={{ padding: isMobile ? '16px 16px 20px' : '24px 32px 28px', overflowY: 'auto', height: isMobile ? '48vh' : '36vh' }}>
            {tab === 'territory' && <TerritoryPanel />}
            {tab === 'buildings' && <BuildingsPanel />}
            {tab === 'military'  && <MilitaryPanel />}
          </div>
        </>
      )}
    </div>
  )
}

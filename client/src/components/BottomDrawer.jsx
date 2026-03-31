import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '../api/client'
import { GoldIcon, ManaIcon } from './Icons'

// ── constants ─────────────────────────────────────────────────────────────────

const BUILDING_DEFS = [
  {
    type: 'mine', label: 'Mine', color: '#c9902a', goldCost: 5, manaCost: 0,
    effect: '+3 gold per harvest',
    desc: 'Extracts gold from the land each harvest cycle. Stack multiple mines on one hex to maximize income from your richest territories.',
  },
  {
    type: 'mana_well', label: 'Mana Well', color: '#3480c8', goldCost: 5, manaCost: 0,
    effect: '+3 mana per harvest',
    desc: 'Taps ley lines beneath the hex to generate mana. Mana is required for advanced buildings and trebuchet training.',
  },
  {
    type: 'barracks', label: 'Barracks', color: '#a84040', goldCost: 10, manaCost: 0,
    effect: 'Enables training · halves train time',
    desc: 'Without a barracks you cannot train troops on this hex. Building one also cuts all training times in half. Only one barracks per hex.',
  },
  {
    type: 'watch_tower', label: 'Watch Tower', color: '#5a9840', goldCost: 5, manaCost: 0,
    effect: '+1 ring of vision',
    desc: 'Extends your sight radius by one extra hex ring from this location, revealing enemy armies and unclaimed land before they reach you.',
  },
  {
    type: 'archer_tower', label: 'Archer Tower', color: '#c05020', goldCost: 10, manaCost: 0,
    effect: '+30% defender strength',
    desc: 'Rains arrows on attackers during any battle fought on this hex. Each tower stacks, making fortified hexes dramatically harder to capture.',
  },
]

const TROOP_DEFS = [
  {
    type: 'knight', label: 'Knights', goldCost: 1, manaCost: 0, time: '6s',
    atk: '1.0', def: '1.0',
    desc: 'Balanced all-rounders. Equal strength attacking and defending. Cheap and fast to train — the backbone of any army.',
  },
  {
    type: 'archer', label: 'Archers', goldCost: 1, manaCost: 0, time: '6s',
    atk: '1.0', def: '1.25',
    desc: 'Cheap ranged troops that excel when defending from fortified positions. 25% combat bonus when garrisoned on a hex under attack.',
  },
  {
    type: 'trebuchet', label: 'Trebuchets', goldCost: 5, manaCost: 0, time: '12s',
    atk: '1.5', def: '1.0',
    desc: 'Powerful siege engines with 3× base combat strength and a 50% attack bonus. Slow and expensive but devastating when storming enemy hexes.',
  },
]

const UPGRADE_COST = { gold: 20, mana: 5 }
const UPGRADE_MINUTES = 0.5

// ── small utilities ───────────────────────────────────────────────────────────

function Label({ children }) {
  return (
    <div style={{ fontSize: 10, color: '#7a6890', letterSpacing: 3, textTransform: 'uppercase', marginBottom: 10 }}>
      {children}
    </div>
  )
}

function Dot({ color }) {
  return <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }} />
}

function Btn({ onClick, children, disabled, danger, muted }) {
  const bg = danger ? 'rgba(140,30,30,0.25)' : muted ? 'rgba(255,255,255,0.03)' : 'rgba(80,50,160,0.22)'
  const border = danger ? 'rgba(180,50,50,0.35)' : muted ? 'rgba(255,255,255,0.07)' : 'rgba(120,80,200,0.35)'
  const color = danger ? '#c08080' : muted ? '#7a6890' : '#c4b498'
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
  const isOwn    = !!(player && hex?.username === player.username)
  const isClaimed = !!hex?.owner
  const tabs = isOwn ? ['territory', 'buildings', 'military'] : ['territory']

  const [tab, setTab] = useState('territory')
  const [buildingData, setBuildingData] = useState(null)
  const [military, setMilitary] = useState(null)
  const [trainQty, setTrainQty] = useState(10)
  const [dispatching, setDispatching] = useState(false)
  const [dispatchQty, setDispatchQty] = useState({ knight: 0, archer: 0, trebuchet: 0 })
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
    if (!buildingData?.buildings) return { gold: 1, mana: 0 }
    let gold = 1, mana = 0
    for (const b of buildingData.buildings) {
      if (b.type === 'mine') gold += 3
      else if (b.type === 'mana_well') mana += 3
    }
    return { gold, mana }
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

  function openDispatch() {
    // Default to sending everything available
    setDispatchQty({
      knight:    troopMap.knight    || 0,
      archer:    troopMap.archer    || 0,
      trebuchet: troopMap.trebuchet || 0,
    })
    setDispatching(true)
  }

  function handleDispatch() {
    const hasAny = Object.values(dispatchQty).some(n => n > 0)
    if (!hasAny) return
    onMarchStart?.(hex.h3, dispatchQty)
    setDispatching(false)
  }

  // ── tab panels ───────────────────────────────────────────────

  function TerritoryPanel() {
    return (
      <div style={{ display: 'flex', gap: 48 }}>
        <div style={{ flex: 1 }}>
          <Label>Hex</Label>
          <div style={{ marginBottom: 14 }}>
            {isClaimed
              ? <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Dot color={hex.color} />
                  <span style={{ fontSize: 18, color: '#d4c498' }}>{hex.username}</span>
                </div>
              : <span style={{ fontSize: 15, color: '#4a3a58' }}>Unclaimed Wildlands</span>
            }
          </div>
          {isClaimed && (
            <div style={{ display: 'flex', gap: 16, fontSize: 14, alignItems: 'center' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#c9902a' }}>
                <GoldIcon size={13} /> +{income.gold} next harvest
              </span>
              {income.mana > 0 && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#3480c8' }}>
                  <ManaIcon size={13} /> +{income.mana} next harvest
                </span>
              )}
            </div>
          )}
        </div>
        <div style={{ flex: 1 }}>
          {isClaimed && Object.entries(troopMap).filter(([,n]) => n > 0).length > 0 && (
            <>
              <Label>Garrison</Label>
              <div style={{ display: 'flex', gap: 20, fontSize: 15, color: '#a090c0' }}>
                {Object.entries(troopMap).filter(([,n]) => n > 0).map(([type, n]) => (
                  <span key={type}>{n} {type}s</span>
                ))}
              </div>
            </>
          )}
          {!isClaimed && (
            <div style={{ paddingTop: 6 }}>
              {!player
                ? <Btn onClick={onLoginRequired} muted>Login to Claim</Btn>
                : <Btn onClick={() => onClaim(hex.h3)}>Claim Territory</Btn>
              }
            </div>
          )}
        </div>
      </div>
    )
  }

  function BuildingsPanel() {
    if (!isOwn) return null
    const buildable = buildingData
      ? BUILDING_DEFS.filter(b => b.type !== 'barracks' || !buildingData.buildings.some(x => x.type === 'barracks'))
      : []
    const slotsLeft = buildingData ? buildingData.slots - buildingData.usedSlots : 0

    return (
      <div style={{ display: 'flex', gap: 48 }}>
        {/* Built */}
        <div style={{ flex: 1 }}>
          <Label>Built — {buildingData?.usedSlots ?? 0} / {buildingData?.slots ?? '?'} slots used</Label>
          {builtGroups.length === 0 && (
            <div style={{ fontSize: 13, color: '#6a5878' }}>No buildings constructed yet.</div>
          )}
          {builtGroups.map(g => {
            const def = BUILDING_DEFS.find(d => d.type === g.type)
            return (
              <div key={g.type} style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Dot color={def?.color || '#888'} />
                  <span style={{ fontSize: 14, color: '#c4b498', flex: 1 }}>
                    {def?.label}
                    {g.ids.length > 1 && <span style={{ color: '#8070a0', marginLeft: 6 }}>×{g.ids.length}</span>}
                    {g.pending && <span style={{ color: '#7a6890', marginLeft: 6, fontSize: 12 }}>building…</span>}
                  </span>
                  <span style={{ fontSize: 11, color: '#8070a0' }}>{def?.effect}</span>
                  {!g.pending && (
                    <button onClick={() => handleDemolish(g.ids[g.ids.length - 1])} disabled={busy}
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

        {/* Build + Upgrade */}
        <div style={{ flex: 1 }}>
          {buildingData && slotsLeft > 0 && (
            <>
              <Label>Build · {slotsLeft} slot{slotsLeft !== 1 ? 's' : ''} free</Label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 18 }}>
                {buildable.map(b => (
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
                          {b.manaCost > 0 && <><ManaIcon size={10} style={{ marginLeft: 4 }} /> {b.manaCost}</>}
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
          {buildingData && slotsLeft === 0 && (
            <div style={{ fontSize: 12, color: '#6a5878', marginBottom: 14 }}>
              All building slots are filled. Upgrade this hex to unlock more slots.
            </div>
          )}
          {buildingData && (
            <>
              <Label>Hex Level {buildingData.upgradeLevel} / {buildingData.maxUpgradeLevel}</Label>
              <div style={{ fontSize: 11, color: '#6a5878', marginBottom: 8, lineHeight: 1.5 }}>
                Upgrading a hex expands its building capacity by 2 slots, letting you stack more mines, towers, or wells on prime territory.
              </div>
              {buildingData.upgrading
                ? <UpgradeBar completes_at={buildingData.upgrading.completes_at} onExpire={loadBuildings} />
                : buildingData.upgradeLevel < buildingData.maxUpgradeLevel
                  ? <Btn onClick={handleUpgrade} disabled={busy}>
                      Upgrade — <GoldIcon size={11} /> {UPGRADE_COST.gold} <ManaIcon size={11} /> {UPGRADE_COST.mana} · +2 slots
                    </Btn>
                  : <span style={{ fontSize: 12, color: '#6a5878' }}>Max level reached — no further upgrades available.</span>
              }
            </>
          )}
        </div>
      </div>
    )
  }

  const TRAIN_PRESETS = [1, 2, 5, 10, 25, 50, 100]
  const DISPATCH_PRESETS = [1, 5, 10, 25, 50, 100]

  function MilitaryPanel() {
    if (!isOwn) return null
    const totalReady = Object.values(troopMap).reduce((s, n) => s + n, 0)

    return (
      <div style={{ display: 'flex', gap: 48 }}>

        {/* Left: garrison + dispatch */}
        <div style={{ flex: 1 }}>
          <Label>Garrison</Label>
          {TROOP_DEFS.map(t => (
            <div key={t.type} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <span style={{ fontSize: 14, color: '#c4b498', flex: 1 }}>{t.label}</span>
              <span style={{ fontSize: 16, color: (troopMap[t.type] || 0) > 0 ? '#a090c0' : '#6a5878', minWidth: 36, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {troopMap[t.type] || 0}
              </span>
            </div>
          ))}

          {/* Dispatch allocator */}
          {dispatching ? (
            <div style={{ marginTop: 14, padding: '12px 14px', background: 'rgba(80,40,140,0.12)', border: '1px solid rgba(120,80,200,0.2)', borderRadius: 6 }}>
              <Label>Select how many to send</Label>
              {TROOP_DEFS.map(t => {
                const have = troopMap[t.type] || 0
                const sending = dispatchQty[t.type] || 0
                return (
                  <div key={t.type} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                      <span style={{ fontSize: 13, color: '#8070a0' }}>{t.label}</span>
                      <span style={{ fontSize: 12, color: sending > 0 ? '#c4b498' : '#6a5878' }}>
                        {sending} <span style={{ color: '#6a5878' }}>/ {have}</span>
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      <button
                        onClick={() => setDispatchQty(prev => ({ ...prev, [t.type]: 0 }))}
                        disabled={have === 0}
                        style={{
                          padding: '3px 8px', borderRadius: 3, fontSize: 11, fontFamily: 'Georgia, serif',
                          cursor: have === 0 ? 'default' : 'pointer',
                          background: sending === 0 ? 'rgba(120,80,200,0.25)' : 'rgba(255,255,255,0.04)',
                          border: `1px solid ${sending === 0 ? 'rgba(120,80,200,0.5)' : 'rgba(255,255,255,0.09)'}`,
                          color: sending === 0 ? '#c4b498' : '#7a6890',
                        }}>0</button>
                      {DISPATCH_PRESETS.map(n => (
                        <button key={n}
                          onClick={() => setDispatchQty(prev => ({ ...prev, [t.type]: Math.min(have, n) }))}
                          disabled={have === 0}
                          style={{
                            padding: '3px 8px', borderRadius: 3, fontSize: 11, fontFamily: 'Georgia, serif',
                            cursor: have === 0 ? 'default' : 'pointer',
                            background: sending === Math.min(have, n) && sending !== 0 ? 'rgba(120,80,200,0.25)' : 'rgba(255,255,255,0.04)',
                            border: `1px solid ${sending === Math.min(have, n) && sending !== 0 ? 'rgba(120,80,200,0.5)' : 'rgba(255,255,255,0.09)'}`,
                            color: have >= n ? '#c4b498' : '#7a6890',
                            opacity: have === 0 ? 0.4 : 1,
                          }}>{n}</button>
                      ))}
                      <button
                        onClick={() => setDispatchQty(prev => ({ ...prev, [t.type]: have }))}
                        disabled={have === 0}
                        style={{
                          padding: '3px 8px', borderRadius: 3, fontSize: 11, fontFamily: 'Georgia, serif',
                          cursor: have === 0 ? 'default' : 'pointer',
                          background: sending === have && have > 0 ? 'rgba(120,80,200,0.25)' : 'rgba(255,255,255,0.04)',
                          border: `1px solid ${sending === have && have > 0 ? 'rgba(120,80,200,0.5)' : 'rgba(255,255,255,0.09)'}`,
                          color: have > 0 ? '#c4b498' : '#7a6890',
                          opacity: have === 0 ? 0.4 : 1,
                        }}>All</button>
                    </div>
                  </div>
                )
              })}
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <Btn onClick={() => setDispatching(false)} muted>Cancel</Btn>
                <Btn onClick={handleDispatch} disabled={!Object.values(dispatchQty).some(n => n > 0)}>
                  Select Target on Map →
                </Btn>
              </div>
            </div>
          ) : totalReady > 0 && (
            <div style={{ marginTop: 12 }}>
              <Btn onClick={openDispatch} danger>Dispatch Army</Btn>
            </div>
          )}
        </div>

        {/* Right: train + queues */}
        <div style={{ flex: 1 }}>
          <Label>Train</Label>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 14 }}>
            {TRAIN_PRESETS.map(n => (
              <button key={n} onClick={() => setTrainQty(n)} style={{
                padding: '4px 10px', borderRadius: 3, fontSize: 12, fontFamily: 'Georgia, serif', cursor: 'pointer',
                background: trainQty === n ? 'rgba(120,80,200,0.3)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${trainQty === n ? 'rgba(120,80,200,0.6)' : 'rgba(255,255,255,0.09)'}`,
                color: trainQty === n ? '#d4c8f0' : '#6a5880',
              }}>{n}</button>
            ))}
          </div>
          {TROOP_DEFS.map(t => (
            <div key={t.type} style={{ marginBottom: 12, padding: '8px 10px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 14, color: '#c4b498', flex: 1 }}>{t.label}</span>
                <span style={{ fontSize: 11, color: '#7a6890' }}>
                  atk {t.atk} · def {t.def}
                </span>
                <span style={{ fontSize: 11, color: '#6a5878', display: 'flex', alignItems: 'center', gap: 3 }}>
                  <GoldIcon size={10} />{t.goldCost} · {t.time}
                </span>
                <Btn onClick={() => handleTrain(t.type)} disabled={busy}>
                  Train {trainQty}
                </Btn>
              </div>
              <div style={{ fontSize: 11, color: '#6a5878', lineHeight: 1.4 }}>{t.desc}</div>
            </div>
          ))}

          {military?.training?.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <Label>Training Queue</Label>
              {military.training.map(j => <TrainBar key={j.id} job={j} />)}
            </div>
          )}
          {military?.armies?.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <Label>Marching</Label>
              {military.armies.map(a => {
                const pct = Math.min(100, ((Date.now() - new Date(a.departed_at)) / (new Date(a.arrives_at) - new Date(a.departed_at))) * 100)
                const mins = Math.max(0, Math.ceil((new Date(a.arrives_at) - Date.now()) / 60000))
                return (
                  <div key={a.id} style={{ marginBottom: 9 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#6a5878', marginBottom: 3 }}>
                      <span>{a.quantity} {a.type}s</span>
                      <span>{mins}m remaining</span>
                    </div>
                    <ProgressBar pct={pct} color="linear-gradient(90deg, #802020, #c04040)" />
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── render ───────────────────────────────────────────────────

  return (
    <div style={{
      position: 'absolute', bottom: 0, left: 0, right: 0,
      background: 'rgba(5,3,14,0.97)',
      borderTop: '1px solid rgba(100,70,30,0.5)',
      fontFamily: 'Georgia, serif',
      color: '#c4b498',
      zIndex: 20,
    }}>
      {/* Tab bar */}
      <div style={{
        display: 'flex', alignItems: 'stretch',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
      }}>
        {tabs.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '11px 22px', background: 'none', border: 'none',
            borderBottom: tab === t ? '2px solid #c9902a' : '2px solid transparent',
            color: tab === t ? '#d4c498' : '#7a6890',
            cursor: 'pointer', fontSize: 11, letterSpacing: 3,
            textTransform: 'uppercase', fontFamily: 'Georgia, serif',
          }}>
            {t}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: '#2a1a38', alignSelf: 'center', marginRight: 12 }}>{hex.h3}</span>
        <button onClick={onClose} style={{
          padding: '0 18px', background: 'none', border: 'none',
          color: '#7a6890', cursor: 'pointer', fontSize: 22,
        }}>×</button>
      </div>

      {/* Content */}
      <div style={{ padding: '18px 32px 20px', overflowY: 'auto', maxHeight: '36vh' }}>
        {tab === 'territory' && <TerritoryPanel />}
        {tab === 'buildings' && <BuildingsPanel />}
        {tab === 'military'  && <MilitaryPanel />}
      </div>
    </div>
  )
}

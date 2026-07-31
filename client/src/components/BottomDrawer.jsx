import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '../api/client'
import { GoldIcon, PickaxeIcon, SwordsIcon, ShieldIcon, GearIcon } from './Icons'
import { MineArt, BarracksArt, FortArt, BuildingIcon } from './BuildingArt'
import { useIsMobile } from '../hooks/useIsMobile'
import { useSocket } from '../hooks/useSocket'
import { toast } from '../toastBus'
import { resolveFlag, drawFlagToCanvas } from '../flags'
import { shortHex } from '../text'
import Tooltip from './Tooltip'

function CapitalFlag({ hex, size = 40 }) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current) drawFlagToCanvas(resolveFlag({ flag_pixels: hex.flag_pixels, username: hex.username }), ref.current, size / 16)
  }, [hex.flag_pixels, hex.username, size])
  return <canvas ref={ref} style={{ width: size, height: size, imageRendering: 'pixelated', borderRadius: 3, border: '1px solid rgba(160,110,30,0.35)', flexShrink: 0 }} />
}

const PULSE_CSS = `
@keyframes goldPulse {
  0%   { opacity: 1; transform: scale(1); }
  50%  { opacity: 0.6; transform: scale(1.15); }
  100% { opacity: 1; transform: scale(1); }
}
@keyframes tickFill {
  from { width: 0% }
  to   { width: 100% }
}
`

// ── constants ─────────────────────────────────────────────────────────────────

const BUILDING_DEFS = [
  {
    type: 'mine', label: 'Mine', color: '#c9902a', goldCost: 5,
    effect: '+3 gold per tick',
    desc: 'Extracts gold from the land each resource tick. Stack multiple mines on one hex to maximize income from your richest territories.',
  },
  {
    type: 'barracks', label: 'Barracks', color: '#a84040', goldCost: 10,
    effect: '10× faster troop training',
    desc: 'Troops train 10× faster on a hex with a barracks. Only one barracks per hex.',
  },
  {
    type: 'fort', label: 'Fort', color: '#5a9840', goldCost: 10,
    effect: '+3 defenders roll with advantage',
    desc: "A fortified position: when this hex is attacked, up to 3 of your defenders roll two dice and keep the higher (instead of one) each clash. Stacks with entrenchment (compact borders) and strategic hexes, up to 5 advantaged defenders total.",
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
    <div style={{ fontSize: 14, color: '#9a8060', letterSpacing: 3, textTransform: 'uppercase', marginBottom: 10 }}>
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
      fontSize: 14, letterSpacing: 1, fontFamily: 'Georgia, serif',
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
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 4 }}>
        <span style={{ color: '#a090c0' }}>{job.type}s</span>
        <span style={{ color: '#8070a0' }} ref={labelRef} />
      </div>
      <div style={{ height: 3, background: 'rgba(255,255,255,0.07)', borderRadius: 2, overflow: 'hidden' }}>
        <div ref={barRef} style={{ width: '0%', height: '100%', borderRadius: 2, background: 'linear-gradient(90deg, #5030a0, #8060d0)' }} />
      </div>
    </div>
  )
}

function BuildBar({ building, buildTimeSecs, onExpire }) {
  const barRef   = useRef(null)
  const labelRef = useRef(null)

  useEffect(() => {
    const start = new Date(building.created_at).getTime()
    const end   = start + buildTimeSecs * 1000

    function tick() {
      const now       = Date.now()
      const pct       = Math.min(100, ((now - start) / (end - start)) * 100)
      const remaining = Math.max(0, Math.ceil((end - now) / 1000))
      if (barRef.current)   barRef.current.style.width = `${pct}%`
      if (labelRef.current) {
        const m = Math.floor(remaining / 60), s = remaining % 60
        labelRef.current.textContent = m > 0 ? `${m}m ${String(s).padStart(2,'0')}s` : `${s}s`
      }
      if (remaining === 0) onExpire?.()
    }

    let raf
    function loop() { tick(); raf = requestAnimationFrame(loop) }
    loop()
    return () => cancelAnimationFrame(raf)
  }, [building.created_at, buildTimeSecs, onExpire])

  const def = BUILDING_DEFS.find(d => d.type === building.type)
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 4 }}>
        <span style={{ color: '#a090c0' }}>
          {def?.label || building.type}
          <span style={{ color: '#6a5878', marginLeft: 6 }}>under construction</span>
        </span>
        <span style={{ color: '#8070a0' }} ref={labelRef} />
      </div>
      <div style={{ height: 3, background: 'rgba(255,255,255,0.07)', borderRadius: 2, overflow: 'hidden' }}>
        <div ref={barRef} style={{ width: '0%', height: '100%', borderRadius: 2, background: 'linear-gradient(90deg, #304070, #5080c0)' }} />
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
      <div style={{ fontSize: 14, color: '#8070a8', marginBottom: 4 }}>
        Upgrading - {secs > 0 ? `${secs}s remaining` : 'Complete…'}
      </div>
      <ProgressBar pct={pct} color="linear-gradient(90deg, #5030c0, #9060f0)" />
    </div>
  )
}

// ── main component ────────────────────────────────────────────────────────────

export default function BottomDrawer({ hex, player, stats, onClaim, onSetCapital, onLoginRequired, onBuild, onPlayerUpdate, onMarchStart, onSetRallyMode, onStatsRefresh, getFriendlyNeighborCount, ownedHexCount }) {
  const isMobile = useIsMobile()
  const isOwn    = !!(player && hex?.username === player.username)
  const isClaimed = !!hex?.owner
  const isFogged = !isOwn && !!hex?.fog
  const tabs = isOwn ? ['territory', 'buildings', 'military'] : ['territory']

  const [tab, setTab] = useState('territory')
  const [buildingData, setBuildingData] = useState(null)
  const [military, setMilitary] = useState(null)
  const [trainQty, setTrainQty] = useState(10)
  const [dispatchQty, setDispatchQty] = useState({ troop: 0 })
  const [busy, setBusy] = useState(false)
  const [troopGoldCost, setTroopGoldCost] = useState(1)
  const [buildingCosts, setBuildingCosts] = useState({})
  // Formula constants for the defense breakdown and decay/claim rules below -
  // fetched once here (same request that already grabs troop/building costs)
  // rather than a per-hex-click API call, since the only per-hex inputs
  // (forts, friendly neighbors, strategic, hex count) are already available
  // from data loaded elsewhere.
  const [gameConfig, setGameConfig] = useState({
    fort_advantage_troops: 3, entrench_advantage_per_neighbor: 1,
    entrench_max_neighbors: 4, strategic_advantage_troops: 2, max_advantaged_defenders: 5,
    min_troops_to_claim: 5, decay_hex_threshold: 30, decay_scale_hexes_per_step: 10,
  })

  useEffect(() => {
    api.getConfig().then(cfg => {
      if (cfg.troop_gold_cost) setTroopGoldCost(cfg.troop_gold_cost)
      if (cfg.building_costs) setBuildingCosts(cfg.building_costs)
      setGameConfig(prev => ({ ...prev, ...cfg }))
    }).catch(() => {})
  }, [])

  // Only force back to Territory when the new hex doesn't have the other
  // tabs at all (an enemy/unclaimed hex) - switching between your own hexes
  // keeps whichever tab you were on instead of always bouncing to Territory.
  useEffect(() => { if (!isOwn) setTab('territory') }, [hex?.h3, isOwn])

  const loadBuildings = useCallback(() => {
    if (!isClaimed || !hex?.h3 || isFogged) return
    api.getBuildings(hex.h3).then(setBuildingData).catch(() => {})
  }, [hex?.h3, isClaimed, isFogged])

  // getMilitary is owner-scoped (your troops/training/armies at this hex) - it
  // always comes back empty for a hex you don't own, so it can only tell you
  // about your own territory, never an enemy's garrison.
  const loadMilitary = useCallback(() => {
    if (!isOwn || !hex?.h3) return
    api.getMilitary(hex.h3).then(setMilitary).catch(() => {})
  }, [isOwn, hex?.h3])

  useEffect(() => {
    setBuildingData(null)
    setMilitary(null)
    if (!hex?.h3) return
    loadBuildings()
    loadMilitary()
  }, [hex?.h3, loadBuildings, loadMilitary])
  useSocket({ 'armies:update': loadMilitary, tick: loadMilitary })

  useEffect(() => {
    if (!buildingData?.upgrading?.completes_at) return
    const ms = new Date(buildingData.upgrading.completes_at) - Date.now()
    if (ms <= 0) { loadBuildings(); return }
    const t = setTimeout(loadBuildings, ms + 500)
    return () => clearTimeout(t)
  }, [buildingData?.upgrading?.completes_at, loadBuildings])

  // Tick progress bar (used by the territory panel)
  const [tickPct, setTickPct] = useState(0)
  const [tickSecs, setTickSecs] = useState(null)
  useEffect(() => {
    if (!stats?.next_tick_at || !stats?.tick_interval_ms) return
    let retry = null
    function update() {
      const now = Date.now()
      const end = new Date(stats.next_tick_at).getTime()
      const interval = stats.tick_interval_ms
      const elapsed = interval - Math.max(0, end - now)
      setTickPct(Math.min(100, (elapsed / interval) * 100))
      const secsLeft = Math.max(0, Math.ceil((end - now) / 1000))
      setTickSecs(secsLeft)
      // Same clock-skew/latency guard as the map's harvest countdown - don't
      // just sit at 0, keep asking the server until it actually has a new tick.
      if (secsLeft === 0 && !retry && onStatsRefresh) {
        retry = setInterval(onStatsRefresh, 2000)
      }
    }
    update()
    const id = setInterval(update, 500)
    return () => { clearInterval(id); clearInterval(retry) }
  }, [stats?.next_tick_at, stats?.tick_interval_ms, onStatsRefresh])

  // ── derived data ─────────────────────────────────────────────

  const income = (() => {
    if (!buildingData?.buildings) return { gold: 1 }
    let gold = 1
    // Mirrors tick.js's actual payout query: a mine only counts once its build
    // time has elapsed, so a pending mine shouldn't inflate the shown rate.
    for (const b of buildingData.buildings) {
      if (b.type === 'mine' && b.is_complete) gold += 3
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
      toast(err.message)
    } finally { setBusy(false) }
  }

  async function handleDemolish(id) {
    setBusy(true)
    try { await api.demolish(id); loadBuildings() }
    catch (err) { toast(err.message) }
    finally { setBusy(false) }
  }

  async function handleTrain(type) {
    const qty = trainQty
    setBusy(true)
    try {
      const r = await api.trainTroops(hex.h3, type, qty)
      onPlayerUpdate?.(r.player)
      loadMilitary()
    } catch (err) { toast(err.message) }
    finally { setBusy(false) }
  }

  function handleDispatch() {
    const ready = troopMap.troop || 0
    const qty = dispatchQty.troop || ready  // default to all if no preset selected
    if (qty <= 0) return
    onMarchStart?.(hex.h3, { troop: qty })
  }

  // ── tab panels ───────────────────────────────────────────────

  function TerritoryPanel() {
    const inZone = !!hex.zone_city
    const ZONE_BONUS = hex.zone_bonus ?? 2 // server value from click enrichment; 2 = fallback
    const troops = Object.entries(troopMap).filter(([, n]) => n > 0)
    // For your own hex, the per-type breakdown from getMilitary is the source
    // of truth. For anyone else's, that endpoint never has their troops (it's
    // owner-scoped) - use the hex's own troop_count instead, which already
    // respects fog of war (-1 = hidden) and power projection.
    const enemyTroopCount = hex.troop_count ?? 0
    const isHiddenGarrison = !isOwn && enemyTroopCount === -1
    const totalTroops = isOwn ? troops.reduce((s, [, n]) => s + n, 0) : Math.max(0, enemyTroopCount)
    const totalIncome = income.gold + (hex.strategic_bonus || 0) + (inZone ? ZONE_BONUS : 0)
    const completedMines = buildingData?.buildings?.filter(b => b.type === 'mine' && b.is_complete).length || 0
    const pendingMines = buildingData?.buildings?.filter(b => b.type === 'mine' && !b.is_complete).length || 0
    const incomeTooltip = [
      'Base: +1',
      completedMines > 0 && `Mine${completedMines > 1 ? ` ×${completedMines}` : ''}: +${completedMines * 3}`,
      hex.strategic_bonus > 0 && `Strategic hex: +${hex.strategic_bonus}`,
      inZone && `${hex.zone_city} zone: +${ZONE_BONUS}`,
      pendingMines > 0 && `${pendingMines} mine${pendingMines > 1 ? 's' : ''} still under construction - not counted yet`,
    ].filter(Boolean).join('\n')

    // Defense breakdown, computed entirely from data already loaded (building
    // list, strategic flag, and a neighbor lookup against the map's own hex
    // cache) - no dedicated network round-trip per hex click. Mirrors
    // combat.js's advantagedDefenderCount() formula exactly; if that formula
    // changes, this needs to change with it.
    const activeForts = buildingData?.buildings?.filter(b => b.type === 'fort' && b.is_complete).length || 0
    const friendlyNeighbors = getFriendlyNeighborCount?.(hex.h3, hex.owner) || 0
    const isStrategicHex = !!hex.strategic_name
    const fortAdvantage = activeForts * gameConfig.fort_advantage_troops
    const entrenchAdvantage = Math.min(friendlyNeighbors, gameConfig.entrench_max_neighbors) * gameConfig.entrench_advantage_per_neighbor
    const strategicAdvantage = isStrategicHex ? gameConfig.strategic_advantage_troops : 0
    const rawAdvantageTotal = fortAdvantage + entrenchAdvantage + strategicAdvantage
    const advantagedDefenders = Math.min(gameConfig.max_advantaged_defenders, rawAdvantageTotal)
    const advantageCapped = rawAdvantageTotal > advantagedDefenders
    const hasFortBonus = advantagedDefenders > 0
    // Plain-text breakdown for a native hover tooltip - keeps the card itself
    // a clean single number (like Garrison), with the "why" one hover away.
    const defenseTooltip = [
      activeForts > 0 && `Fort${activeForts > 1 ? ` ×${activeForts}` : ''}: +${fortAdvantage}`,
      friendlyNeighbors > 0 && `${friendlyNeighbors} friendly neighbor${friendlyNeighbors > 1 ? 's' : ''}: +${entrenchAdvantage}`,
      isStrategicHex && `Strategic hex: +${strategicAdvantage}`,
      advantageCapped && `${rawAdvantageTotal} total, capped at ${gameConfig.max_advantaged_defenders}`,
    ].filter(Boolean).join('\n')

    // Decay risk: the required garrison rises with total owned hex count -
    // mirrors config.js's requiredGarrisonForHexCount() exactly.
    const requiredGarrison = ownedHexCount > gameConfig.decay_hex_threshold
      ? 1 + Math.floor((ownedHexCount - gameConfig.decay_hex_threshold) / gameConfig.decay_scale_hexes_per_step)
      : 0
    const isUndeveloped = !buildingData?.buildings?.length
    const isCapitalHex = hex.capital_hex === hex.h3
    const isBorderHex = friendlyNeighbors < 6 // fully-surrounded interior hexes never decay
    const atDecayRisk = isOwn && !isCapitalHex && isUndeveloped && isBorderHex && requiredGarrison > 0 && totalTroops < requiredGarrison

    const hasBarracks = buildingData?.buildings?.some(b => b.type === 'barracks')

    // Estimated total gold generated - segments by when each building was actually built
    const tickInterval = stats?.tick_interval_ms || 600000
    const buildTimeSecs = buildingData?.build_time_seconds || 300
    const totalGenerated = (() => {
      if (!hex.claimed_at) return null
      const now = Date.now()
      const claimedAt = new Date(hex.claimed_at).getTime()
      const ticksHeld = Math.floor((now - claimedAt) / tickInterval)
      if (ticksHeld < 1) return null

      // Base: 1g/tick for all ticks held
      let total = ticksHeld

      // Strategic bonus: applies for all ticks held
      if (hex.strategic_bonus) total += ticksHeld * hex.strategic_bonus

      // City-zone bonus: applies for all ticks held
      if (inZone) total += ticksHeld * ZONE_BONUS

      // Mines: only count from when each mine became active (created_at + build time)
      if (buildingData?.buildings) {
        for (const b of buildingData.buildings) {
          if (b.type !== 'mine') continue
          const activeAt = new Date(b.created_at).getTime() + buildTimeSecs * 1000
          const ticksWithMine = Math.max(0, Math.floor((now - activeAt) / tickInterval))
          total += ticksWithMine * 3
        }
      }

      return total
    })()

    if (isClaimed && isFogged) return (
      <div style={{ fontSize: 14, color: '#6a5838', lineHeight: 1.8 }}>
        Outside your field of vision - expand your territory to reveal this hex.<br />
        <span style={{ color: '#5a4828' }}>Troops and income hidden.</span>
      </div>
    )

    if (!isClaimed) return (
      <div style={{ maxWidth: 360 }}>
        {!player ? (
          <>
            <div style={{ fontSize: 14, color: '#5a4828', marginBottom: 12 }}>Login to start your empire here.</div>
            <Btn onClick={onLoginRequired} muted>Login to Claim</Btn>
          </>
        ) : !player.capital_hex && !ownedHexCount ? (
          // Truly starting from nothing (new player, or fully wiped out) -
          // the one case that's still free and march-free. See routes/hexes.js.
          <>
            <div style={{ fontSize: 14, color: '#7a6040', marginBottom: 12 }}>
              Claim this hex to found your capital. You'll receive starting troops and a free mine.
            </div>
            <Btn onClick={() => onClaim(hex.h3)}>Found Your Capital Here</Btn>
          </>
        ) : !player.capital_hex ? (
          // Capital was destroyed but other territory survived - re-founding
          // costs the same as any claim now, no second round of starter gifts.
          <>
            <div style={{ fontSize: 14, color: '#5a4828', marginBottom: 12 }}>
              March at least {gameConfig.min_troops_to_claim} troops here first, then claim it to found your new capital.
            </div>
            <Btn onClick={() => onClaim(hex.h3)} muted>Found New Capital Here</Btn>
          </>
        ) : (
          <>
            <div style={{ fontSize: 14, color: '#5a4828', marginBottom: 12 }}>
              March at least {gameConfig.min_troops_to_claim} troops here first, then claim it to expand your empire.
            </div>
            <Btn onClick={() => onClaim(hex.h3)} muted>Claim Territory</Btn>
          </>
        )}
      </div>
    )

    return (
      <>
        <style>{PULSE_CSS}</style>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {hex.strategic_name && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 14px',
              background: 'rgba(200,150,30,0.1)',
              border: '1px solid rgba(200,150,30,0.3)',
              borderRadius: 5,
            }}>
              <span style={{ fontSize: 18 }}>{hex.strategic_primary ? '★★' : '★'}</span>
              <div>
                <div style={{ fontSize: 14, color: '#f0d070', letterSpacing: 1 }}>{hex.strategic_name}</div>
                <div style={{ fontSize: 13, color: '#9a7840' }}>
                  +{hex.strategic_bonus}g per tick · +20% defense
                  {hex.strategic_primary && <span style={{ color: '#c9a040' }}> · national capital</span>}
                </div>
              </div>
            </div>
          )}

          {/* City-zone banner - what the gold border on the map means */}
          {inZone && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 14px',
              background: 'rgba(224,184,74,0.08)',
              border: '1px solid rgba(224,184,74,0.28)',
              borderRadius: 5,
            }}>
              <span style={{ fontSize: 16, color: '#e0b84a' }}>◇</span>
              <div>
                <div style={{ fontSize: 14, color: '#e0c878', letterSpacing: 1 }}>{hex.zone_city} Zone</div>
                <div style={{ fontSize: 13, color: '#9a7840' }}>
                  <span style={{ color: '#c9a040' }}>+{ZONE_BONUS}g per tick</span> while you hold this hex
                </div>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <Tooltip text={incomeTooltip} style={{ flex: 1 }}>
              <div style={{
                padding: '14px 16px', cursor: 'help',
                background: 'rgba(160,100,20,0.12)',
                border: '1px solid rgba(200,140,30,0.25)',
                borderRadius: 6,
              }}>
                <div style={{ fontSize: 11, color: '#9a7040', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 6 }}>Income</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ animation: 'goldPulse 2.5s ease-in-out infinite' }}>
                    <GoldIcon size={18} />
                  </span>
                  <span style={{ fontSize: 26, color: '#d4a030', fontVariantNumeric: 'tabular-nums' }}>+{totalIncome}</span>
                </div>
                <div style={{ fontSize: 12, color: '#7a6040', marginTop: 2 }}>per tick</div>
              </div>
            </Tooltip>

            {/* Garrison card - flips to a decay warning when this border hex's
                garrison is below what your current empire size requires */}
            <Tooltip
              style={{ flex: 1 }}
              text={atDecayRisk ? `Empires above ${gameConfig.decay_hex_threshold} hexes need a bigger garrison per hex - yours needs ${requiredGarrison}+ here (or a building) to avoid decay.` : null}
            >
              <div style={{
                padding: '14px 16px', cursor: atDecayRisk ? 'help' : 'default',
                background: atDecayRisk ? 'rgba(140,60,20,0.15)' : totalTroops > 0 ? 'rgba(120,90,20,0.12)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${atDecayRisk ? 'rgba(220,120,40,0.4)' : totalTroops > 0 ? 'rgba(200,170,60,0.2)' : 'rgba(255,255,255,0.06)'}`,
                borderRadius: 6,
              }}>
                <div style={{ fontSize: 11, color: atDecayRisk ? '#c07830' : '#9a7040', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 6 }}>Garrison</div>
                <div style={{ fontSize: 26, color: atDecayRisk ? '#e0a050' : totalTroops > 0 ? '#d4b870' : '#4a3828', fontVariantNumeric: 'tabular-nums' }}>
                  {isHiddenGarrison ? '?' : totalTroops > 0 ? totalTroops : '-'}
                </div>
                <div style={{ fontSize: 12, color: atDecayRisk ? '#c07830' : '#7a6040', marginTop: 2 }}>
                  {isHiddenGarrison ? 'hidden in fog' : atDecayRisk ? `⚠ needs ${requiredGarrison}+` : totalTroops > 0 ? 'troops ready' : 'undefended'}
                </div>
              </div>
            </Tooltip>

            {isOwn && totalGenerated !== null && totalGenerated > 0 && (
              <div style={{
                flex: 1, padding: '14px 16px',
                background: 'rgba(80,60,10,0.1)',
                border: '1px solid rgba(160,120,20,0.2)',
                borderRadius: 6,
              }}>
                <div style={{ fontSize: 11, color: '#9a7040', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 6 }}>All-time</div>
                <div style={{ fontSize: 26, color: '#a08030', fontVariantNumeric: 'tabular-nums' }}>
                  ~{totalGenerated >= 1000 ? `${(totalGenerated / 1000).toFixed(1)}k` : totalGenerated}
                </div>
                <div style={{ fontSize: 12, color: '#7a6040', marginTop: 2 }}>gold generated</div>
              </div>
            )}

            {/* Defense card - a clean single number like Garrison; hover/tap
                to see which sources (fort/entrenchment/strategic) add up to it */}
            {hasFortBonus && (
              <Tooltip text={defenseTooltip} style={{ flex: 1 }}>
                <div style={{
                  padding: '14px 16px', cursor: 'help',
                  background: 'rgba(40,80,40,0.15)',
                  border: '1px solid rgba(60,120,60,0.3)',
                  borderRadius: 6,
                }}>
                  <div style={{ fontSize: 11, color: '#607040', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 6 }}>Defense</div>
                  <div style={{ fontSize: 26, color: '#70b850', fontVariantNumeric: 'tabular-nums' }}>
                    {advantagedDefenders}
                  </div>
                  <div style={{ fontSize: 12, color: '#5a7040', marginTop: 2 }}>w/ advantage</div>
                </div>
              </Tooltip>
            )}
          </div>

          {isOwn && hex.claimed_at && (() => {
            const ms = Date.now() - new Date(hex.claimed_at).getTime()
            const days = Math.floor(ms / 86400000)
            const hrs  = Math.floor((ms % 86400000) / 3600000)
            const label = days > 0 ? `${days}d ${hrs}h` : hrs > 0 ? `${hrs}h` : 'just claimed'
            return (
              <div style={{ fontSize: 12, color: '#5a4838' }}>
                Held for <span style={{ color: '#7a6040' }}>{label}</span>
              </div>
            )
          })()}

          {isOwn && tickSecs !== null && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#6a5838', marginBottom: 4 }}>
                <span>Next income</span>
                <span>{tickSecs}s</span>
              </div>
              <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 2,
                  background: 'linear-gradient(90deg, #8060a0, #c0902a)',
                  width: `${tickPct}%`,
                  transition: 'width 0.5s linear',
                }} />
              </div>
            </div>
          )}

          {buildingData?.buildings?.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {buildingData.buildings.map(b => {
                const def = BUILDING_DEFS.find(d => d.type === b.type)
                return (
                  <div key={b.id} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '5px 10px 5px 6px',
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 6,
                  }}>
                    <BuildingIcon type={b.type} size={20} />
                    <span style={{ fontSize: 13, color: '#c4b498' }}>{def?.label}</span>
                    <span style={{ fontSize: 12, color: '#7a6040' }}>{def?.effect}</span>
                  </div>
                )
              })}
            </div>
          )}

          {isOwn && !player.capital_hex && (
            totalTroops >= gameConfig.min_troops_to_claim ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <Btn onClick={() => onSetCapital?.(hex.h3)}>Found Capital Here</Btn>
                <span style={{ fontSize: 12, color: '#7a6040' }}>Your capital fell - make this hex your new seat of power.</span>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: '#5a4828' }}>
                Your capital fell. Garrison at least {gameConfig.min_troops_to_claim} troops here to found a new one ({totalTroops}/{gameConfig.min_troops_to_claim}).
              </div>
            )
          )}

          {isOwn && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 4, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              {!buildingData?.buildings?.length && (
                <Btn onClick={() => setTab('buildings')}><PickaxeIcon size={13} color="#d4b870" /> Build</Btn>
              )}
              {hasBarracks && (
                <Btn onClick={() => setTab('military')}><SwordsIcon size={13} color="#d4b870" /> Train Troops</Btn>
              )}
              {totalTroops > 0 && (
                <>
                  <Btn onClick={() => onMarchStart?.(hex.h3, { troop: Math.max(1, Math.floor(totalTroops / 2)) })} danger>
                    → March Half ({Math.max(1, Math.floor(totalTroops / 2))})
                  </Btn>
                  <Btn onClick={() => onMarchStart?.(hex.h3, { troop: totalTroops })} danger>
                    → March All ({totalTroops})
                  </Btn>
                  <Btn onClick={() => setTab('military')} muted><GearIcon size={12} /> More</Btn>
                </>
              )}
            </div>
          )}
        </div>
      </>
    )
  }

  function BuildingsPanel() {
    if (!isOwn) return null
    const slots = buildingData?.slots ?? 2
    const usedSlots = buildingData?.usedSlots ?? builtGroups.length
    const slotsLeft = Math.max(0, slots - usedSlots)
    const buildableTypes = buildingData
      ? BUILDING_DEFS.filter(b => !buildingData.buildings.some(x => x.type === b.type))
      : []
    const canBuild = slotsLeft > 0 && buildableTypes.length > 0

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
            <Label>Built</Label>
            <span style={{ fontSize: 12, color: '#5a4868' }}>{usedSlots}/{slots} slots</span>
          </div>
          {builtGroups.length === 0 && (
            <div style={{ fontSize: 14, color: '#6a5878' }}>No building constructed yet.</div>
          )}
          {builtGroups.map(g => {
            const def = BUILDING_DEFS.find(d => d.type === g.type)
            const building = buildingData.buildings.find(b => b.type === g.type)
            const isBuilding = building && !building.is_complete
            const ArtComponent = g.type === 'mine' ? MineArt : g.type === 'barracks' ? BarracksArt : FortArt
            return (
              <div key={g.type} style={{ marginBottom: 10 }}>
                {isBuilding ? (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '8px 12px',
                    background: 'rgba(255,255,255,0.02)',
                    border: '1px solid rgba(255,255,255,0.06)',
                    borderRadius: 6,
                  }}>
                    <div style={{ opacity: 0.4, flexShrink: 0 }}>
                      <ArtComponent size={52} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, color: '#8070a0', marginBottom: 6 }}>
                        {def?.label} - <span style={{ color: '#6a5878' }}>under construction</span>
                      </div>
                      <BuildBar building={building} buildTimeSecs={buildingData.build_time_seconds || 30} onExpire={loadBuildings} />
                    </div>
                  </div>
                ) : (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 14,
                    padding: '10px 14px',
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 8,
                  }}>
                    <ArtComponent size={64} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 15, color: '#d4c4a0', marginBottom: 3 }}>{def?.label}</div>
                      <div style={{ fontSize: 13, color: '#8a7050', marginBottom: 6 }}>{def?.effect}</div>
                      {def?.desc && <div style={{ fontSize: 12, color: '#6a5868', lineHeight: 1.5 }}>{def.desc}</div>}
                    </div>
                    <button onClick={() => handleDemolish(g.ids[0])} disabled={busy}
                      style={{ background: 'none', border: 'none', color: '#7a4848', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '0 4px', flexShrink: 0, alignSelf: 'flex-start' }}>
                      ×
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {canBuild && (
          <div>
            <Label>Build ({slotsLeft} slot{slotsLeft !== 1 ? 's' : ''} left)</Label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {buildableTypes.map(b => {
                const ArtPreview = b.type === 'mine' ? MineArt : b.type === 'barracks' ? BarracksArt : FortArt
                return (
                  <button key={b.type} onClick={() => handleBuild(b.type)} disabled={busy}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left',
                      padding: '10px 14px', background: 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(255,255,255,0.09)', borderRadius: 8,
                      color: '#b4a488', cursor: busy ? 'default' : 'pointer',
                      fontFamily: 'Georgia, serif', width: '100%',
                      transition: 'background 0.1s, border-color 0.1s',
                    }}
                    onMouseEnter={e => { if (!busy) { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.16)' }}}
                    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.09)' }}
                  >
                    <div style={{ opacity: busy ? 0.5 : 1 }}>
                      <ArtPreview size={56} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 15, color: '#d4c4a0', marginBottom: 3, display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span>{b.label}</span>
                        <span style={{ fontSize: 12, color: '#8a7060', display: 'flex', alignItems: 'center', gap: 3 }}>
                          <GoldIcon size={10} /> {buildingCosts[b.type] ?? b.goldCost}
                        </span>
                      </div>
                      <div style={{ fontSize: 13, color: '#7a6840', marginBottom: 5 }}>{b.effect}</div>
                      <div style={{ fontSize: 12, color: '#6a5868', lineHeight: 1.5 }}>{b.desc}</div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}
        {!canBuild && builtGroups.length > 0 && (
          <div style={{ fontSize: 13, color: '#6a5878' }}>All slots filled. Demolish a building to change it.</div>
        )}
      </div>
    )
  }

  const TRAIN_PRESETS = [1, 2, 5, 10, 25, 50, 100]
  const DISPATCH_PRESETS = [1, 5, 10, 25, 50, 100]

  async function handleClearRally() {
    setBusy(true)
    try { await api.clearRally(hex.h3); loadMilitary() }
    catch (err) { toast(err.message) }
    finally { setBusy(false) }
  }

  function MilitaryPanel() {
    if (!isOwn) return null
    const ready = troopMap.troop || 0
    const sendQty = Math.min(dispatchQty.troop || ready, ready)
    const rallyHex = military?.rally_hex || null

    return (
      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 20 : 48 }}>

        {/* Left: garrison + march */}
        <div style={{ flex: 1 }}>
          <Label>Garrison</Label>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 16 }}>
            <span style={{ fontSize: 28, color: ready > 0 ? '#d4b870' : '#6a5848', fontVariantNumeric: 'tabular-nums' }}>{ready}</span>
            <span style={{ fontSize: 14, color: '#9a8060' }}>troops ready</span>
          </div>

          {ready > 0 && (
            <>
              <Label>Send how many</Label>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 12 }}>
                {DISPATCH_PRESETS.map(n => (
                  <button key={n}
                    onClick={() => setDispatchQty({ troop: Math.min(ready, n) })}
                    style={{
                      padding: '4px 10px', borderRadius: 3, fontSize: 14, fontFamily: 'Georgia, serif', cursor: 'pointer',
                      background: sendQty === Math.min(ready, n) ? 'rgba(180,130,30,0.3)' : 'rgba(255,255,255,0.04)',
                      border: `1px solid ${sendQty === Math.min(ready, n) ? 'rgba(200,150,40,0.6)' : 'rgba(255,255,255,0.09)'}`,
                      color: ready >= n ? '#d4b870' : '#6a5848',
                      opacity: ready === 0 ? 0.4 : 1,
                    }}>{n}</button>
                ))}
                <button
                  onClick={() => setDispatchQty({ troop: Math.max(1, Math.floor(ready / 2)) })}
                  style={{
                    padding: '4px 10px', borderRadius: 3, fontSize: 14, fontFamily: 'Georgia, serif', cursor: 'pointer',
                    background: sendQty === Math.max(1, Math.floor(ready / 2)) ? 'rgba(180,130,30,0.3)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${sendQty === Math.max(1, Math.floor(ready / 2)) ? 'rgba(200,150,40,0.6)' : 'rgba(255,255,255,0.09)'}`,
                    color: '#d4b870',
                  }}>Half</button>
                <button
                  onClick={() => setDispatchQty({ troop: ready })}
                  style={{
                    padding: '4px 10px', borderRadius: 3, fontSize: 14, fontFamily: 'Georgia, serif', cursor: 'pointer',
                    background: sendQty === ready ? 'rgba(180,130,30,0.3)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${sendQty === ready ? 'rgba(200,150,40,0.6)' : 'rgba(255,255,255,0.09)'}`,
                    color: '#d4b870',
                  }}>All</button>
              </div>
              <Btn onClick={handleDispatch} danger>
                March {sendQty} troops - select destination
              </Btn>
            </>
          )}

          {ready === 0 && (
            <div style={{ fontSize: 14, color: '#6a5848' }}>
              No troops stationed here. Train some first.
            </div>
          )}

          {military?.armies?.length > 0 && (
            <div style={{ marginTop: 24, paddingTop: 16, paddingBottom: 8, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
              <Label>Marching</Label>
              {military.armies.map(a => {
                const pct = Math.min(100, ((Date.now() - new Date(a.departed_at)) / (new Date(a.arrives_at) - new Date(a.departed_at))) * 100)
                const mins = Math.max(0, Math.ceil((new Date(a.arrives_at) - Date.now()) / 60000))
                return (
                  <div key={a.id} style={{ marginBottom: 16, paddingRight: 4 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: '#9a8060', marginBottom: 6 }}>
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
          <Label>Train Troops · <GoldIcon size={10} /> {troopGoldCost} each</Label>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 12 }}>
            {TRAIN_PRESETS.map(n => (
              <button key={n} onClick={() => setTrainQty(n)} style={{
                padding: '4px 10px', borderRadius: 3, fontSize: 14, fontFamily: 'Georgia, serif', cursor: 'pointer',
                background: trainQty === n ? 'rgba(180,130,30,0.3)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${trainQty === n ? 'rgba(200,150,40,0.6)' : 'rgba(255,255,255,0.09)'}`,
                color: trainQty === n ? '#d4b870' : '#9a8468',
              }}>{n}</button>
            ))}
          </div>
          <Btn onClick={() => handleTrain('troop')} disabled={busy}>
            Train {trainQty}
          </Btn>
          {!buildingData?.buildings?.some(b => b.type === 'barracks') && (
            <div style={{ fontSize: 14, color: '#a3764e', marginTop: 8 }}>
              No Barracks - training here is 10× slower.
            </div>
          )}

          {military?.training?.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <Label>Training Queue</Label>
              {/* Jobs of the same type are chained back-to-back on the server
                  (each new batch starts when the last one finishes), so N
                  clicks means N separate rows for what's really one continuous
                  production line - merge them into a single bar per type
                  instead of showing N redundant ones. */}
              {Object.values(
                military.training.reduce((groups, j) => {
                  (groups[j.type] ??= []).push(j)
                  return groups
                }, {})
              ).map(jobs => {
                const sorted = [...jobs].sort((a, b) => new Date(a.started_at) - new Date(b.started_at))
                const merged = {
                  id: sorted.map(j => j.id).join('-'),
                  type: sorted[0].type,
                  started_at: sorted[0].started_at,
                  completes_at: sorted[sorted.length - 1].completes_at,
                  quantity: sorted.reduce((sum, j) => sum + j.quantity, 0),
                }
                return <TrainBar key={merged.id} job={merged} />
              })}
            </div>
          )}

          <div style={{ marginTop: 16 }}>
            <Label>Rally Point</Label>
            {rallyHex ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span style={{ fontSize: 14, color: '#90b890', fontFamily: 'monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {rallyHex}
                </span>
                <button onClick={handleClearRally} disabled={busy}
                  style={{ background: 'none', border: 'none', color: '#8a5848', cursor: 'pointer', fontSize: 14, padding: 0, lineHeight: 1 }}>×</button>
              </div>
            ) : (
              <div style={{ fontSize: 14, color: '#6a5848', marginBottom: 8 }}>
                Troops stay here after training
              </div>
            )}
            <Btn onClick={() => onSetRallyMode?.(hex.h3)} muted>
              {rallyHex ? 'Change Rally ⌖' : 'Set Rally Point ⌖'}
            </Btn>
          </div>
        </div>
      </div>
    )
  }

  // ── render ───────────────────────────────────────────────────

  const [collapsed, setCollapsed] = useState(false)
  const ownerLabel = isClaimed
    ? hex.username
    : hex.country_name
      ? `Unclaimed · ${hex.country_name}`
      : 'Unclaimed Territory'

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
      paddingBottom: 'env(safe-area-inset-bottom)',
    }}>
      {/* Header - always visible */}
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
          {isClaimed && hex.capital_hex === hex.h3 && <CapitalFlag hex={hex} />}
          {isClaimed && hex.capital_hex !== hex.h3 && <Dot color={hex.color} />}
          <div>
            <span style={{ fontSize: 16, color: isClaimed ? '#e8d090' : '#5a4a28', letterSpacing: 2 }}>
              {ownerLabel}
            </span>
            {isClaimed && (
              <Tooltip
                text={hex.h3}
                style={{ fontSize: 11, color: '#8a7850', marginLeft: 8, fontFamily: 'monospace', letterSpacing: 0.5, opacity: 0.85 }}
              >
                #{shortHex(hex.h3)}
              </Tooltip>
            )}
            {isClaimed && hex.country_name && (
              <div style={{ fontSize: 14, color: '#8a7850', marginTop: 1 }}>
                {hex.country_name}{hex.country_continent ? ` · ${hex.country_continent}` : ''}
              </div>
            )}
            {isClaimed && hex.capital_hex === hex.h3 && hex.motto && (
              <div style={{ fontSize: 14, color: '#d8b868', fontStyle: 'italic', marginTop: 3, lineHeight: 1.3 }}>
                "{hex.motto}"
              </div>
            )}
          </div>
          {hex.capital_hex === hex.h3 && (
            <span style={{ fontSize: 14, color: '#b08030', letterSpacing: 2, textTransform: 'uppercase', border: '1px solid rgba(160,110,30,0.4)', borderRadius: 3, padding: '1px 6px' }}>Capital</span>
          )}
        </div>
        <span style={{ fontSize: 14, color: '#5a4828', userSelect: 'none' }}>{collapsed ? '▲' : '▼'}</span>
      </div>

      {/* Tabs + content - hidden when collapsed */}
      {!collapsed && (
        <>
          <div style={{
            display: 'flex', alignItems: 'flex-end', gap: 2,
            padding: isMobile ? '8px 12px 0' : '10px 28px 0',
            borderBottom: '1px solid rgba(160,110,30,0.2)',
            overflowX: 'auto',
          }}>
            {tabs.map(t => (
              <button key={t} onClick={() => setTab(t)} style={{
                padding: isMobile ? '10px 12px 12px' : '8px 20px 10px',
                background: tab === t ? 'rgba(160,110,30,0.12)' : 'none',
                border: tab === t ? '1px solid rgba(160,110,30,0.3)' : '1px solid transparent',
                borderBottom: tab === t ? '1px solid rgba(18,12,4,0.98)' : '1px solid transparent',
                borderRadius: '6px 6px 0 0',
                color: tab === t ? '#e0c070' : '#94805c',
                cursor: 'pointer', fontSize: isMobile ? 13 : 14, letterSpacing: isMobile ? 1.5 : 3,
                textTransform: 'uppercase', fontFamily: 'Georgia, serif',
                marginBottom: -1, whiteSpace: 'nowrap',
              }}>
                {t}
              </button>
            ))}
          </div>

          <div className="rw-drawer-scroll" style={{ padding: isMobile ? '16px 16px 20px' : '24px 32px 28px', overflowY: 'auto', height: isMobile ? '48dvh' : '36vh' }}>
            {tab === 'territory' && TerritoryPanel()}
            {tab === 'buildings' && BuildingsPanel()}
            {tab === 'military'  && MilitaryPanel()}
          </div>
        </>
      )}
    </div>
  )
}

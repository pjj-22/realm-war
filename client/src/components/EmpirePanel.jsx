import { useState, useEffect, useMemo, useCallback } from 'react'
import { api } from '../api/client'
import { useIsMobile } from '../hooks/useIsMobile'
import { useViewportOverlayFix } from '../hooks/useViewportOverlayFix'
import { shortHex } from '../text'
import { toast } from '../toastBus'
import { theme } from '../theme'
import { PickaxeIcon, TentIcon, KeepIcon, SwordsIcon, WarningIcon, CrownIcon, GoldIcon } from './Icons'

const REFRESH_MS = 30_000

const BUILDING_ICON = { mine: PickaxeIcon, barracks: TentIcon, fort: KeepIcon }

const FILTERS = [
  { id: 'all',       label: 'All' },
  { id: 'threat',    label: 'Threatened' },
  { id: 'empty',     label: 'Undefended' },
  { id: 'nofort',    label: 'No fort' },
  { id: 'nobarracks', label: 'No barracks' },
  { id: 'busy',      label: 'Building / training' },
  { id: 'orders',    label: 'Has orders' },
  { id: 'noorders',  label: 'No orders' },
]

const hasBuilding = (h, type) => h.buildings.some(b => b.type === type)

// Which of the filters above a hex matches. `threatened` is precomputed from
// live armies/battles, everything else comes straight off the row.
const MATCH = {
  all: () => true,
  threat: h => h.threatened,
  empty: h => h.troops === 0 && h.training === 0,
  nofort: h => !hasBuilding(h, 'fort'),
  nobarracks: h => !hasBuilding(h, 'barracks'),
  busy: h => h.training > 0 || h.upgrading || h.buildings.some(b => !b.ready),
  orders: h => !!h.order,
  noorders: h => !h.order,
}

const SORTS = {
  attention: (a, b) => (b.threatened - a.threatened) || ((a.troops === 0) - (b.troops === 0)) || (a.troops - b.troops),
  troops: (a, b) => b.troops - a.troops,
  income: (a, b) => b.income - a.income,
  country: (a, b) => (a.country || '~').localeCompare(b.country || '~') || (b.troops - a.troops),
  claimed: (a, b) => new Date(b.claimed_at) - new Date(a.claimed_at),
}

const S = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 60, padding: 16,
  },
  box: {
    background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 8,
    width: '100%', maxWidth: 860, height: '100%', maxHeight: 720,
    display: 'flex', flexDirection: 'column',
    fontFamily: 'Georgia, serif', color: theme.text.primary,
    boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
  },
  chip: (on) => ({
    padding: '5px 10px', borderRadius: 14, cursor: 'pointer', whiteSpace: 'nowrap',
    background: on ? theme.accent : 'rgba(255,255,255,0.05)',
    border: `1px solid ${on ? theme.accentStrong : theme.border}`,
    color: on ? theme.accentText : theme.text.secondary,
    fontSize: 12, fontFamily: 'Georgia, serif',
  }),
  input: {
    padding: '6px 10px', background: 'rgba(255,255,255,0.05)', border: `1px solid ${theme.border}`,
    borderRadius: 4, color: theme.text.primary, fontSize: 13, fontFamily: 'Georgia, serif', outline: 'none',
  },
}

function Stat({ icon, value, label, color }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 70 }}>
      <span style={{ fontSize: 18, color: color || theme.text.primary, display: 'flex', alignItems: 'center', gap: 5 }}>{icon}{value}</span>
      <span style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: theme.text.tertiary }}>{label}</span>
    </div>
  )
}

function eta(ts) {
  const secs = Math.max(0, Math.round((new Date(ts) - Date.now()) / 1000))
  return secs >= 3600 ? `${Math.floor(secs / 3600)}h${Math.floor((secs % 3600) / 60)}m` : `${Math.max(1, Math.round(secs / 60))}m`
}

export default function EmpirePanel({ player, armies, activeBattles, onFlyTo, onMassMarch, onSent, unlocks, onClose }) {
  const overlayRef = useViewportOverlayFix()
  const isMobile = useIsMobile()
  const [rows, setRows] = useState(null)
  const [filter, setFilter] = useState('all')
  const [sort, setSort] = useState('attention')
  const [country, setCountry] = useState('')
  const [query, setQuery] = useState('')
  const [orderTroops, setOrderTroops] = useState('')
  const [orderBuild, setOrderBuild] = useState('')
  const [applying, setApplying] = useState(false)
  const [decayMin, setDecayMin] = useState(0)
  const [keep, setKeep] = useState('1')
  const [fanMode, setFanMode] = useState('both')
  const [fanPlan, setFanPlan] = useState(null)
  const [fanBusy, setFanBusy] = useState(false)
  const [sync, setSync] = useState(false)
  const [tab, setTab] = useState('hexes')
  const [perTarget, setPerTarget] = useState('')
  const [reach, setReach] = useState('1')
  const [minClaim, setMinClaim] = useState(5)
  const [reinPlan, setReinPlan] = useState(null)
  const [reinBusy, setReinBusy] = useState(false)
  const [redPlan, setRedPlan] = useState(null)
  const [redBusy, setRedBusy] = useState(false)

  const load = useCallback(() => {
    api.getEmpire().then(setRows).catch(err => toast(err.message))
  }, [])
  useEffect(() => {
    load()
    const t = setInterval(load, REFRESH_MS)
    return () => clearInterval(t)
  }, [load])

  // The garrison a hex needs at this empire size to be safe from border decay
  // (config.js requiredGarrisonForHexCount, exposed through /health).
  const hexTotal = rows?.length || 0
  useEffect(() => {
    api.getConfig().then(cfg => {
      const threshold = cfg.decay_hex_threshold ?? 30
      const step = cfg.decay_scale_hexes_per_step ?? 10
      setDecayMin(hexTotal <= threshold ? 0 : 1 + Math.floor((hexTotal - threshold) / step))
      setMinClaim(cfg.min_troops_to_claim ?? 5)
    }).catch(() => {})
  }, [hexTotal])

  // Enemy armies heading for one of my hexes, and hexes with a fight on.
  const incoming = useMemo(() => {
    const m = new Map()
    for (const a of armies) {
      if (a.owner_id === player.id) continue
      const cur = m.get(a.to_hex)
      if (!cur || new Date(a.arrives_at) < new Date(cur.arrives_at)) m.set(a.to_hex, { arrives_at: a.arrives_at, quantity: a.quantity })
    }
    return m
  }, [armies, player.id])
  const battleHexes = useMemo(() => new Set(activeBattles.map(b => b.h3_index)), [activeBattles])

  const all = useMemo(() => (rows || []).map(h => ({
    ...h,
    incoming: incoming.get(h.h3_index) || null,
    fighting: battleHexes.has(h.h3_index),
    threatened: incoming.has(h.h3_index) || battleHexes.has(h.h3_index),
  })), [rows, incoming, battleHexes])

  const countries = useMemo(() => [...new Set(all.map(h => h.country || 'Ocean / Islands'))].sort(), [all])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return all
      .filter(MATCH[filter])
      .filter(h => !country || (h.country || 'Ocean / Islands') === country)
      .filter(h => !q || (h.country || '').toLowerCase().includes(q) || shortHex(h.h3_index).toLowerCase().includes(q) || (h.strategic_name || '').toLowerCase().includes(q))
      .sort(SORTS[sort])
  }, [all, filter, country, query, sort])

  const totals = useMemo(() => ({
    troops: all.reduce((s, h) => s + h.troops, 0),
    training: all.reduce((s, h) => s + h.training, 0),
    income: all.reduce((s, h) => s + h.income, 0),
    threatened: all.filter(h => h.threatened).length,
    empty: all.filter(MATCH.empty).length,
  }), [all])

  const shortfall = useMemo(() => {
    const n = parseInt(orderTroops, 10)
    return Number.isInteger(n) ? visible.reduce((s, h) => s + Math.max(0, n - h.troops - h.training), 0) : 0
  }, [visible, orderTroops])

  async function applyOrders(clear = false) {
    const n = clear ? 0 : parseInt(orderTroops, 10)
    if (!clear && !Number.isInteger(n) && !orderBuild) { toast('Enter a troop count or pick a building'); return }
    setApplying(true)
    try {
      const res = await api.setOrders(visible.map(h => h.h3_index), clear ? 0 : (Number.isInteger(n) ? n : 0), clear ? null : (orderBuild || null))
      toast(clear ? `Orders cleared on ${res.updated} hexes` : `Orders set on ${res.updated} hexes - they run at the next harvest`, 'success')
      load()
    } catch (err) {
      toast(err.message)
    }
    setApplying(false)
  }

  const keepN = Math.max(0, parseInt(keep, 10) || 0)
  const marchSources = useMemo(() => visible.filter(h => h.troops > keepN), [visible, keepN])
  const marchTroops = marchSources.reduce((s, h) => s + h.troops - keepN, 0)
  // Unlock state comes from /players/stats (config.js UNLOCKS); until it has
  // loaded nothing is shown locked - the server enforces the gates anyway.
  const tierOf = id => unlocks?.tiers.find(t => t.id === id)
  const lockedLabel = id => {
    const t = tierOf(id)
    return t && !t.unlocked ? `Unlocks at ${t.hexes} hexes` : null
  }
  const massLabel = lockedLabel('mass_march')
  const fanLabel = lockedLabel('fan_out')
  const ordersLabel = lockedLabel('orders')
  const buildLabel = lockedLabel('build_orders')
  const syncLabel = lockedLabel('coordinated')
  const reinLabel = lockedLabel('reinforce')
  const redLabel = lockedLabel('redistribute')
  const massLocked = !!massLabel
  const fanLocked = !!fanLabel

  // Two steps: the first click asks the server what it would send (nothing
  // moves), the second confirms it. Changing anything in between drops the preview.
  const perTargetN = parseInt(perTarget, 10) || 0
  const perTargetOk = perTargetN >= minClaim
  const reachN = Math.min(10, Math.max(1, parseInt(reach, 10) || 1))
  const fanKey = `${fanMode}|${keepN}|${perTargetN}|${reachN}|${sync}|${filter}|${country}|${query}|${visible.length}`
  const plan = fanPlan?.key === fanKey ? fanPlan : null
  async function fanOut() {
    setFanBusy(true)
    try {
      const sources = visible.map(h => h.h3_index)
      if (!plan) {
        const preview = await api.fanOut(sources, keepN, fanMode, perTargetN, reachN, true, sync && !syncLabel)
        if (!preview.armies) {
          toast(preview.senders === 0
            ? `No hex can send ${perTargetN} and still keep ${keepN} - the most any hex could send is ${preview.maxSpare}. Lower the number or the minimum.`
            : preview.targets === 0
              ? 'No neighbouring hexes to claim or attack with that many troops'
              : 'Nothing to send')
        } else setFanPlan({ ...preview, key: fanKey })
      } else {
        const r = await api.fanOut(sources, keepN, fanMode, perTargetN, reachN, false, sync && !syncLabel)
        toast(r.armies ? `${r.troops} troops sent: ${r.claims} to claim, ${r.attacks} to attack` : 'No troops were free to send', r.armies ? 'success' : 'error')
        setFanPlan(null)
        onSent?.()
        load()
      }
    } catch (err) {
      toast(err.message)
    }
    setFanBusy(false)
  }

  // Same two-step flow as fan out: preview, then confirm
  const redKey = `${keepN}|${filter}|${country}|${query}|${visible.length}`
  const red = redPlan?.key === redKey ? redPlan : null
  async function redistribute() {
    setRedBusy(true)
    try {
      const sources = visible.map(h => h.h3_index)
      if (!red) {
        const preview = await api.redistribute(sources, keepN, true)
        if (!preview.armies) toast(preview.hexes < 2 ? 'Redistribute needs at least two hexes in the filter' : 'Already about even - nothing worth moving')
        else setRedPlan({ ...preview, key: redKey })
      } else {
        const r = await api.redistribute(sources, keepN, false)
        toast(r.armies ? `${r.troops} troops moving between ${r.hexes} hexes` : 'No troops were free to move', r.armies ? 'success' : 'error')
        setRedPlan(null)
        onSent?.()
        load()
      }
    } catch (err) {
      toast(err.message)
    }
    setRedBusy(false)
  }

  const reinKey = `${keepN}`
  const rein = reinPlan?.key === reinKey ? reinPlan : null
  async function reinforce() {
    setReinBusy(true)
    try {
      if (!rein) {
        const preview = await api.reinforce(keepN, true)
        if (!preview.threatened) toast('None of your hexes are under threat')
        else if (!preview.armies) toast(preview.late ? 'Nothing can arrive in time' : 'No spare troops to send')
        else setReinPlan({ ...preview, key: reinKey })
      } else {
        const r = await api.reinforce(keepN, false)
        toast(r.armies ? `${r.troops} troops sent to ${r.covered} threatened hex${r.covered === 1 ? '' : 'es'}` : 'No troops were free to send', r.armies ? 'success' : 'error')
        setReinPlan(null)
        onSent?.()
        load()
      }
    } catch (err) {
      toast(err.message)
    }
    setReinBusy(false)
  }

  const cols = isMobile ? '1fr 50px 56px 90px' : '1.6fr 70px 80px 70px 40px 90px 1fr'
  const colHead = (label, key) => (
    <span
      onClick={key ? () => setSort(key) : undefined}
      style={{ cursor: key ? 'pointer' : 'default', color: sort === key ? theme.accentStrong : theme.text.tertiary }}>
      {label}{sort === key ? ' ▾' : ''}
    </span>
  )

  const TABS = [
    { id: 'hexes', label: `Hexes ${all.length}` },
    { id: 'actions', label: 'Actions' },
    { id: 'orders', label: 'Orders' },
    { id: 'unlocks', label: 'Unlocks' },
  ]
  const card = { border: `1px solid ${theme.border}`, borderRadius: 6, padding: '12px 14px', marginBottom: 12, background: 'rgba(255,255,255,0.02)' }
  const cardTitle = { fontSize: 14, color: theme.text.primary, marginBottom: 2 }
  const cardDesc = { fontSize: 12, color: theme.text.tertiary, marginBottom: 10, lineHeight: 1.5 }
  const row = { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }
  const scopeBar = (
    <div style={{ ...row, justifyContent: 'space-between', fontSize: 12, color: theme.text.secondary, marginBottom: 12 }}>
      <span>Applies to the <b style={{ color: theme.text.primary }}>{visible.length}</b> hex{visible.length === 1 ? '' : 'es'} in your current filter{filter !== 'all' || country || query ? '' : ' (all of them)'}</span>
      <button style={S.chip(false)} onClick={() => setTab('hexes')}>Change filter</button>
    </div>
  )

  return (
    <div ref={overlayRef} style={S.overlay} onClick={onClose}>
      <div style={S.box} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '16px 20px 0', borderBottom: `1px solid ${theme.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontSize: 18, letterSpacing: 4, textTransform: 'uppercase', fontFamily: theme.headerFont }}>Empire</span>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: theme.text.secondary, fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
          </div>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 12 }}>
            <Stat value={all.length} label="Hexes" />
            <Stat icon={<SwordsIcon size={14} />} value={totals.troops + (totals.training ? ` (+${totals.training})` : '')} label="Troops" />
            <Stat icon={<GoldIcon size={14} />} value={`+${totals.income}`} label="Per harvest" />
            <Stat icon={totals.threatened ? <WarningIcon size={14} color="#ff6060" /> : null} value={totals.threatened} label="Threatened" color={totals.threatened ? '#ff6060' : undefined} />
            <Stat value={totals.empty} label="Undefended" color={totals.empty ? '#e0a040' : undefined} />
          </div>
          <div style={{ display: 'flex', gap: 2 }}>
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                padding: '8px 16px', background: 'none', cursor: 'pointer', fontSize: 13, letterSpacing: 1,
                fontFamily: 'Georgia, serif', border: 'none',
                borderBottom: `2px solid ${tab === t.id ? theme.accent : 'transparent'}`,
                color: tab === t.id ? theme.accentStrong : theme.text.secondary,
              }}>{t.label}</button>
            ))}
          </div>
        </div>

        {tab === 'hexes' && (
          <>
            <div style={{ padding: '12px 20px', borderBottom: `1px solid ${theme.border}` }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                {FILTERS.map(f => {
                  const n = f.id === 'all' ? null : all.filter(MATCH[f.id]).length
                  return <button key={f.id} style={S.chip(filter === f.id)} onClick={() => setFilter(f.id)}>{f.label}{n != null ? ` ${n}` : ''}</button>
                })}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input style={{ ...S.input, flex: 1, minWidth: 0 }} placeholder="Search country, #code, landmark" value={query} onChange={e => setQuery(e.target.value)} />
                <select style={{ ...S.input, maxWidth: 160 }} value={country} onChange={e => setCountry(e.target.value)}>
                  <option value="">All countries</option>
                  {countries.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, padding: '8px 20px', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', borderBottom: `1px solid ${theme.border}` }}>
              {colHead('Hex', 'country')}
              {colHead('Troops', 'troops')}
              {colHead('Built')}
              {!isMobile && colHead('Income', 'income')}
              {!isMobile && colHead('Lvl')}
              {!isMobile && colHead('Order')}
              {colHead('Status', 'attention')}
            </div>

            <div style={{ flex: 1, overflowY: 'auto' }}>
              {rows === null && <div style={{ padding: 24, textAlign: 'center', color: theme.text.tertiary }}>Loading...</div>}
              {rows !== null && visible.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: theme.text.tertiary }}>No hexes match.</div>}
              {visible.map(h => (
                <div
                  key={h.h3_index}
                  onClick={() => { onFlyTo(h.h3_index); onClose() }}
                  style={{
                    display: 'grid', gridTemplateColumns: cols, gap: 8, alignItems: 'center',
                    padding: '7px 20px', cursor: 'pointer', fontSize: 13,
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                    background: h.threatened ? 'rgba(180,40,40,0.12)' : 'transparent',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(201,160,64,0.12)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = h.threatened ? 'rgba(180,40,40,0.12)' : 'transparent' }}>
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {h.is_capital && <CrownIcon size={12} />} {h.strategic_name || h.country || 'Ocean / Islands'}
                    <span style={{ color: theme.text.tertiary, fontSize: 11, marginLeft: 6 }}>#{shortHex(h.h3_index)}</span>
                  </span>
                  <span style={{ color: h.troops === 0 ? '#e0a040' : theme.text.primary }}>
                    {h.troops}{h.training > 0 && <span style={{ color: theme.text.tertiary }}> +{h.training}</span>}
                  </span>
                  <span style={{ display: 'flex', gap: 4 }}>
                    {h.buildings.map((b, i) => {
                      const Icon = BUILDING_ICON[b.type]
                      return Icon ? <span key={i} title={`${b.type}${b.ready ? '' : ' (under construction)'}`} style={{ opacity: b.ready ? 1 : 0.4, display: 'flex' }}><Icon size={13} /></span> : null
                    })}
                  </span>
                  {!isMobile && <span>+{h.income}</span>}
                  {!isMobile && <span>{h.upgrade_level}{h.upgrading ? '↑' : ''}</span>}
                  {!isMobile && (
                    <span style={{ fontSize: 12, color: theme.text.secondary }}>
                      {h.order ? [h.order.min_troops ? `Hold ${h.order.min_troops}` : null, h.order.build ? `+${h.order.build}` : null].filter(Boolean).join(' ') : ''}
                    </span>
                  )}
                  <span style={{ fontSize: 12, color: h.threatened ? '#ff8080' : theme.text.tertiary }}>
                    {h.fighting ? 'Under attack' : h.incoming ? `Attack in ${eta(h.incoming.arrives_at)}` : h.rally_hex ? 'Rallying' : ''}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        {tab === 'actions' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px' }}>
            {scopeBar}
            <div style={card}>
              <div style={cardTitle}>Keep at least</div>
              <div style={cardDesc}>The fewest troops any hex may be left with by the actions below. A hex that can't send without dropping under this stays put.</div>
              <div style={row}>
                <input style={{ ...S.input, width: 64 }} inputMode="numeric" value={keep} onChange={e => setKeep(e.target.value.replace(/\D/g, '').slice(0, 3))} />
                <span style={{ fontSize: 13, color: theme.text.secondary }}>troops per hex</span>
                <label style={{ ...row, marginLeft: 'auto', fontSize: 12, color: syncLabel ? theme.text.tertiary : theme.text.secondary }}>
                  <input type="checkbox" checked={sync && !syncLabel} disabled={!!syncLabel} onChange={e => setSync(e.target.checked)} />
                  Arrive together{syncLabel ? ` - ${syncLabel}` : ''}
                </label>
              </div>
            </div>

            <div style={card}>
              <div style={cardTitle}>Reinforce threatened{reinLabel ? <span style={{ color: theme.text.tertiary, fontSize: 12 }}> - {reinLabel}</span> : null}</div>
              <div style={cardDesc}>Sends spare troops from your other hexes to the hexes under attack, nearest first, only if they can arrive in time. Uses all your hexes, not just the filter.</div>
              <div style={row}>
                <button
                  style={{ ...S.chip(true), opacity: !!reinLabel || reinBusy || totals.threatened === 0 ? 0.5 : 1 }}
                  disabled={!!reinLabel || reinBusy || totals.threatened === 0} onClick={reinforce}>
                  {reinLabel ? reinLabel
                    : rein ? `Confirm: ${rein.troops} troops to ${rein.covered} hexes${rein.late ? ` (${rein.late} too far)` : ''}`
                    : totals.threatened === 0 ? 'Nothing under threat' : `Reinforce ${totals.threatened} threatened hexes...`}
                </button>
                {rein && <button style={S.chip(false)} onClick={() => setReinPlan(null)}>Cancel</button>}
              </div>
            </div>

            <div style={card}>
              <div style={cardTitle}>Mass march{massLabel ? <span style={{ color: theme.text.tertiary, fontSize: 12 }}> - {massLabel}</span> : null}</div>
              <div style={cardDesc}>Everything above your minimum, from every hex in the filter, to one hex you click on the map.</div>
              <div style={row}>
                <button
                  style={{ ...S.chip(true), opacity: massLocked || !marchSources.length ? 0.5 : 1 }}
                  disabled={massLocked || !marchSources.length}
                  onClick={() => onMassMarch({ sources: marchSources.map(h => h.h3_index), keep: keepN, sync: sync && !syncLabel })}>
                  {massLocked ? massLabel : `Send ${marchTroops} troops from ${marchSources.length} hexes...`}
                </button>
              </div>
            </div>

            <div style={card}>
              <div style={cardTitle}>Redistribute troops{redLabel ? <span style={{ color: theme.text.tertiary, fontSize: 12 }}> - {redLabel}</span> : null}</div>
              <div style={cardDesc}>Evens out garrisons between neighbouring hexes in your filter: a hex with 60 next to one with 30 sends 15, and a hex in the middle of a slope both receives and passes some on. It's approximate, and you can run it again once the armies land (one march step). Hexes under attack hold their troops, and none drop below your minimum. Moves under 5 troops are skipped.</div>
              <div style={row}>
                <button
                  style={{ ...S.chip(true), opacity: !!redLabel || redBusy || visible.length < 2 ? 0.5 : 1 }}
                  disabled={!!redLabel || redBusy || visible.length < 2} onClick={redistribute}>
                  {redLabel ? redLabel
                    : red ? `Confirm: move ${red.troops} troops in ${red.armies} armies (${red.before.min}-${red.before.max} becomes about ${red.after.min}-${red.after.max})`
                    : 'Redistribute...'}
                </button>
                {red && <button style={S.chip(false)} onClick={() => setRedPlan(null)}>Cancel</button>}
              </div>
            </div>

            <div style={card}>
              <div style={cardTitle}>Fan out{fanLabel ? <span style={{ color: theme.text.tertiary, fontSize: 12 }}> - {fanLabel}</span> : null}</div>
              <div style={cardDesc}>Sends an army of exactly the size you set to each hex next to your land that you don't own, to claim it or attack it. Each target is supplied by the nearest hex within your reach that can afford it and stay at your minimum, so rich interior hexes can feed the border. Attacks only go where your army beats the visible garrison.</div>
              <div style={{ ...row, marginBottom: 10 }}>
                <span style={{ fontSize: 13, color: theme.text.secondary }}>Send</span>
                <input
                  style={{ ...S.input, width: 64 }} inputMode="numeric" placeholder={String(minClaim)}
                  value={perTarget} onChange={e => setPerTarget(e.target.value.replace(/\D/g, '').slice(0, 3))} />
                <span style={{ fontSize: 13, color: theme.text.secondary }}>troops to each target</span>
                {decayMin > minClaim && (
                  <button style={S.chip(false)} onClick={() => setPerTarget(String(decayMin))} title="A new border hex needs about this many to resist decay at your empire's size">
                    Decay-safe ({decayMin})
                  </button>
                )}
              </div>
              <div style={{ ...row, marginBottom: 10 }}>
                <span style={{ fontSize: 13, color: theme.text.secondary }}>Pull troops from up to</span>
                <input
                  style={{ ...S.input, width: 56 }} inputMode="numeric" value={reach}
                  onChange={e => setReach(e.target.value.replace(/\D/g, '').slice(0, 2))} />
                <span style={{ fontSize: 13, color: theme.text.secondary }}>hexes away (1-10) - each hex of travel is a full march step, so far sources arrive later</span>
              </div>
              <div style={row}>
                <select style={S.input} value={fanMode} onChange={e => setFanMode(e.target.value)}>
                  <option value="both">Claim and attack</option>
                  <option value="claim">Claim empty land only</option>
                  <option value="attack">Attack enemies only</option>
                </select>
                <button
                  style={{ ...S.chip(true), opacity: fanLocked || fanBusy || !visible.length || !perTargetOk ? 0.5 : 1 }}
                  disabled={fanLocked || fanBusy || !visible.length || !perTargetOk} onClick={fanOut}>
                  {fanLocked ? fanLabel
                    : !perTargetOk ? `Set at least ${minClaim} troops`
                    : plan ? `Confirm: ${plan.troops} troops, ${plan.claims} claims, ${plan.attacks} attacks`
                    : 'Fan out...'}
                </button>
                {plan && <button style={S.chip(false)} onClick={() => setFanPlan(null)}>Cancel</button>}
              </div>
            </div>
          </div>
        )}

        {tab === 'orders' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px' }}>
            {scopeBar}
            <div style={card}>
              <div style={cardTitle}>Standing orders{ordersLabel ? <span style={{ color: theme.text.tertiary, fontSize: 12 }}> - {ordersLabel}</span> : null}</div>
              <div style={cardDesc}>Rules each hex follows at the start of every harvest, paid from your gold at normal prices, emptiest hexes first. Set here, they show in the Order column on the Hexes tab.</div>
              <div style={{ ...row, marginBottom: 10 }}>
                <span style={{ fontSize: 13, color: theme.text.secondary }}>Keep at least</span>
                <input
                  style={{ ...S.input, width: 64 }} inputMode="numeric" placeholder="troops"
                  value={orderTroops} onChange={e => setOrderTroops(e.target.value.replace(/\D/g, '').slice(0, 3))} />
                {decayMin > 0 && (
                  <button style={S.chip(false)} onClick={() => setOrderTroops(String(decayMin))} title="The garrison a hex needs to resist border decay at your empire's size">
                    Decay-safe ({decayMin})
                  </button>
                )}
              </div>
              <div style={{ ...row, marginBottom: 10 }}>
                <select style={S.input} value={orderBuild} onChange={e => setOrderBuild(e.target.value)}>
                  <option value="">No building</option>
                  <option value="fort" disabled={!!buildLabel}>Build fort if empty{buildLabel ? ` (${buildLabel})` : ''}</option>
                  <option value="barracks" disabled={!!buildLabel}>Build barracks if empty{buildLabel ? ` (${buildLabel})` : ''}</option>
                  <option value="mine" disabled={!!buildLabel}>Build mine if empty{buildLabel ? ` (${buildLabel})` : ''}</option>
                </select>
              </div>
              <div style={row}>
                <button
                  style={{ ...S.chip(true), opacity: applying || !visible.length ? 0.5 : 1 }}
                  disabled={applying || !visible.length || (!!ordersLabel && !!orderTroops) || (!!buildLabel && !!orderBuild)} onClick={() => applyOrders(false)}>
                  Set orders
                </button>
                <button style={S.chip(false)} disabled={applying || !visible.length} onClick={() => applyOrders(true)}>Clear orders</button>
              </div>
              {shortfall > 0 && <div style={{ fontSize: 11, color: theme.text.tertiary, marginTop: 8 }}>Right now that would train about {shortfall} troops.</div>}
            </div>
          </div>
        )}

        {tab === 'unlocks' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px' }}>
            {unlocks ? (
              <>
                <div style={{ fontSize: 12, color: theme.text.secondary, marginBottom: 12 }}>
                  Unlocks are earned by the most hexes you've held this season (yours: {unlocks.effective}).
                </div>
                {unlocks.tiers.map(t => (
                  <div key={t.id} style={{ ...card, opacity: t.unlocked ? 1 : 0.75 }}>
                    <div style={{ ...row, justifyContent: 'space-between' }}>
                      <span style={cardTitle}>{t.name}</span>
                      <span style={{ fontSize: 12, color: t.unlocked ? theme.success : theme.text.tertiary }}>
                        {t.unlocked ? 'Unlocked' : `${t.hexes} hexes`}
                      </span>
                    </div>
                    <div style={{ ...cardDesc, marginBottom: t.unlocked ? 0 : 8 }}>{t.desc}</div>
                    {!t.unlocked && (
                      <div style={{ height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2 }}>
                        <div style={{ height: '100%', width: `${Math.min(100, (unlocks.effective / t.hexes) * 100)}%`, background: theme.accent, borderRadius: 2 }} />
                      </div>
                    )}
                  </div>
                ))}
              </>
            ) : <div style={{ padding: 24, textAlign: 'center', color: theme.text.tertiary }}>Loading...</div>}
          </div>
        )}
      </div>
    </div>
  )
}

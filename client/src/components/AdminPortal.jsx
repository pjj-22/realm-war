import { useState, useEffect, useCallback, useRef } from 'react'
import { cellToBoundary } from 'h3-js'
import { PlagueIcon, MeteorIcon, FamineIcon, RevoltIcon, GoldIcon, SwordsIcon, BotIcon, BoltIcon } from './Icons'

// Standard Web Mercator, hand-rolled rather than pulling in MapLibre - this
// is a one-shot render of every claimed hex at once, not a live tile-backed
// map like GameMap.jsx, so plain SVG is simpler and has no WebGL/tile
// dependency. Pan/zoom below is just viewBox math, no library needed either.
const MERC_W = 960
const MERC_LAT_TOP = 83   // crops near the pole - little to nothing claimable up there
const MERC_LAT_BOTTOM = -60 // crops deep Antarctica the same way
function mercY(lat) {
  const latRad = lat * Math.PI / 180
  const mercN = Math.log(Math.tan(Math.PI / 4 + latRad / 2))
  return MERC_W / 2 - MERC_W * mercN / (2 * Math.PI)
}
function mercXY(lng, lat) {
  return [(lng + 180) / 360 * MERC_W, mercY(lat)]
}
const MERC_FULL = {
  x: 0, y: mercY(MERC_LAT_TOP), w: MERC_W, h: mercY(MERC_LAT_BOTTOM) - mercY(MERC_LAT_TOP),
}
const viewBoxStr = v => `${v.x.toFixed(1)} ${v.y.toFixed(1)} ${v.w.toFixed(1)} ${v.h.toFixed(1)}`

function hexPolygonPoints(h3Index) {
  const boundary = cellToBoundary(h3Index, true) // [lng, lat] pairs
  const lngs = boundary.map(p => p[0])
  const wraps = Math.max(...lngs) - Math.min(...lngs) > 180 // antimeridian-crossing hex
  return boundary.map(([lng, lat]) => mercXY(wraps && lng < 0 ? lng + 360 : lng, lat).join(',')).join(' ')
}

const BASE = (import.meta.env.VITE_API_URL || 'http://localhost:3001') + '/api/admin'
const PUBLIC_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:3001') + '/api'

function adminRequest(method, path, body, secret) {
  return fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': secret },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }).then(async r => {
    const data = await r.json()
    if (!r.ok) throw new Error(data.error || 'Request failed')
    return data
  })
}

const CARD_STYLE = {
  background: 'rgba(20,15,40,0.9)',
  border: '1px solid #4a3a7a',
  borderRadius: 8,
  padding: '16px 20px',
}

// ─── helpers ──────────────────────────────────────────────────────────────────
function ago(ts) {
  if (!ts) return '-'
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000)
  if (s < 0) return 'now'
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function until(ts) {
  const s = Math.floor((new Date(ts).getTime() - Date.now()) / 1000)
  if (s <= 0) return 'arriving…'
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

function dur(seconds) {
  if (seconds == null) return '-'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d) return `${d}d ${h}h`
  if (h) return `${h}h ${m}m`
  return `${m}m ${seconds % 60}s`
}

const hex = h => (h ? `${h.slice(0, 5)}…${h.slice(-3)}` : '-')

const arrivingSoon = ts => new Date(ts).getTime() - Date.now() < 30000

const EVENT_COLOR = {
  crown: '#d4a843', capital: '#ff4a6a', battle: '#ff8a6a',
  plague: '#6a9a4a', meteor: '#ff6a3a', gold_rush: '#d4a843',
  famine: '#a8884a', marauder_surge: '#c0504a', revolt: '#9a5ad4',
}
const eventColor = t => EVENT_COLOR[t] || '#8a7a9a'

// Game-master event flavor (admin-only UI)
const EVENT_ICON = { plague: PlagueIcon, meteor: MeteorIcon, gold_rush: GoldIcon, famine: FamineIcon, marauder_surge: SwordsIcon, revolt: RevoltIcon }
const GmEventIcon = ({ type, size }) => {
  const Icon = EVENT_ICON[type] || BoltIcon
  return <Icon size={size} />
}
const EVENT_DESC = {
  plague: 'Kills a share of every army across the realm.',
  meteor: 'Razes a share of all buildings, everywhere.',
  gold_rush: "Adds gold to every ruler's treasury.",
  famine: 'Drains a share of gold from every treasury.',
  marauder_surge: 'Spawns hostile Wildlands camps around random capitals.',
  revolt: 'Flips random non-capital hexes to neutral.',
}

function StatCard({ label, value, color = '#c9b99a' }) {
  return (
    <div style={{ ...CARD_STYLE, minWidth: 140, flex: '1 1 140px' }}>
      <div style={{ fontSize: 11, color: '#8a7a9a', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 28, color, fontFamily: 'Georgia, serif' }}>{value ?? '-'}</div>
    </div>
  )
}

function btnStyle(bg = '#3a2a6a', danger = false) {
  return {
    padding: '4px 10px', background: danger ? '#5a1a2a' : bg,
    border: `1px solid ${danger ? '#8a2a3a' : '#6a4a9a'}`,
    borderRadius: 4, color: '#c9b99a', cursor: 'pointer',
    fontSize: 12, fontFamily: 'Georgia, serif',
  }
}

function GoldInput({ playerId, secret, onDone }) {
  const [delta, setDelta] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    const n = parseInt(delta, 10)
    if (!n || isNaN(n)) return
    setBusy(true)
    try {
      await adminRequest('POST', `/players/${playerId}/gold`, { delta: n }, secret)
      onDone()
    } catch (e) { alert(e.message) }
    setBusy(false)
    setDelta('')
  }

  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      <input
        value={delta}
        onChange={e => setDelta(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && submit()}
        placeholder="+/- gold"
        style={{
          width: 80, padding: '3px 6px', background: 'rgba(255,255,255,0.05)',
          border: '1px solid #4a3a6a', borderRadius: 4, color: '#c9b99a',
          fontSize: 12, fontFamily: 'Georgia, serif',
        }}
      />
      <button onClick={submit} disabled={busy} style={btnStyle('#3a2a6a')}>ok</button>
    </div>
  )
}

// shared table chrome
const TH = { padding: '10px 14px', textAlign: 'left', color: '#8a7a9a', fontWeight: 'normal', letterSpacing: 1, fontSize: 11, textTransform: 'uppercase' }
const TD = { padding: '8px 14px' }
const ROW = { borderBottom: '1px solid rgba(74,58,122,0.2)' }
const dot = c => <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: '50%', background: c, verticalAlign: 'middle' }} />

// Troop-count-per-round line chart for a single battle. The underlying data
// (atk_troops_after/def_troops_after per round) was already being stored in
// battle_rounds for the dice-log table below - this just visualizes it as
// the time series it already is, instead of only reading it off a table.
function BattleTroopChart({ rounds, width = 640, height = 160 }) {
  if (!rounds || rounds.length === 0) return null

  const first = rounds[0]
  const points = [
    { round: 0, atk: Number(first.atk_frontline_before), def: Number(first.def_frontline_before) },
    ...rounds.map(r => ({ round: r.round_number, atk: Number(r.atk_troops_after), def: Number(r.def_troops_after) })),
  ]

  const maxY = Math.max(1, ...points.map(p => Math.max(p.atk, p.def)))
  const maxRound = points[points.length - 1].round || 1
  const padL = 32, padB = 20, padT = 10, padR = 10
  const plotW = width - padL - padR
  const plotH = height - padT - padB

  const px = r => padL + (r / maxRound) * plotW
  const py = v => padT + plotH - (v / maxY) * plotH

  const linePath = key => points.map((p, i) => `${i === 0 ? 'M' : 'L'}${px(p.round).toFixed(1)},${py(p[key]).toFixed(1)}`).join(' ')

  const yTicks = 4
  const gridLines = Array.from({ length: yTicks + 1 }, (_, i) => {
    const v = Math.round((maxY / yTicks) * i)
    return { v, y: py(v) }
  })

  return (
    <div style={{ ...CARD_STYLE, marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 11, color: '#8a7a9a', letterSpacing: 1, textTransform: 'uppercase' }}>Troop strength by round</div>
        <div style={{ display: 'flex', gap: 14, fontSize: 12 }}>
          <span style={{ color: '#ff8a6a' }}>● Attacker</span>
          <span style={{ color: '#8a9aff' }}>● Defender</span>
        </div>
      </div>
      <svg width={width} height={height} style={{ display: 'block', maxWidth: '100%' }}>
        {gridLines.map(g => (
          <g key={g.v}>
            <line x1={padL} x2={width - padR} y1={g.y} y2={g.y} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
            <text x={padL - 6} y={g.y + 3} textAnchor="end" fontSize="10" fill="#6a5878">{g.v}</text>
          </g>
        ))}
        <path d={linePath('atk')} fill="none" stroke="#ff8a6a" strokeWidth="2" strokeLinejoin="round" />
        <path d={linePath('def')} fill="none" stroke="#8a9aff" strokeWidth="2" strokeLinejoin="round" />
        {points.map(p => (
          <g key={`pt-${p.round}`}>
            <circle cx={px(p.round)} cy={py(p.atk)} r="2.5" fill="#ff8a6a" />
            <circle cx={px(p.round)} cy={py(p.def)} r="2.5" fill="#8a9aff" />
            <text x={px(p.round)} y={height - 4} textAnchor="middle" fontSize="10" fill="#6a5878">{p.round}</text>
          </g>
        ))}
      </svg>
    </div>
  )
}

function SectionTitle({ children }) {
  return <div style={{ margin: '0 0 10px', fontSize: 13, color: '#8a7a9a', letterSpacing: 2, textTransform: 'uppercase' }}>{children}</div>
}

// Cohort retention row: N-day label, retained/cohort counts, and a percentage bar
function RetentionRow({ label, cohort, retained, pct }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 0' }}>
      <div style={{ width: 46, fontSize: 13, color: '#c9b99a' }}>{label}</div>
      <div style={{ flex: 1, height: 10, background: 'rgba(255,255,255,0.06)', borderRadius: 5, overflow: 'hidden' }}>
        <div style={{ width: `${pct ?? 0}%`, height: '100%', background: pct == null ? 'transparent' : '#8a9aff' }} />
      </div>
      <div style={{ width: 130, fontSize: 12, color: '#8a7a9a', textAlign: 'right' }}>
        {cohort === 0
          ? 'no cohort yet'
          : `${pct}% (${retained}/${cohort})`}
      </div>
    </div>
  )
}

const TABS = ['Overview', 'Retention', 'Activity', 'Battles', 'Battle Log', 'Armies', 'Events', 'Players', 'Season', 'World Map', 'System']

export default function AdminPortal() {
  const [secret, setSecret] = useState(() => sessionStorage.getItem('rw_admin_secret') || '')
  const [authed, setAuthed] = useState(false)
  const [authErr, setAuthErr] = useState('')
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState('Overview')
  const [auto, setAuto] = useState(true)
  const [lastUpdated, setLastUpdated] = useState(null)

  const [overview, setOverview] = useState(null)
  const [retention, setRetention] = useState(null)
  const [players, setPlayers] = useState([])
  const [activity, setActivity] = useState([])
  const [battles, setBattles] = useState([])
  const [armies, setArmies] = useState([])
  const [system, setSystem] = useState(null)

  // Battle Log tab - loaded lazily (not part of the 5s global poll) since the
  // dice-roll detail is only needed while someone's actively debugging one fight.
  const [recentBattles, setRecentBattles] = useState([])
  const [recentBusy, setRecentBusy] = useState(false)
  const [selectedBattleId, setSelectedBattleId] = useState(null)
  const [battleRounds, setBattleRounds] = useState([])
  const [roundsBusy, setRoundsBusy] = useState(false)

  const [playerSearch, setPlayerSearch] = useState('')

  const [tickBusy, setTickBusy] = useState(false)
  const [botBusy, setBotBusy] = useState(false)
  const [seasonBusy, setSeasonBusy] = useState(false)
  const [pendingResolution, setPendingResolution] = useState(null)
  const [resolutionInput, setResolutionInput] = useState('')
  const [resolutionBusy, setResolutionBusy] = useState(false)
  const [pendingDays, setPendingDays] = useState(null)
  const [daysInput, setDaysInput] = useState('')
  const [daysBusy, setDaysBusy] = useState(false)
  const [seasonHistory, setSeasonHistory] = useState([])
  const [historyBusy, setHistoryBusy] = useState(false)
  const [landOutline, setLandOutline] = useState(null)
  const [allHexes, setAllHexes] = useState([])
  const [worldMapBusy, setWorldMapBusy] = useState(false)
  const [mapView, setMapView] = useState(MERC_FULL)
  const mapSvgRef = useRef(null)
  const mapDragRef = useRef(null)
  const [goldTarget, setGoldTarget] = useState(null)

  const [eventTypes, setEventTypes] = useState({})
  const [eventParams, setEventParams] = useState({})
  const [eventBusy, setEventBusy] = useState(null)
  const [eventLog, setEventLog] = useState([])

  // tick the clock so relative times / countdowns stay live between fetches
  const [, setClock] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setClock(c => c + 1), 1000)
    return () => clearInterval(t)
  }, [])

  const loadAll = useCallback(async (s = secret) => {
    setLoading(true)
    try {
      const [ov, rt, pl, ac, ba, ar, sy, et, nr, nd] = await Promise.all([
        adminRequest('GET', '/overview', null, s),
        adminRequest('GET', '/retention', null, s),
        adminRequest('GET', '/players', null, s),
        adminRequest('GET', '/activity', null, s),
        adminRequest('GET', '/battles', null, s),
        adminRequest('GET', '/armies', null, s),
        adminRequest('GET', '/system', null, s),
        adminRequest('GET', '/events/types', null, s),
        adminRequest('GET', '/season/next-resolution', null, s),
        adminRequest('GET', '/season/next-duration', null, s),
      ])
      setOverview(ov); setRetention(rt); setPlayers(pl); setActivity(ac); setBattles(ba); setArmies(ar); setSystem(sy)
      setEventTypes(et)
      setPendingResolution(nr.next_hex_resolution)
      setPendingDays(nd.next_season_days)
      setEventParams(prev => {
        const next = { ...prev }
        for (const k of Object.keys(et)) if (next[k] == null) next[k] = et[k].def
        return next
      })
      setAuthed(true); setAuthErr('')
      setLastUpdated(Date.now())
      sessionStorage.setItem('rw_admin_secret', s)
    } catch (e) {
      setAuthErr(e.message); setAuthed(false)
    }
    setLoading(false)
  }, [secret])

  useEffect(() => { if (secret) loadAll(secret) }, []) // eslint-disable-line

  useEffect(() => {
    if (!authed || !auto) return
    const t = setInterval(() => loadAll(), 5000)
    return () => clearInterval(t)
  }, [authed, auto, loadAll])

  const loadRecentBattles = useCallback(async () => {
    setRecentBusy(true)
    try { setRecentBattles(await adminRequest('GET', '/battles/recent', null, secret)) }
    catch (e) { alert(e.message) }
    setRecentBusy(false)
  }, [secret])

  // Both effects below fetch admin data keyed on tab/selection changes - there's
  // no pure-render substitute for "go fetch this and show it when it arrives".
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (authed && tab === 'Battle Log') loadRecentBattles() }, [authed, tab, loadRecentBattles])

  const loadSeasonHistory = useCallback(async () => {
    setHistoryBusy(true)
    try {
      const r = await fetch(`${PUBLIC_BASE}/seasons/history?limit=5`)
      setSeasonHistory(await r.json())
    } catch { /* keep showing last-known history */ }
    setHistoryBusy(false)
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (authed && tab === 'Season') loadSeasonHistory() }, [authed, tab, loadSeasonHistory])

  const loadWorldMap = useCallback(async () => {
    setWorldMapBusy(true)
    try {
      const [outline, hexes] = await Promise.all([
        landOutline ? Promise.resolve(landOutline) : adminRequest('GET', '/world/land-outline', null, secret),
        adminRequest('GET', '/hexes/all', null, secret),
      ])
      setLandOutline(outline)
      setAllHexes(hexes)
    } catch (e) { alert(e.message) }
    setWorldMapBusy(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secret, landOutline])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (authed && tab === 'World Map' && !allHexes.length) loadWorldMap() }, [authed, tab]) // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll to zoom, centered on the cursor - clamped so you can't zoom out
  // past the full world or in past ~1/60th of it.
  function handleMapWheel(e) {
    e.preventDefault()
    const rect = mapSvgRef.current.getBoundingClientRect()
    const v = mapView
    const mx = v.x + (e.clientX - rect.left) / rect.width * v.w
    const my = v.y + (e.clientY - rect.top) / rect.height * v.h
    const scale = e.deltaY > 0 ? 1.15 : 1 / 1.15
    const w = Math.min(MERC_FULL.w, Math.max(MERC_FULL.w / 60, v.w * scale))
    const h = w * (MERC_FULL.h / MERC_FULL.w)
    setMapView({ x: mx - (mx - v.x) * (w / v.w), y: my - (my - v.y) * (h / v.h), w, h })
  }
  function handleMapMouseDown(e) {
    mapDragRef.current = { startX: e.clientX, startY: e.clientY, view: mapView }
  }
  function handleMapMouseMove(e) {
    if (!mapDragRef.current) return
    const rect = mapSvgRef.current.getBoundingClientRect()
    const { startX, startY, view } = mapDragRef.current
    const dx = (e.clientX - startX) / rect.width * view.w
    const dy = (e.clientY - startY) / rect.height * view.h
    setMapView({ ...view, x: view.x - dx, y: view.y - dy })
  }
  function stopMapDrag() { mapDragRef.current = null }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (selectedBattleId == null) { setBattleRounds([]); return }
    let cancelled = false
    setRoundsBusy(true)
    adminRequest('GET', `/battles/${selectedBattleId}/rounds`, null, secret)
      .then(rows => { if (!cancelled) setBattleRounds(rows) })
      .catch(e => !cancelled && alert(e.message))
      .finally(() => !cancelled && setRoundsBusy(false))
    return () => { cancelled = true }
  }, [selectedBattleId, secret])

  async function forceTick() {
    setTickBusy(true)
    try { await adminRequest('POST', '/tick', null, secret); await loadAll() }
    catch (e) { alert(e.message) }
    setTickBusy(false)
  }
  async function resetBots() {
    if (!confirm('Wipe and re-seed all bots?')) return
    setBotBusy(true)
    try { await adminRequest('POST', '/bots/reset', null, secret); await loadAll() }
    catch (e) { alert(e.message) }
    setBotBusy(false)
  }
  async function endSeason() {
    if (!confirm('End the current season NOW? Standings freeze, a Champion is crowned, and the entire map resets.')) return
    setSeasonBusy(true)
    try {
      const r = await adminRequest('POST', '/season/end', null, secret)
      alert(`Season ${r.ended} ended. A new age begins.`)
      await loadAll()
    } catch (e) { alert(e.message) }
    setSeasonBusy(false)
  }
  async function setNextResolution() {
    const resolution = parseInt(resolutionInput, 10)
    if (!Number.isInteger(resolution) || resolution < 0 || resolution > 15) { alert('Enter an integer 0-15'); return }
    setResolutionBusy(true)
    try {
      await adminRequest('POST', '/season/next-resolution', { resolution }, secret)
      setPendingResolution(resolution)
      setResolutionInput('')
    } catch (e) { alert(e.message) }
    setResolutionBusy(false)
  }
  async function setNextDuration() {
    const days = parseInt(daysInput, 10)
    if (!Number.isInteger(days) || days < 1 || days > 365) { alert('Enter an integer 1-365'); return }
    setDaysBusy(true)
    try {
      await adminRequest('POST', '/season/next-duration', { days }, secret)
      setPendingDays(days)
      setDaysInput('')
    } catch (e) { alert(e.message) }
    setDaysBusy(false)
  }
  async function deletePlayer(id, username) {
    if (!confirm(`Delete ${username}? This removes all their hexes, troops, and buildings.`)) return
    try { await adminRequest('DELETE', `/players/${id}`, null, secret); await loadAll() }
    catch (e) { alert(e.message) }
  }

  async function fireEvent(type) {
    const def = eventTypes[type]
    if (!confirm(`Unleash ${def.name} on the entire realm? This affects every player at once.`)) return
    setEventBusy(type)
    try {
      const r = await adminRequest('POST', '/event', { type, param: eventParams[type] }, secret)
      setEventLog(l => [{ ...r, at: Date.now() }, ...l].slice(0, 8))
      await loadAll()
    } catch (e) { alert(e.message) }
    setEventBusy(null)
  }

  // ─── login ──────────────────────────────────────────────────────────────────
  if (!authed) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: '#0a0818', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Georgia, serif', color: '#c9b99a' }}>
        <div style={{ ...CARD_STYLE, width: 320, textAlign: 'center' }}>
          <div style={{ fontSize: 20, marginBottom: 4, letterSpacing: 2 }}>REALM WAR</div>
          <div style={{ fontSize: 12, color: '#8a7a9a', letterSpacing: 3, marginBottom: 24 }}>ADMIN</div>
          <input
            type="password"
            value={secret}
            onChange={e => setSecret(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && loadAll(secret)}
            placeholder="Admin secret"
            autoFocus
            style={{ width: '100%', padding: '8px 12px', marginBottom: 12, background: 'rgba(255,255,255,0.05)', border: '1px solid #4a3a6a', borderRadius: 4, color: '#c9b99a', fontSize: 14, fontFamily: 'Georgia, serif', boxSizing: 'border-box' }}
          />
          {authErr && <div style={{ color: '#c04040', fontSize: 13, marginBottom: 10 }}>{authErr}</div>}
          <button onClick={() => loadAll(secret)} disabled={loading} style={{ ...btnStyle(), width: '100%', padding: '8px 0', fontSize: 14 }}>
            {loading ? 'Checking…' : 'Enter'}
          </button>
          <div style={{ marginTop: 16, fontSize: 12, color: '#4a3a6a' }}>
            <a href="/" style={{ color: '#8a7a9a' }}>← back to game</a>
          </div>
        </div>
      </div>
    )
  }

  const searchLower = playerSearch.trim().toLowerCase()
  const humans = players.filter(p => !p.username.startsWith('BOT_') && (!searchLower || p.username.toLowerCase().includes(searchLower)))
  const bots = players.filter(p => p.username.startsWith('BOT_') && (!searchLower || p.username.toLowerCase().includes(searchLower)))

  return (
    <div style={{ height: '100vh', overflowY: 'auto', background: '#0a0818', color: '#c9b99a', fontFamily: 'Georgia, serif', padding: '24px 32px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <span style={{ fontSize: 22, letterSpacing: 2 }}>REALM WAR</span>
          <span style={{ fontSize: 12, color: '#8a7a9a', letterSpacing: 3, marginLeft: 12 }}>ADMIN PORTAL</span>
          {system && (
            <span style={{ fontSize: 11, marginLeft: 14, color: system.dev_mode ? '#d4a843' : '#6a9a6a', border: `1px solid ${system.dev_mode ? '#6a5320' : '#2a4a2a'}`, borderRadius: 4, padding: '2px 8px', letterSpacing: 1 }}>
              {system.dev_mode ? 'DEV MODE' : 'PRODUCTION'}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#8a7a9a' }}>updated {lastUpdated ? ago(lastUpdated) : '-'}</span>
          <label style={{ fontSize: 12, color: '#8a7a9a', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} /> auto
          </label>
          <button onClick={() => loadAll()} style={btnStyle()} disabled={loading}>{loading ? '…' : '↻ Refresh'}</button>
          <button onClick={forceTick} style={btnStyle('#2a3a5a')} disabled={tickBusy}>{tickBusy ? 'Ticking…' : 'Force Tick'}</button>
          <button onClick={resetBots} style={btnStyle('#3a2a1a')} disabled={botBusy}>{botBusy ? 'Resetting…' : 'Reset Bots'}</button>
          <button onClick={endSeason} style={btnStyle('#5a2a2a')} disabled={seasonBusy}>{seasonBusy ? 'Ending…' : 'End Season'}</button>
          <a href="/" style={{ ...btnStyle(), textDecoration: 'none', fontSize: 12 }}>← Game</a>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '1px solid #2a2040' }}>
        {TABS.map(t => {
          const active = t === tab
          const count = t === 'Activity' ? activity.length : t === 'Battles' ? battles.length : t === 'Armies' ? armies.length : null
          return (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '8px 16px', background: 'none', border: 'none', borderBottom: `2px solid ${active ? '#9a7ad4' : 'transparent'}`,
              color: active ? '#d4c9a8' : '#8a7a9a', cursor: 'pointer', fontSize: 14, fontFamily: 'Georgia, serif', letterSpacing: 1,
            }}>
              {t}{count != null && <span style={{ fontSize: 11, marginLeft: 6, color: active ? '#9a7ad4' : '#4a3a6a' }}>{count}</span>}
            </button>
          )
        })}
      </div>

      {/* ─── Overview ─── */}
      {tab === 'Overview' && overview && (
        <>
          <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
            <StatCard label="Human Players" value={overview.human_players} color="#8a9aff" />
            <StatCard label="Hexes Claimed" value={overview.total_hexes} color="#c9a040" />
            <StatCard label="Active Battles" value={overview.active_battles} color="#ff4a6a" />
            <StatCard label="Marching Armies" value={overview.active_armies} color="#ff8a6a" />
            <StatCard label="Total Troops" value={overview.total_troops?.toLocaleString()} color="#c9b99a" />
            <StatCard label="Player Gold" value={overview.total_gold?.toLocaleString()} color="#d4a843" />
            <StatCard label="Bots" value={overview.bot_players} color="#6a9a6a" />
            <StatCard label="Alliances" value={overview.alliances} color="#9a7ad4" />
            <StatCard label="Training Queue" value={overview.training_queued} color="#8a9a8a" />
            <StatCard label="Upgrades Queue" value={overview.upgrade_queued} color="#5ac9c0" />
          </div>
          <SectionTitle>Recent Activity</SectionTitle>
          <ActivityFeed items={activity.slice(0, 12)} />
        </>
      )}

      {/* ─── Retention ─── */}
      {tab === 'Retention' && retention && (
        <>
          <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
            <StatCard label="Total Signups" value={retention.total_signups} color="#c9b99a" />
            <StatCard label="DAU" value={retention.dau} color="#8a9aff" />
            <StatCard label="WAU" value={retention.wau} color="#9a7ad4" />
            <StatCard label="MAU" value={retention.mau} color="#6a9a6a" />
          </div>

          <SectionTitle>Cohort Retention</SectionTitle>
          <div style={{ ...CARD_STYLE, marginBottom: 24 }}>
            <div style={{ fontSize: 12, color: '#8a7a9a', marginBottom: 4 }}>
              Rolling retention - the share of each signup cohort that had come back on or after day N.
              Cohorts with 0 players just haven't existed that long yet.
            </div>
            <RetentionRow label="Day 1" {...retention.retention.d1} />
            <RetentionRow label="Day 7" {...retention.retention.d7} />
            <RetentionRow label="Day 30" {...retention.retention.d30} />
          </div>

          <SectionTitle>Login Streak Distribution</SectionTitle>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <StatCard label="Streak 0" value={retention.streaks['0']} />
            <StatCard label="Streak 1" value={retention.streaks['1']} />
            <StatCard label="Streak 2-6" value={retention.streaks['2-6']} color="#8a9aff" />
            <StatCard label="Streak 7-29" value={retention.streaks['7-29']} color="#9a7ad4" />
            <StatCard label="Streak 30+" value={retention.streaks['30+']} color="#d4a843" />
          </div>
        </>
      )}

      {/* ─── Activity ─── */}
      {tab === 'Activity' && (
        <>
          <SectionTitle>World Events ({activity.length})</SectionTitle>
          <ActivityFeed items={activity} />
        </>
      )}

      {/* ─── Battles ─── */}
      {tab === 'Battles' && (
        <>
          <SectionTitle>Active Battles ({battles.length})</SectionTitle>
          {battles.length === 0
            ? <Empty>No battles raging right now.</Empty>
            : <div style={{ ...CARD_STYLE, padding: 0, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr style={{ borderBottom: '1px solid #4a3a6a' }}>
                  {['Hex', 'Attacker', 'Atk Str', 'Defender', 'Def Str', 'Round', 'Started'].map(h => <th key={h} style={TH}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {battles.map(b => {
                    const atk = Number(b.attacker_strength), def = Number(b.defender_strength)
                    const total = atk + def || 1
                    return (
                      <tr key={b.id} style={ROW}>
                        <td style={{ ...TD, fontFamily: 'monospace', color: '#8a7a9a' }}>{hex(b.h3_index)}</td>
                        <td style={TD}>{dot(b.attacker_color)} <span style={{ marginLeft: 6 }}>{b.attacker_name}</span></td>
                        <td style={{ ...TD, color: '#ff8a6a' }}>{atk.toFixed(0)}</td>
                        <td style={TD}>{dot(b.defender_color)} <span style={{ marginLeft: 6 }}>{b.defender_name}</span></td>
                        <td style={{ ...TD, color: '#8a9aff' }}>{def.toFixed(0)}</td>
                        <td style={TD}>
                          <div style={{ marginBottom: 3 }}>#{b.round_number}</div>
                          <div style={{ width: 90, height: 5, background: '#8a9aff', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ width: `${(atk / total) * 100}%`, height: '100%', background: '#ff8a6a' }} />
                          </div>
                        </td>
                        <td style={{ ...TD, color: '#8a7a9a', fontSize: 12 }}>{ago(b.created_at)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>}
        </>
      )}

      {/* ─── Battle Log ─── */}
      {tab === 'Battle Log' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <SectionTitle>Recent Battles ({recentBattles.length})</SectionTitle>
            <button onClick={loadRecentBattles} style={btnStyle()} disabled={recentBusy}>{recentBusy ? '…' : '↻ Refresh'}</button>
          </div>
          {recentBattles.length === 0
            ? <Empty>No battles recorded yet.</Empty>
            : <div style={{ ...CARD_STYLE, padding: 0, overflowX: 'auto', marginBottom: 20 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr style={{ borderBottom: '1px solid #4a3a6a' }}>
                  {['Hex', 'Attacker', 'Defender', 'Advantaged Def', 'Status', 'Rounds', 'Atk Lost', 'Def Lost', 'When'].map(h => <th key={h} style={TH}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {recentBattles.map(b => (
                    <tr
                      key={b.id} style={{ ...ROW, cursor: 'pointer', background: selectedBattleId === b.id ? 'rgba(154,122,212,0.15)' : 'transparent' }}
                      onClick={() => setSelectedBattleId(b.id)}
                    >
                      <td style={{ ...TD, fontFamily: 'monospace', color: '#8a7a9a' }}>{hex(b.h3_index)}</td>
                      <td style={TD}>{dot(b.attacker_color)} <span style={{ marginLeft: 6 }}>{b.attacker_name}</span></td>
                      <td style={TD}>{dot(b.defender_color)} <span style={{ marginLeft: 6 }}>{b.defender_name}</span></td>
                      <td style={{ ...TD, color: '#d4a843' }} title="Of the defender's current frontline, this many roll with advantage (2 dice, take the higher). Fort +3, entrenchment +1/friendly neighbor (max +4), strategic hex +2, capped at 5 total - and can't exceed how many defenders are actually still on the frontline.">
                        {b.defender_advantage_troops > 0 ? `${Math.min(Number(b.defender_advantage_troops), Number(b.defender_frontline) || 0)} / ${b.defender_frontline}` : 'none'}
                      </td>
                      <td style={{ ...TD, color: b.status === 'active' ? '#ff8a6a' : b.status === 'attacker_won' ? '#ff8a6a' : '#8a9aff' }}>{b.status}</td>
                      <td style={TD}>{b.round_number}</td>
                      <td style={{ ...TD, color: '#ff8a6a' }}>{Number(b.attacker_losses)}</td>
                      <td style={{ ...TD, color: '#8a9aff' }}>{Number(b.defender_losses)}</td>
                      <td style={{ ...TD, color: '#8a7a9a', fontSize: 12 }}>{ago(b.ended_at || b.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>}

          {selectedBattleId != null && (
            <div
              style={{
                position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                zIndex: 200, padding: 16,
              }}
              onClick={() => setSelectedBattleId(null)}
            >
              <div
                style={{
                  background: '#0f0a1e', border: '1px solid #4a3a6a', borderRadius: 10,
                  width: '100%', maxWidth: 900, maxHeight: '90vh', overflowY: 'auto',
                  padding: 20, boxShadow: '0 0 60px rgba(80,40,160,0.4)',
                }}
                onClick={e => e.stopPropagation()}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <SectionTitle>Clash-by-clash dice log · Battle #{selectedBattleId} {roundsBusy && '(loading…)'}</SectionTitle>
                  <button onClick={() => setSelectedBattleId(null)} style={{
                    background: 'none', border: 'none', color: '#8a7a9a',
                    cursor: 'pointer', fontSize: 22, lineHeight: 1, padding: '0 0 0 12px',
                  }}>×</button>
                </div>
                {battleRounds.length > 0 && <BattleTroopChart rounds={battleRounds} width={840} />}
                {battleRounds.length === 0 && !roundsBusy
                  ? <Empty>No rounds logged for this battle.</Empty>
                  : <div style={{ ...CARD_STYLE, padding: 0, overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead><tr style={{ borderBottom: '1px solid #4a3a6a' }}>
                        {['Round', 'Atk Frontline', 'Atk Dice', 'Def Frontline', 'Def Dice', 'Atk Lost', 'Def Lost', 'Atk Left', 'Def Left'].map(h => <th key={h} style={TH}>{h}</th>)}
                      </tr></thead>
                      <tbody>
                        {battleRounds.map(r => (
                          <tr key={r.round_number} style={ROW}>
                            <td style={TD}>#{r.round_number}</td>
                            <td style={{ ...TD, color: '#8a7a9a' }}>{r.atk_frontline_before}</td>
                            <td style={{ ...TD, fontFamily: 'monospace', color: '#ff8a6a' }}>{r.atk_dice.join(', ')}</td>
                            <td style={{ ...TD, color: '#8a7a9a' }}>{r.def_frontline_before}</td>
                            <td style={{ ...TD, fontFamily: 'monospace', color: '#8a9aff' }}>{r.def_dice.join(', ')}</td>
                            <td style={{ ...TD, color: '#ff8a6a' }}>-{r.atk_losses}</td>
                            <td style={{ ...TD, color: '#8a9aff' }}>-{r.def_losses}</td>
                            <td style={{ ...TD, color: '#ff8a6a' }}>{Math.round(Number(r.atk_troops_after))}</td>
                            <td style={{ ...TD, color: '#8a9aff' }}>{Math.round(Number(r.def_troops_after))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>}
              </div>
            </div>
          )}
        </>
      )}

      {/* ─── Armies ─── */}
      {tab === 'Armies' && (
        <>
          <SectionTitle>Marching Armies ({armies.length})</SectionTitle>
          {armies.length === 0
            ? <Empty>No armies on the march.</Empty>
            : <div style={{ ...CARD_STYLE, padding: 0, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr style={{ borderBottom: '1px solid #4a3a6a' }}>
                  {['Owner', 'Type', 'Qty', 'From', 'To', 'Arrives In', 'Departed'].map(h => <th key={h} style={TH}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {armies.map(a => {
                    const soon = arrivingSoon(a.arrives_at)
                    return (
                      <tr key={a.id} style={ROW}>
                        <td style={TD}>{dot(a.color)} <span style={{ marginLeft: 6 }}>{a.username.startsWith('BOT_') ? <><BotIcon size={13} /> {a.username.slice(4)}</> : a.username}</span></td>
                        <td style={{ ...TD, color: '#8a7a9a' }}>{a.type}</td>
                        <td style={{ ...TD, color: '#ff8a6a' }}>{a.quantity}</td>
                        <td style={{ ...TD, fontFamily: 'monospace', color: '#8a7a9a' }}>{hex(a.from_hex)}</td>
                        <td style={{ ...TD, fontFamily: 'monospace', color: '#8a7a9a' }}>{hex(a.to_hex)}</td>
                        <td style={{ ...TD, color: soon ? '#ff4a6a' : '#c9a040' }}>{until(a.arrives_at)}</td>
                        <td style={{ ...TD, color: '#8a7a9a', fontSize: 12 }}>{ago(a.departed_at)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>}
        </>
      )}

      {/* ─── Events ─── */}
      {tab === 'Events' && (
        <>
          <SectionTitle>Acts of God — instant, global</SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16, marginBottom: 28 }}>
            {Object.entries(eventTypes).map(([type, def]) => {
              const val = eventParams[type] ?? def.def
              const isPct = def.param === 'severity'
              const display = isPct ? `${Math.round(val * 100)}%` : val
              return (
                <div key={type} style={{ ...CARD_STYLE }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <GmEventIcon type={type} size={22} />
                    <span style={{ fontSize: 17, color: eventColor(type), fontFamily: 'Georgia, serif' }}>{def.name}</span>
                  </div>
                  <div style={{ fontSize: 12, color: '#8a7a9a', minHeight: 32, marginBottom: 12 }}>{EVENT_DESC[type]}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                    <input
                      type="range" min={def.min} max={def.max} step={def.step} value={val}
                      onChange={e => setEventParams(p => ({ ...p, [type]: Number(e.target.value) }))}
                      style={{ flex: 1, accentColor: eventColor(type) }}
                    />
                    <span style={{ width: 88, textAlign: 'right', fontSize: 12, color: '#c9b99a' }}>
                      <b style={{ color: eventColor(type) }}>{display}</b> {def.unit}
                    </span>
                  </div>
                  <button
                    onClick={() => fireEvent(type)}
                    disabled={eventBusy === type}
                    style={{ ...btnStyle('#5a2a2a', false), width: '100%', padding: '8px 0', fontSize: 14, borderColor: eventColor(type) }}
                  >
                    {eventBusy === type ? 'Unleashing…' : `Unleash ${def.name}`}
                  </button>
                </div>
              )
            })}
          </div>

          <SectionTitle>This session's calamities</SectionTitle>
          {eventLog.length === 0
            ? <Empty>No events unleashed yet. Choose your wrath above.</Empty>
            : <div style={{ ...CARD_STYLE, padding: 0 }}>
              {eventLog.map((e, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderTop: i ? '1px solid rgba(74,58,122,0.2)' : 'none' }}>
                  <GmEventIcon type={e.type} size={16} />
                  <span style={{ flex: 1, fontSize: 13, color: '#c9b99a' }}>{e.headline}</span>
                  {e.notified > 0 && <span style={{ fontSize: 11, color: '#6a9a6a' }}>{e.notified} notified</span>}
                  <span style={{ fontSize: 11, color: '#8a7a9a', width: 70, textAlign: 'right' }}>{ago(e.at)}</span>
                </div>
              ))}
            </div>}
        </>
      )}

      {/* ─── Players ─── */}
      {tab === 'Players' && (
        <>
          <input
            type="text"
            value={playerSearch}
            onChange={e => setPlayerSearch(e.target.value)}
            placeholder="Search username…"
            style={{
              width: 280, maxWidth: '100%', padding: '7px 12px', marginBottom: 16,
              background: 'rgba(255,255,255,0.05)', border: '1px solid #4a3a6a', borderRadius: 4,
              color: '#c9b99a', fontSize: 13, fontFamily: 'Georgia, serif', boxSizing: 'border-box',
            }}
          />

          <SectionTitle>Players ({humans.length})</SectionTitle>
          <div style={{ ...CARD_STYLE, padding: 0, marginBottom: 32, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ borderBottom: '1px solid #4a3a6a' }}>
                {['', 'Username', 'Gold', 'Income/harvest', 'Hexes', 'Troops', 'Streak', 'Last Login', 'Joined', 'Actions'].map(h => <th key={h} style={TH}>{h}</th>)}
              </tr></thead>
              <tbody>
                {humans.map(p => (
                  <tr key={p.id} style={ROW}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(80,40,160,0.08)'}
                    onMouseLeave={e => e.currentTarget.style.background = ''}>
                    <td style={TD}>{dot(p.color)}</td>
                    <td style={{ ...TD, fontWeight: 'bold' }}>{p.username}</td>
                    <td style={{ ...TD, color: '#c9a040' }}>{p.gold.toLocaleString()}</td>
                    <td style={{ ...TD, color: '#d4a843' }}>+{p.income_per_harvest ?? 0}g</td>
                    <td style={TD}>{p.hex_count}</td>
                    <td style={TD}>{p.total_troops}</td>
                    <td style={{ ...TD, color: '#8a9a8a' }}>{p.login_streak ?? 0}d</td>
                    <td style={{ ...TD, color: '#8a7a9a', fontSize: 12 }}>{p.last_login_date ? new Date(p.last_login_date).toLocaleDateString() : '-'}</td>
                    <td style={{ ...TD, color: '#8a7a9a', fontSize: 12 }}>{p.created_at ? new Date(p.created_at).toLocaleDateString() : '-'}</td>
                    <td style={TD}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        {goldTarget === p.id
                          ? <GoldInput playerId={p.id} secret={secret} onDone={() => { setGoldTarget(null); loadAll() }} />
                          : <button onClick={() => setGoldTarget(p.id)} style={btnStyle()}>± Gold</button>}
                        <button onClick={() => deletePlayer(p.id, p.username)} style={btnStyle('#3a1a2a', true)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <SectionTitle>Bots ({bots.length})</SectionTitle>
          <div style={{ ...CARD_STYLE, padding: 0, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ borderBottom: '1px solid #4a3a6a' }}>
                {['', 'Name', 'Gold', 'Income/harvest', 'Hexes', 'Troops'].map(h => <th key={h} style={TH}>{h}</th>)}
              </tr></thead>
              <tbody>
                {bots.map(p => (
                  <tr key={p.id} style={ROW}>
                    <td style={TD}>{dot(p.color)}</td>
                    <td style={{ ...TD, color: '#8a9a8a' }}>{p.username.slice(4)}</td>
                    <td style={{ ...TD, color: '#c9a040' }}>{p.gold.toLocaleString()}</td>
                    <td style={{ ...TD, color: '#d4a843' }}>+{p.income_per_harvest ?? 0}g</td>
                    <td style={TD}>{p.hex_count}</td>
                    <td style={TD}>{p.total_troops}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ─── Season ─── */}
      {tab === 'Season' && (
        <>
          <SectionTitle>Current Season</SectionTitle>
          <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
            <StatCard label="Season" value={system?.season ? `#${system.season.number}` : '-'} color="#d4a843" />
            <StatCard label="Resolution" value={system?.season?.hex_resolution ?? '-'} color="#8a9aff" />
            <StatCard label="Land Hexes (world)" value={system?.season ? Math.round(system.season.world_hex_count * 0.29).toLocaleString() : '-'} color="#6a9a6a" />
            <StatCard label="Claimed Hexes" value={overview?.total_hexes?.toLocaleString() ?? '-'} color="#c9a040" />
            <StatCard label="Started" value={system?.season ? new Date(system.season.started_at).toLocaleDateString() : '-'} color="#c9b99a" />
            <StatCard label="Ends In" value={system?.season ? until(system.season.ends_at) : '-'} color="#c9a040" />
          </div>

          <SectionTitle>Configure Next Season</SectionTitle>
          <div style={{ ...CARD_STYLE, marginBottom: 24, display: 'flex', gap: 32, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 12, color: '#8a7a9a', marginBottom: 8 }}>
                Duration (days) - the next season runs this long once it begins, then the default resumes.
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  type="number" min={1} max={365} placeholder={pendingDays != null ? `${pendingDays} (queued)` : 'default'}
                  value={daysInput} onChange={e => setDaysInput(e.target.value)}
                  style={{ width: 90, padding: '5px 8px', background: 'rgba(255,255,255,0.05)', border: '1px solid #4a3a6a', borderRadius: 4, color: '#c9b99a', fontSize: 13, fontFamily: 'Georgia, serif' }}
                />
                <button onClick={setNextDuration} style={btnStyle('#2a3a5a')} disabled={daysBusy || !daysInput}>
                  {daysBusy ? '…' : 'Queue Duration'}
                </button>
                {pendingDays != null && <span style={{ fontSize: 11, color: '#6a9a6a' }}>{pendingDays}d queued</span>}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#8a7a9a', marginBottom: 8 }}>
                H3 Resolution (0-15) - lower = fewer, bigger hexes. Strategic hexes, city zones, and bot spawns rebuild at the new resolution; players get a one-time reload when it takes effect.
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  type="number" min={0} max={15} placeholder={pendingResolution != null ? `${pendingResolution} (queued)` : '7'}
                  value={resolutionInput} onChange={e => setResolutionInput(e.target.value)}
                  style={{ width: 90, padding: '5px 8px', background: 'rgba(255,255,255,0.05)', border: '1px solid #4a3a6a', borderRadius: 4, color: '#c9b99a', fontSize: 13, fontFamily: 'Georgia, serif' }}
                />
                <button onClick={setNextResolution} style={btnStyle('#2a3a5a')} disabled={resolutionBusy || !resolutionInput}>
                  {resolutionBusy ? '…' : 'Queue Resolution'}
                </button>
                {pendingResolution != null && <span style={{ fontSize: 11, color: '#6a9a6a' }}>{pendingResolution} queued</span>}
              </div>
            </div>
          </div>

          <SectionTitle>Last 5 Seasons</SectionTitle>
          {historyBusy && !seasonHistory.length ? (
            <Empty>Loading…</Empty>
          ) : !seasonHistory.length ? (
            <Empty>No seasons have ended yet.</Empty>
          ) : (
            <div style={{ ...CARD_STYLE, padding: 0, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={ROW}>
                    <th style={TH}>Season</th>
                    <th style={TH}>Resolution</th>
                    <th style={TH}>Duration</th>
                    <th style={TH}>Ended</th>
                    <th style={TH}>Champion</th>
                    <th style={TH}>Champion Hexes</th>
                    <th style={TH}>Final Territory</th>
                    <th style={TH}>Battles</th>
                    <th style={TH}>Troops Lost</th>
                  </tr>
                </thead>
                <tbody>
                  {seasonHistory.map(s => {
                    const winner = Array.isArray(s.snapshot) ? s.snapshot[0] : null
                    const seconds = s.ended_at ? Math.floor((new Date(s.ended_at) - new Date(s.started_at)) / 1000) : null
                    return (
                      <tr key={s.id} style={ROW}>
                        <td style={TD}>#{s.number}</td>
                        <td style={TD}>{s.hex_resolution}</td>
                        <td style={TD}>{dur(seconds)}</td>
                        <td style={TD}>{s.ended_at ? new Date(s.ended_at).toLocaleDateString() : '-'}</td>
                        <td style={TD}>{s.winner_username ? <>{dot(s.winner_color)} {s.winner_username}</> : '-'}</td>
                        <td style={TD}>{winner?.hex_count ?? '-'}</td>
                        <td style={TD}>{s.stats?.final_hex_count?.toLocaleString() ?? '-'}</td>
                        <td style={TD}>{s.stats?.battles?.toLocaleString() ?? '-'}</td>
                        <td style={TD}>{s.stats?.troop_losses?.toLocaleString() ?? '-'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ─── World Map ─── */}
      {tab === 'World Map' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            <SectionTitle>All Claimed Hexes ({allHexes.length.toLocaleString()})</SectionTitle>
            <button onClick={loadWorldMap} style={btnStyle('#2a3a5a')} disabled={worldMapBusy}>
              {worldMapBusy ? 'Loading…' : '↻ Refresh'}
            </button>
            <button onClick={() => setMapView(MERC_FULL)} style={btnStyle('#2a3a5a')}>Reset View</button>
            <span style={{ fontSize: 11, color: '#8a7a9a' }}>
              Static snapshot at load time (hit Refresh to reload) - scroll to zoom, drag to pan.
            </span>
          </div>
          {!landOutline || worldMapBusy && !allHexes.length ? (
            <Empty>Loading…</Empty>
          ) : (
            <div style={{ ...CARD_STYLE, padding: 8 }}>
              <svg
                ref={mapSvgRef}
                viewBox={viewBoxStr(mapView)}
                onWheel={handleMapWheel}
                onMouseDown={handleMapMouseDown}
                onMouseMove={handleMapMouseMove}
                onMouseUp={stopMapDrag}
                onMouseLeave={stopMapDrag}
                style={{ width: '100%', height: 'auto', display: 'block', background: '#050310', cursor: 'grab', touchAction: 'none' }}
              >
                {landOutline.map((ring, i) => (
                  <polygon
                    key={i}
                    points={ring.map(([lng, lat]) => mercXY(lng, lat).join(',')).join(' ')}
                    fill="#1a1730" stroke="#2a2550" strokeWidth={0.5}
                  />
                ))}
                {allHexes.map(h => (
                  <polygon
                    key={h.h3_index}
                    points={hexPolygonPoints(h.h3_index)}
                    fill={h.color}
                    fillOpacity={h.is_capital ? 1 : 0.75}
                    stroke={h.is_capital ? '#fff' : 'none'}
                    strokeWidth={h.is_capital ? 0.6 : 0}
                  />
                ))}
              </svg>
            </div>
          )}
        </>
      )}

      {/* ─── System ─── */}
      {tab === 'System' && system && (
        <>
          <SectionTitle>Server</SectionTitle>
          <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
            <StatCard label="Mode" value={system.dev_mode ? 'DEV' : 'PROD'} color={system.dev_mode ? '#d4a843' : '#6a9a6a'} />
            <StatCard label="Tick Interval" value={`${(system.tick_interval_ms / 1000).toFixed(0)}s`} color="#8a9aff" />
            <StatCard label="Uptime" value={dur(system.uptime_seconds)} color="#c9b99a" />
            <StatCard label="Memory (RSS)" value={`${system.memory_mb} MB`} color="#ff8a6a" />
            <StatCard label="Node" value={system.node_version} color="#6a9a6a" />
          </div>
          <SectionTitle>Game State</SectionTitle>
          <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
            <StatCard label="Season" value={system.season ? `#${system.season.number}` : '-'} color="#d4a843" />
            <StatCard label="Season Ends" value={system.season ? until(system.season.ends_at) : '-'} color="#c9a040" />
            <StatCard label="Country Crowns" value={system.country_crowns} color="#9a7ad4" />
            <StatCard label="Chat Messages" value={system.chat_messages?.toLocaleString()} color="#8a9a8a" />
            <StatCard label="Training Queue" value={system.training_queued} color="#8a9a8a" />
            <StatCard label="Upgrade Queue" value={system.upgrade_queued} color="#8a9a8a" />
          </div>
          <div style={{ ...CARD_STYLE, fontSize: 12, color: '#8a7a9a' }}>
            Server time: {new Date(system.server_time).toLocaleString()}
          </div>
        </>
      )}
    </div>
  )
}

function Empty({ children }) {
  return <div style={{ ...CARD_STYLE, color: '#8a7a9a', textAlign: 'center', padding: '32px' }}>{children}</div>
}

function ActivityFeed({ items }) {
  if (!items.length) return <Empty>No world events yet.</Empty>
  return (
    <div style={{ ...CARD_STYLE, padding: 0 }}>
      {items.map((e, i) => (
        <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderTop: i ? '1px solid rgba(74,58,122,0.2)' : 'none' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: eventColor(e.type), flexShrink: 0 }} />
          <span style={{ fontSize: 10, color: eventColor(e.type), textTransform: 'uppercase', letterSpacing: 1, width: 64, flexShrink: 0 }}>{e.type}</span>
          <span style={{ flex: 1, fontSize: 13, color: '#c9b99a' }}>{e.message}</span>
          {e.hex_index && <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#4a3a6a' }}>{hex(e.hex_index)}</span>}
          <span style={{ fontSize: 11, color: '#8a7a9a', width: 70, textAlign: 'right', flexShrink: 0 }}>{ago(e.created_at)}</span>
        </div>
      ))}
    </div>
  )
}

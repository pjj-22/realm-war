import { useState, useEffect, useCallback } from 'react'

const BASE = (import.meta.env.VITE_API_URL || 'http://localhost:3001') + '/api/admin'

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
const EVENT_ICON = { plague: '🦠', meteor: '☄️', gold_rush: '💰', famine: '🍂', marauder_surge: '⚔️', revolt: '🚩' }
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
      <div style={{ fontSize: 11, color: '#6a5878', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 6 }}>{label}</div>
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
const TH = { padding: '10px 14px', textAlign: 'left', color: '#6a5878', fontWeight: 'normal', letterSpacing: 1, fontSize: 11, textTransform: 'uppercase' }
const TD = { padding: '8px 14px' }
const ROW = { borderBottom: '1px solid rgba(74,58,122,0.2)' }
const dot = c => <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: '50%', background: c, verticalAlign: 'middle' }} />

function SectionTitle({ children }) {
  return <div style={{ margin: '0 0 10px', fontSize: 13, color: '#8a7a9a', letterSpacing: 2, textTransform: 'uppercase' }}>{children}</div>
}

const TABS = ['Overview', 'Activity', 'Battles', 'Armies', 'Events', 'Players', 'System']

export default function AdminPortal() {
  const [secret, setSecret] = useState(() => sessionStorage.getItem('rw_admin_secret') || '')
  const [authed, setAuthed] = useState(false)
  const [authErr, setAuthErr] = useState('')
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState('Overview')
  const [auto, setAuto] = useState(true)
  const [lastUpdated, setLastUpdated] = useState(null)

  const [overview, setOverview] = useState(null)
  const [players, setPlayers] = useState([])
  const [activity, setActivity] = useState([])
  const [battles, setBattles] = useState([])
  const [armies, setArmies] = useState([])
  const [system, setSystem] = useState(null)

  const [tickBusy, setTickBusy] = useState(false)
  const [botBusy, setBotBusy] = useState(false)
  const [seasonBusy, setSeasonBusy] = useState(false)
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
      const [ov, pl, ac, ba, ar, sy, et] = await Promise.all([
        adminRequest('GET', '/overview', null, s),
        adminRequest('GET', '/players', null, s),
        adminRequest('GET', '/activity', null, s),
        adminRequest('GET', '/battles', null, s),
        adminRequest('GET', '/armies', null, s),
        adminRequest('GET', '/system', null, s),
        adminRequest('GET', '/events/types', null, s),
      ])
      setOverview(ov); setPlayers(pl); setActivity(ac); setBattles(ba); setArmies(ar); setSystem(sy)
      setEventTypes(et)
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

  // auto-refresh poller
  useEffect(() => {
    if (!authed || !auto) return
    const t = setInterval(() => loadAll(), 5000)
    return () => clearInterval(t)
  }, [authed, auto, loadAll])

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
          <div style={{ fontSize: 12, color: '#6a5878', letterSpacing: 3, marginBottom: 24 }}>ADMIN</div>
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
            <a href="/" style={{ color: '#6a5878' }}>← back to game</a>
          </div>
        </div>
      </div>
    )
  }

  const humans = players.filter(p => !p.username.startsWith('BOT_'))
  const bots = players.filter(p => p.username.startsWith('BOT_'))

  return (
    <div style={{ minHeight: '100vh', background: '#0a0818', color: '#c9b99a', fontFamily: 'Georgia, serif', padding: '24px 32px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <span style={{ fontSize: 22, letterSpacing: 2 }}>REALM WAR</span>
          <span style={{ fontSize: 12, color: '#6a5878', letterSpacing: 3, marginLeft: 12 }}>ADMIN PORTAL</span>
          {system && (
            <span style={{ fontSize: 11, marginLeft: 14, color: system.dev_mode ? '#d4a843' : '#6a9a6a', border: `1px solid ${system.dev_mode ? '#6a5320' : '#2a4a2a'}`, borderRadius: 4, padding: '2px 8px', letterSpacing: 1 }}>
              {system.dev_mode ? 'DEV MODE' : 'PRODUCTION'}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#6a5878' }}>updated {lastUpdated ? ago(lastUpdated) : '-'}</span>
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
              color: active ? '#d4c9a8' : '#6a5878', cursor: 'pointer', fontSize: 14, fontFamily: 'Georgia, serif', letterSpacing: 1,
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
            <StatCard label="Upgrades Queue" value={overview.upgrade_queued} color="#8a9a8a" />
          </div>
          <SectionTitle>Recent Activity</SectionTitle>
          <ActivityFeed items={activity.slice(0, 12)} />
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
                        <td style={{ ...TD, color: '#6a5878', fontSize: 12 }}>{ago(b.created_at)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>}
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
                        <td style={TD}>{dot(a.color)} <span style={{ marginLeft: 6 }}>{a.username.replace(/^BOT_/, '🤖 ')}</span></td>
                        <td style={{ ...TD, color: '#8a7a9a' }}>{a.type}</td>
                        <td style={{ ...TD, color: '#ff8a6a' }}>{a.quantity}</td>
                        <td style={{ ...TD, fontFamily: 'monospace', color: '#6a5878' }}>{hex(a.from_hex)}</td>
                        <td style={{ ...TD, fontFamily: 'monospace', color: '#8a7a9a' }}>{hex(a.to_hex)}</td>
                        <td style={{ ...TD, color: soon ? '#ff4a6a' : '#c9a040' }}>{until(a.arrives_at)}</td>
                        <td style={{ ...TD, color: '#6a5878', fontSize: 12 }}>{ago(a.departed_at)}</td>
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
                    <span style={{ fontSize: 22 }}>{EVENT_ICON[type] || '✦'}</span>
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
                  <span style={{ fontSize: 16 }}>{EVENT_ICON[e.type] || '✦'}</span>
                  <span style={{ flex: 1, fontSize: 13, color: '#c9b99a' }}>{e.headline}</span>
                  {e.notified > 0 && <span style={{ fontSize: 11, color: '#6a9a6a' }}>{e.notified} notified</span>}
                  <span style={{ fontSize: 11, color: '#6a5878', width: 70, textAlign: 'right' }}>{ago(e.at)}</span>
                </div>
              ))}
            </div>}
        </>
      )}

      {/* ─── Players ─── */}
      {tab === 'Players' && (
        <>
          <SectionTitle>Players ({humans.length})</SectionTitle>
          <div style={{ ...CARD_STYLE, padding: 0, marginBottom: 32, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ borderBottom: '1px solid #4a3a6a' }}>
                {['', 'Username', 'Gold', 'Hexes', 'Troops', 'Streak', 'Last Login', 'Joined', 'Actions'].map(h => <th key={h} style={TH}>{h}</th>)}
              </tr></thead>
              <tbody>
                {humans.map(p => (
                  <tr key={p.id} style={ROW}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(80,40,160,0.08)'}
                    onMouseLeave={e => e.currentTarget.style.background = ''}>
                    <td style={TD}>{dot(p.color)}</td>
                    <td style={{ ...TD, fontWeight: 'bold' }}>{p.username}</td>
                    <td style={{ ...TD, color: '#c9a040' }}>{p.gold.toLocaleString()}</td>
                    <td style={TD}>{p.hex_count}</td>
                    <td style={TD}>{p.total_troops}</td>
                    <td style={{ ...TD, color: '#8a9a8a' }}>{p.login_streak ?? 0}d</td>
                    <td style={{ ...TD, color: '#6a5878', fontSize: 12 }}>{p.last_login_date ? new Date(p.last_login_date).toLocaleDateString() : '-'}</td>
                    <td style={{ ...TD, color: '#6a5878', fontSize: 12 }}>{p.created_at ? new Date(p.created_at).toLocaleDateString() : '-'}</td>
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
                {['', 'Name', 'Gold', 'Hexes', 'Troops'].map(h => <th key={h} style={TH}>{h}</th>)}
              </tr></thead>
              <tbody>
                {bots.map(p => (
                  <tr key={p.id} style={ROW}>
                    <td style={TD}>{dot(p.color)}</td>
                    <td style={{ ...TD, color: '#8a9a8a' }}>{p.username.slice(4)}</td>
                    <td style={{ ...TD, color: '#c9a040' }}>{p.gold.toLocaleString()}</td>
                    <td style={TD}>{p.hex_count}</td>
                    <td style={TD}>{p.total_troops}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
          <div style={{ ...CARD_STYLE, fontSize: 12, color: '#6a5878' }}>
            Server time: {new Date(system.server_time).toLocaleString()}
          </div>
        </>
      )}
    </div>
  )
}

function Empty({ children }) {
  return <div style={{ ...CARD_STYLE, color: '#6a5878', textAlign: 'center', padding: '32px' }}>{children}</div>
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
          <span style={{ fontSize: 11, color: '#6a5878', width: 70, textAlign: 'right', flexShrink: 0 }}>{ago(e.created_at)}</span>
        </div>
      ))}
    </div>
  )
}

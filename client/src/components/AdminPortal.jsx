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

function StatCard({ label, value, color = '#c9b99a' }) {
  return (
    <div style={{ ...CARD_STYLE, minWidth: 140 }}>
      <div style={{ fontSize: 11, color: '#6a5878', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 28, color, fontFamily: 'Georgia, serif' }}>{value ?? '-'}</div>
    </div>
  )
}

function GoldInput({ playerId, current, secret, onDone }) {
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

function btnStyle(bg = '#3a2a6a', danger = false) {
  return {
    padding: '4px 10px', background: danger ? '#5a1a2a' : bg,
    border: `1px solid ${danger ? '#8a2a3a' : '#6a4a9a'}`,
    borderRadius: 4, color: '#c9b99a', cursor: 'pointer',
    fontSize: 12, fontFamily: 'Georgia, serif',
  }
}

export default function AdminPortal() {
  const [secret, setSecret] = useState(() => sessionStorage.getItem('rw_admin_secret') || '')
  const [authed, setAuthed] = useState(false)
  const [authErr, setAuthErr] = useState('')
  const [overview, setOverview] = useState(null)
  const [players, setPlayers] = useState([])
  const [loading, setLoading] = useState(false)
  const [tickBusy, setTickBusy] = useState(false)
  const [botBusy, setBotBusy] = useState(false)
  const [goldTarget, setGoldTarget] = useState(null)

  const load = useCallback(async (s = secret) => {
    setLoading(true)
    try {
      const [ov, pl] = await Promise.all([
        adminRequest('GET', '/overview', null, s),
        adminRequest('GET', '/players', null, s),
      ])
      setOverview(ov)
      setPlayers(pl)
      setAuthed(true)
      setAuthErr('')
      sessionStorage.setItem('rw_admin_secret', s)
    } catch (e) {
      setAuthErr(e.message)
      setAuthed(false)
    }
    setLoading(false)
  }, [secret])

  useEffect(() => {
    if (secret) load(secret)
  }, [])

  async function forceTick() {
    setTickBusy(true)
    try { await adminRequest('POST', '/tick', null, secret); await load() }
    catch (e) { alert(e.message) }
    setTickBusy(false)
  }

  async function resetBots() {
    if (!confirm('Wipe and re-seed all bots?')) return
    setBotBusy(true)
    try { await adminRequest('POST', '/bots/reset', null, secret); await load() }
    catch (e) { alert(e.message) }
    setBotBusy(false)
  }

  const [seasonBusy, setSeasonBusy] = useState(false)
  async function endSeason() {
    if (!confirm('End the current season NOW? Standings freeze, a Champion is crowned, and the entire map resets.')) return
    setSeasonBusy(true)
    try {
      const r = await adminRequest('POST', '/season/end', null, secret)
      alert(`Season ${r.ended} ended. A new age begins.`)
      await load()
    } catch (e) { alert(e.message) }
    setSeasonBusy(false)
  }

  async function deletePlayer(id, username) {
    if (!confirm(`Delete ${username}? This removes all their hexes, troops, and buildings.`)) return
    try { await adminRequest('DELETE', `/players/${id}`, null, secret); await load() }
    catch (e) { alert(e.message) }
  }

  if (!authed) {
    return (
      <div style={{
        position: 'fixed', inset: 0, background: '#0a0818',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'Georgia, serif', color: '#c9b99a',
      }}>
        <div style={{ ...CARD_STYLE, width: 320, textAlign: 'center' }}>
          <div style={{ fontSize: 20, marginBottom: 4, letterSpacing: 2 }}>REALM WAR</div>
          <div style={{ fontSize: 12, color: '#6a5878', letterSpacing: 3, marginBottom: 24 }}>ADMIN</div>
          <input
            type="password"
            value={secret}
            onChange={e => setSecret(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && load(secret)}
            placeholder="Admin secret"
            autoFocus
            style={{
              width: '100%', padding: '8px 12px', marginBottom: 12,
              background: 'rgba(255,255,255,0.05)', border: '1px solid #4a3a6a',
              borderRadius: 4, color: '#c9b99a', fontSize: 14, fontFamily: 'Georgia, serif',
              boxSizing: 'border-box',
            }}
          />
          {authErr && <div style={{ color: '#c04040', fontSize: 13, marginBottom: 10 }}>{authErr}</div>}
          <button onClick={() => load(secret)} disabled={loading} style={{ ...btnStyle(), width: '100%', padding: '8px 0', fontSize: 14 }}>
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
    <div style={{
      minHeight: '100vh', background: '#0a0818', color: '#c9b99a',
      fontFamily: 'Georgia, serif', padding: '24px 32px',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <span style={{ fontSize: 22, letterSpacing: 2 }}>REALM WAR</span>
          <span style={{ fontSize: 12, color: '#6a5878', letterSpacing: 3, marginLeft: 12 }}>ADMIN PORTAL</span>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button onClick={() => load()} style={btnStyle()} disabled={loading}>
            {loading ? '…' : '↻ Refresh'}
          </button>
          <button onClick={forceTick} style={btnStyle('#2a3a5a')} disabled={tickBusy}>
            {tickBusy ? 'Ticking…' : 'Force Tick'}
          </button>
          <button onClick={resetBots} style={btnStyle('#3a2a1a')} disabled={botBusy}>
            {botBusy ? 'Resetting…' : 'Reset Bots'}
          </button>
          <button onClick={endSeason} style={btnStyle('#5a2a2a')} disabled={seasonBusy}>
            {seasonBusy ? 'Ending…' : 'End Season'}
          </button>
          <a href="/" style={{ ...btnStyle(), textDecoration: 'none', fontSize: 12 }}>← Game</a>
        </div>
      </div>

      {/* Overview cards */}
      {overview && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 32, flexWrap: 'wrap' }}>
          <StatCard label="Human Players" value={overview.human_players} color="#8a9aff" />
          <StatCard label="Hexes Claimed" value={overview.total_hexes} color="#c9a040" />
          <StatCard label="Active Armies" value={overview.active_armies} color="#ff8a6a" />
          <StatCard label="Active Battles" value={overview.active_battles} color="#ff4a6a" />
          <StatCard label="Bots" value={bots.length} color="#6a9a6a" />
        </div>
      )}

      {/* Players table */}
      <div style={{ marginBottom: 10, fontSize: 13, color: '#8a7a9a', letterSpacing: 2, textTransform: 'uppercase' }}>
        Players ({humans.length})
      </div>
      <div style={{ ...CARD_STYLE, padding: 0, marginBottom: 32, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #4a3a6a' }}>
              {['', 'Username', 'Gold', 'Hexes', 'Troops', 'Streak', 'Last Login', 'Joined', 'Actions'].map(h => (
                <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: '#6a5878', fontWeight: 'normal', letterSpacing: 1, fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {humans.map(p => (
              <tr key={p.id} style={{ borderBottom: '1px solid rgba(74,58,122,0.2)' }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(80,40,160,0.08)'}
                onMouseLeave={e => e.currentTarget.style.background = ''}>
                <td style={{ padding: '8px 14px' }}>
                  <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: '50%', background: p.color }} />
                </td>
                <td style={{ padding: '8px 14px', fontWeight: 'bold' }}>{p.username}</td>
                <td style={{ padding: '8px 14px', color: '#c9a040' }}>{p.gold.toLocaleString()}</td>
                <td style={{ padding: '8px 14px' }}>{p.hex_count}</td>
                <td style={{ padding: '8px 14px' }}>{p.total_troops}</td>
                <td style={{ padding: '8px 14px', color: '#8a9a8a' }}>{p.login_streak ?? 0}d</td>
                <td style={{ padding: '8px 14px', color: '#6a5878', fontSize: 12 }}>
                  {p.last_login_date ? new Date(p.last_login_date).toLocaleDateString() : '-'}
                </td>
                <td style={{ padding: '8px 14px', color: '#6a5878', fontSize: 12 }}>
                  {p.created_at ? new Date(p.created_at).toLocaleDateString() : '-'}
                </td>
                <td style={{ padding: '8px 14px' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {goldTarget === p.id
                      ? <GoldInput playerId={p.id} current={p.gold} secret={secret} onDone={() => { setGoldTarget(null); load() }} />
                      : <button onClick={() => setGoldTarget(p.id)} style={btnStyle()}>± Gold</button>
                    }
                    <button onClick={() => deletePlayer(p.id, p.username)} style={btnStyle('#3a1a2a', true)}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Bots table */}
      <div style={{ marginBottom: 10, fontSize: 13, color: '#8a7a9a', letterSpacing: 2, textTransform: 'uppercase' }}>
        Bots ({bots.length})
      </div>
      <div style={{ ...CARD_STYLE, padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #4a3a6a' }}>
              {['', 'Name', 'Gold', 'Hexes', 'Troops'].map(h => (
                <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: '#6a5878', fontWeight: 'normal', letterSpacing: 1, fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bots.map(p => (
              <tr key={p.id} style={{ borderBottom: '1px solid rgba(74,58,122,0.2)' }}>
                <td style={{ padding: '8px 14px' }}>
                  <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: '50%', background: p.color }} />
                </td>
                <td style={{ padding: '8px 14px', color: '#8a9a8a' }}>{p.username.slice(4)}</td>
                <td style={{ padding: '8px 14px', color: '#c9a040' }}>{p.gold.toLocaleString()}</td>
                <td style={{ padding: '8px 14px' }}>{p.hex_count}</td>
                <td style={{ padding: '8px 14px' }}>{p.total_troops}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

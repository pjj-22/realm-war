import { useState, useRef, useEffect } from 'react'
import { api } from '../api/client.js'
import { useSocket } from '../hooks/useSocket'
import { getPushStatus, enablePush, disablePush } from '../push.js'
import { toast } from './Toast'

const TYPE_ICON = {
  battle_won:        '🏆',
  battle_lost:       '☠',
  hex_lost:          '💀',
  training_complete: '✅',
  capital_lost:      '👑',
  incoming_attack:   '🏹',
  under_attack:      '🔥',
  crown:             '👑',
  plunder:           '💰',
  decay:             '🍂',
}

function relTime(ts) {
  const secs = Math.floor((Date.now() - new Date(ts)) / 1000)
  if (secs < 60)  return `${secs}s ago`
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

function PushToggle() {
  const [status, setStatus] = useState('unsupported')
  useEffect(() => { getPushStatus().then(setStatus).catch(() => {}) }, [])

  if (status === 'unsupported') return null

  async function toggle() {
    try {
      if (status === 'on') {
        await disablePush()
        setStatus('off')
        toast('Push notifications off')
      } else {
        await enablePush()
        setStatus('on')
        toast('You\'ll be alerted when your realm is attacked', 'success')
      }
    } catch (err) {
      toast(err.message)
      getPushStatus().then(setStatus).catch(() => {})
    }
  }

  return (
    <button
      onClick={toggle}
      title={status === 'on' ? 'Disable attack alerts' : 'Get notified when your realm is under attack'}
      style={{
        background: 'none', border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 4, color: status === 'on' ? '#c9a040' : '#7a6890',
        cursor: status === 'blocked' ? 'not-allowed' : 'pointer',
        fontSize: 11, padding: '2px 8px', fontFamily: 'Georgia, serif',
        opacity: status === 'blocked' ? 0.5 : 1,
      }}>
      {status === 'on' ? '🔔 alerts on' : status === 'blocked' ? '🔕 blocked' : '🔕 alerts off'}
    </button>
  )
}

export default function EventFeed() {
  const [open, setOpen]     = useState(false)
  const [tab, setTab]       = useState('empire') // 'empire' | 'herald'
  const [count, setCount]   = useState(0)
  const [events, setEvents] = useState([])
  const [world, setWorld]   = useState([])
  const [popups, setPopups] = useState([])
  const openRef             = useRef(false)
  const tabRef              = useRef('empire')
  const seenRef             = useRef(null)
  openRef.current = open
  tabRef.current = tab

  // Seed seen-event ids so we only pop genuinely new dispatches
  useEffect(() => {
    api.peekEvents()
      .then(evs => { seenRef.current = new Set(evs.map(e => e.id)) })
      .catch(() => { seenRef.current = new Set() })
  }, [])

  useSocket({
    'events:new': async () => {
      if (openRef.current && tabRef.current === 'empire') {
        try { setEvents(await api.getEvents()) } catch { /* offline */ }
        return
      }
      setCount(c => c + 1)
      // Transient popups on the right edge for new dispatches
      try {
        const evs = await api.peekEvents()
        if (!seenRef.current) return
        const fresh = evs.filter(e => !seenRef.current.has(e.id)).slice(0, 3)
        fresh.forEach(e => seenRef.current.add(e.id))
        if (fresh.length > 0) {
          setPopups(p => [...p, ...fresh].slice(-4))
          fresh.forEach(e =>
            setTimeout(() => setPopups(p => p.filter(x => x.id !== e.id)), 6000)
          )
        }
      } catch { /* offline */ }
    },
    'world:new': async () => {
      if (openRef.current && tabRef.current === 'herald') {
        try { setWorld(await api.getWorldEvents()) } catch { /* offline */ }
      }
    },
  })

  const openFeed = async () => {
    setOpen(true)
    try {
      const [ev, w] = await Promise.all([api.getEvents(), api.getWorldEvents()])
      setEvents(ev)
      setWorld(w)
      setCount(0)
    } catch { /* offline */ }
  }

  const tabBtn = (id, label) => (
    <button
      onClick={() => setTab(id)}
      style={{
        flex: 1, padding: '6px 0', background: 'none',
        border: 'none', borderBottom: tab === id ? '2px solid #a070e0' : '2px solid transparent',
        color: tab === id ? '#c0a0f0' : '#6a5878',
        cursor: 'pointer', fontSize: 12, letterSpacing: 2, textTransform: 'uppercase',
        fontFamily: 'Georgia, serif',
      }}>
      {label}
    </button>
  )

  const rows = tab === 'empire' ? events : world

  return (
    <div style={{ position: 'relative' }}>
      {/* Transient dispatch popups - slide in from the right, fade out */}
      {popups.length > 0 && (
        <div style={{
          position: 'fixed', top: 56, right: 8, zIndex: 90,
          display: 'flex', flexDirection: 'column', gap: 8,
          pointerEvents: 'none',
        }}>
          {popups.map(ev => (
            <div
              key={ev.id}
              onClick={openFeed}
              style={{
                pointerEvents: 'auto', cursor: 'pointer',
                width: 'min(300px, calc(100vw - 16px))',
                background: 'rgba(15,10,28,0.96)',
                border: '1px solid rgba(160,110,200,0.4)',
                borderRadius: 6, padding: '10px 14px',
                boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
                display: 'flex', gap: 10, alignItems: 'flex-start',
                fontFamily: 'Georgia, serif',
                animation: 'rw-notif 6s ease forwards',
              }}>
              <span style={{ fontSize: 15, flexShrink: 0 }}>{TYPE_ICON[ev.type] || '·'}</span>
              <span style={{ fontSize: 13, color: '#c4b498', lineHeight: 1.45, wordBreak: 'break-word' }}>
                {ev.message}
              </span>
            </div>
          ))}
        </div>
      )}
      <button
        onClick={open ? () => setOpen(false) : openFeed}
        style={{
          background: open ? 'rgba(40,30,60,0.9)' : 'none',
          border: open ? '1px solid rgba(255,255,255,0.1)' : 'none',
          borderRadius: 6,
          color: '#c9b99a',
          padding: '4px 8px',
          cursor: 'pointer',
          fontSize: 16,
          position: 'relative',
          lineHeight: 1,
        }}
        title="Notifications"
      >
        🔔
        {count > 0 && (
          <span style={{
            position: 'absolute',
            top: -3, right: -3,
            background: '#cc3333',
            color: '#fff',
            borderRadius: '50%',
            fontSize: 9,
            fontWeight: 'bold',
            minWidth: 14,
            height: 14,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 2px',
          }}>{count}</span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'fixed',
          top: 54,
          right: 8,
          background: 'rgba(8,6,20,0.97)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 6,
          width: 'min(320px, calc(100vw - 16px))',
          maxHeight: 420,
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
          zIndex: 100,
          fontFamily: 'Georgia, serif',
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '8px 12px',
            borderBottom: '1px solid rgba(255,255,255,0.07)',
            fontSize: 14,
            letterSpacing: 2,
            textTransform: 'uppercase',
            color: '#7a6890',
          }}>
            <span>Dispatches</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <PushToggle />
              <button onClick={() => setOpen(false)} style={{
                background: 'none', border: 'none', color: '#7a6890',
                cursor: 'pointer', fontSize: 18, lineHeight: 1,
              }}>×</button>
            </div>
          </div>

          <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            {tabBtn('empire', 'Your Empire')}
            {tabBtn('herald', '🗞 The Herald')}
          </div>

          <div style={{ overflowY: 'auto', flex: 1 }}>
            {rows.length === 0 ? (
              <div style={{ padding: 16, color: '#6a5878', fontSize: 14, textAlign: 'center' }}>
                {tab === 'empire' ? 'No dispatches' : 'The world is quiet… for now'}
              </div>
            ) : rows.map(ev => (
              <div key={`${tab}-${ev.id}`} style={{
                padding: '9px 12px',
                borderBottom: '1px solid rgba(255,255,255,0.04)',
                display: 'flex',
                gap: 10,
                alignItems: 'flex-start',
                background: tab === 'empire' && !ev.read ? 'rgba(80,50,20,0.2)' : 'transparent',
              }}>
                {tab === 'empire' && (
                  <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>
                    {TYPE_ICON[ev.type] || '·'}
                  </span>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, color: '#c4b498', wordBreak: 'break-word' }}>
                    {ev.message}
                  </div>
                  <div style={{ fontSize: 12, color: '#6a5878', marginTop: 3 }}>
                    {relTime(ev.created_at)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

import { useState, useEffect, useRef } from 'react'
import { api } from '../api/client.js'

const TYPE_ICON = {
  battle_won:        '🏆',
  battle_lost:       '☠',
  hex_lost:          '💀',
  training_complete: '✅',
  capital_lost:      '👑',
}

function relTime(ts) {
  const secs = Math.floor((Date.now() - new Date(ts)) / 1000)
  if (secs < 60)  return `${secs}s ago`
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

export default function EventFeed() {
  const [open, setOpen]     = useState(false)
  const [count, setCount]   = useState(0)
  const [events, setEvents] = useState([])
  const pollRef             = useRef(null)

  // Poll unread count every 10s
  useEffect(() => {
    const fetchCount = async () => {
      try {
        const data = await api.getEventCount()
        setCount(data.count)
      } catch { /* ignore */ }
    }
    fetchCount()
    pollRef.current = setInterval(fetchCount, 10_000)
    return () => clearInterval(pollRef.current)
  }, [])

  const openFeed = async () => {
    setOpen(true)
    try {
      const data = await api.getEvents()
      setEvents(data)
      setCount(0)
    } catch { /* ignore */ }
  }

  return (
    <div style={{ position: 'relative' }}>
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
          position: 'absolute',
          top: 'calc(100% + 6px)',
          right: 0,
          background: 'rgba(8,6,20,0.97)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 6,
          width: 300,
          maxHeight: 380,
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
            fontSize: 11,
            letterSpacing: 2,
            textTransform: 'uppercase',
            color: '#7a6890',
          }}>
            <span>Notifications</span>
            <button onClick={() => setOpen(false)} style={{
              background: 'none', border: 'none', color: '#7a6890',
              cursor: 'pointer', fontSize: 18, lineHeight: 1,
            }}>×</button>
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {events.length === 0 ? (
              <div style={{ padding: 16, color: '#6a5878', fontSize: 12, textAlign: 'center' }}>
                No notifications
              </div>
            ) : events.map(ev => (
              <div key={ev.id} style={{
                padding: '9px 12px',
                borderBottom: '1px solid rgba(255,255,255,0.04)',
                display: 'flex',
                gap: 10,
                alignItems: 'flex-start',
                background: ev.read ? 'transparent' : 'rgba(80,50,20,0.2)',
              }}>
                <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>
                  {TYPE_ICON[ev.type] || '·'}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: '#c4b498', wordBreak: 'break-word' }}>
                    {ev.message}
                  </div>
                  <div style={{ fontSize: 10, color: '#6a5878', marginTop: 3 }}>
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

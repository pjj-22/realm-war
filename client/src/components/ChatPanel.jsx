import { useState, useRef, useEffect } from 'react'
import { api } from '../api/client'
import { useSocket } from '../hooks/useSocket'

function relTime(ts) {
  const secs = Math.floor((Date.now() - new Date(ts)) / 1000)
  if (secs < 60)  return 'now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`
  return `${Math.floor(secs / 86400)}d`
}

export default function ChatPanel({ player, alliance }) {
  const [open, setOpen] = useState(false)
  const [channel, setChannel] = useState('global')
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [unread, setUnread] = useState(false)
  const openRef = useRef(false)
  const channelRef = useRef('global')
  const listRef = useRef(null)
  openRef.current = open
  channelRef.current = channel

  async function load(ch = channelRef.current) {
    try {
      const msgs = await api.getChat(ch)
      setMessages(msgs)
      requestAnimationFrame(() => {
        if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
      })
    } catch { /* offline */ }
  }

  useSocket({
    'chat:new': ({ channel: ch, allianceId } = {}) => {
      // Ignore other alliances' chatter
      if (ch === 'alliance' && allianceId !== alliance?.id) return
      if (openRef.current && ch === channelRef.current) load(ch)
      else if (ch === 'global' || allianceId === alliance?.id) setUnread(true)
    },
  })

  useEffect(() => { if (open) { load(channel); setUnread(false) } }, [open, channel])

  async function send(e) {
    e.preventDefault()
    const t = text.trim()
    if (!t) return
    setText('')
    try {
      await api.sendChat(channel, t)
      load(channel)
    } catch { /* dropped */ }
  }

  if (!player) return null

  const tabBtn = (id, label) => (
    <button
      onClick={() => setChannel(id)}
      style={{
        flex: 1, padding: '5px 0', background: 'none', border: 'none',
        borderBottom: channel === id ? '2px solid #a070e0' : '2px solid transparent',
        color: channel === id ? '#c0a0f0' : '#6a5878',
        cursor: 'pointer', fontSize: 11, letterSpacing: 2, textTransform: 'uppercase',
        fontFamily: 'Georgia, serif',
      }}>
      {label}
    </button>
  )

  return (
    <>
      <button
        onClick={() => setOpen(o => !o)}
        title="Chat"
        style={{
          position: 'absolute', bottom: 16, left: 16, zIndex: 18,
          width: 42, height: 42, borderRadius: '50%',
          background: open ? 'rgba(60,40,110,0.95)' : 'rgba(15,10,32,0.92)',
          border: '1px solid #4a3a7a', color: '#c9b99a',
          fontSize: 18, cursor: 'pointer',
          boxShadow: '0 2px 12px rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
        💬
        {unread && !open && (
          <span style={{
            position: 'absolute', top: 0, right: 0,
            width: 10, height: 10, borderRadius: '50%',
            background: '#cc3333', border: '1px solid #1a1020',
          }} />
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', bottom: 66, left: 16, zIndex: 18,
          width: 'min(320px, calc(100vw - 32px))', height: 340,
          background: 'rgba(8,6,20,0.97)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 8,
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
          fontFamily: 'Georgia, serif',
        }}>
          <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            {tabBtn('global', '🌍 World')}
            {alliance && tabBtn('alliance', `🤝 ${alliance.tag}`)}
          </div>

          <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '6px 10px' }}>
            {messages.length === 0 && (
              <div style={{ color: '#6a5878', fontSize: 13, textAlign: 'center', paddingTop: 20 }}>
                {channel === 'global' ? 'Silence across the realm. Say something.' : 'No alliance chatter yet.'}
              </div>
            )}
            {messages.map(m => (
              <div key={m.id} style={{ marginBottom: 7, fontSize: 13, lineHeight: 1.45 }}>
                <span style={{ color: m.color || '#9a8aaa', fontWeight: 'bold' }}>
                  {m.tag ? `[${m.tag}] ` : ''}{m.username}
                </span>
                <span style={{ color: '#5a4868', fontSize: 11 }}> · {relTime(m.created_at)}</span>
                <div style={{ color: '#c4b498', wordBreak: 'break-word' }}>{m.text}</div>
              </div>
            ))}
          </div>

          <form onSubmit={send} style={{ display: 'flex', gap: 6, padding: 8, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
            <input
              value={text}
              onChange={e => setText(e.target.value)}
              maxLength={240}
              placeholder={channel === 'global' ? 'Message the world…' : 'Message your alliance…'}
              style={{
                flex: 1, padding: '6px 10px',
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 4, color: '#c4b498', fontFamily: 'Georgia, serif', fontSize: 13, outline: 'none',
              }}
            />
            <button type="submit" style={{
              padding: '6px 12px', background: 'rgba(80,50,160,0.3)',
              border: '1px solid rgba(120,80,200,0.3)', borderRadius: 4,
              color: '#c4b498', cursor: 'pointer', fontSize: 13, fontFamily: 'Georgia, serif',
            }}>
              ➤
            </button>
          </form>
        </div>
      )}
    </>
  )
}

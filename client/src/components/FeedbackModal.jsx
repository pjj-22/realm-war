import { useState } from 'react'
import { api } from '../api/client'
import { useViewportOverlayFix } from '../hooks/useViewportOverlayFix'
import { toast } from '../toastBus'
import { theme } from '../theme'

const MAX_LENGTH = 2000
const CATEGORIES = [
  { id: 'idea', label: 'Idea' },
  { id: 'bug', label: 'Bug' },
  { id: 'other', label: 'Other' },
]

const S = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 230, padding: 16,
  },
  box: {
    background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 8,
    padding: '28px 32px', width: '100%', maxWidth: 440,
    maxHeight: '100%', overflowY: 'auto',
    fontFamily: 'Georgia, serif', color: theme.text.primary, position: 'relative',
    boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
  },
  title: {
    fontSize: 20, letterSpacing: 4, textTransform: 'uppercase',
    textAlign: 'center', marginBottom: 4, color: theme.text.primary,
    fontFamily: theme.headerFont,
  },
  sub: { fontSize: 12, color: theme.text.secondary, textAlign: 'center', marginBottom: 18 },
  chips: { display: 'flex', gap: 8, marginBottom: 10 },
  chip: (on) => ({
    flex: 1, padding: '7px 0', borderRadius: 5, cursor: 'pointer',
    background: on ? theme.accent : 'rgba(255,255,255,0.05)',
    border: `1px solid ${on ? theme.accentStrong : theme.border}`,
    color: on ? theme.accentText : theme.text.secondary,
    fontSize: 12, letterSpacing: 2, textTransform: 'uppercase', fontFamily: theme.headerFont,
  }),
  text: {
    width: '100%', minHeight: 130, padding: '9px 12px', resize: 'vertical',
    background: 'rgba(255,255,255,0.05)', border: `1px solid ${theme.border}`,
    borderRadius: 4, color: theme.text.primary, fontSize: 14,
    fontFamily: 'Georgia, serif', outline: 'none', boxSizing: 'border-box',
  },
  count: { fontSize: 11, color: theme.text.tertiary, textAlign: 'right', marginTop: 2 },
  btn: {
    width: '100%', padding: '10px', marginTop: 10,
    background: theme.accent, border: `1px solid ${theme.accentStrong}`,
    borderRadius: 5, color: theme.accentText, fontSize: 12, fontWeight: 600,
    letterSpacing: 2, textTransform: 'uppercase',
    fontFamily: theme.headerFont, cursor: 'pointer',
  },
  err: { color: theme.danger, fontSize: 12, marginTop: 8, textAlign: 'center' },
}

export default function FeedbackModal({ onClose }) {
  const overlayRef = useViewportOverlayFix()
  const [category, setCategory] = useState('idea')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  async function send() {
    setErr(null); setBusy(true)
    try {
      await api.sendFeedback(category, message.trim())
      toast('Thanks - feedback sent.', 'success')
      onClose()
    } catch (e) {
      setErr(e.message || 'Could not send')
      setBusy(false)
    }
  }

  return (
    <div ref={overlayRef} style={S.overlay} onClick={onClose}>
      <div style={S.box} onClick={e => e.stopPropagation()}>
        <button
          onClick={onClose}
          style={{ position: 'absolute', top: 14, right: 18, background: 'none', border: 'none', color: theme.text.secondary, fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>
          ×
        </button>
        <div style={S.title}>Feedback</div>
        <div style={S.sub}>Something broken, confusing, or missing? Tell us.</div>
        <div style={S.chips}>
          {CATEGORIES.map(c => (
            <button key={c.id} style={S.chip(category === c.id)} onClick={() => setCategory(c.id)}>{c.label}</button>
          ))}
        </div>
        <textarea
          style={S.text} value={message} autoFocus maxLength={MAX_LENGTH}
          onChange={e => setMessage(e.target.value)}
          placeholder="What's on your mind?"
        />
        <div style={S.count}>{message.length}/{MAX_LENGTH}</div>
        <button style={{ ...S.btn, opacity: busy || !message.trim() ? 0.5 : 1 }} onClick={send} disabled={busy || !message.trim()}>
          {busy ? 'Sending...' : 'Send'}
        </button>
        {err && <div style={S.err}>{err}</div>}
      </div>
    </div>
  )
}

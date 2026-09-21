import { useState } from 'react'
import { api } from '../api/client'
import { useViewportOverlayFix } from '../hooks/useViewportOverlayFix'
import LegalModal from './LegalModal'
import FeedbackModal from './FeedbackModal'
import { theme } from '../theme'

const S = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 220, padding: 16,
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
  sub: { fontSize: 12, color: theme.text.secondary, textAlign: 'center', marginBottom: 22 },
  h: { fontSize: 13, letterSpacing: 2, textTransform: 'uppercase', color: theme.accentStrong, margin: '18px 0 6px', fontFamily: theme.headerFont },
  p: { fontSize: 13, lineHeight: 1.6, color: theme.text.secondary, marginBottom: 10 },
  btn: {
    width: '100%', padding: '10px', marginTop: 4,
    background: theme.accent, border: `1px solid ${theme.accentStrong}`,
    borderRadius: 5, color: theme.accentText, fontSize: 12, fontWeight: 600,
    letterSpacing: 2, textTransform: 'uppercase',
    fontFamily: theme.headerFont, cursor: 'pointer',
  },
  danger: {
    background: 'rgba(192,69,63,0.2)', border: `1px solid ${theme.danger}`, color: '#e0a8a4',
  },
  input: {
    width: '100%', padding: '9px 12px', marginTop: 8, marginBottom: 4,
    background: 'rgba(255,255,255,0.05)', border: `1px solid ${theme.border}`,
    borderRadius: 4, color: theme.text.primary, fontSize: 14,
    fontFamily: 'Georgia, serif', outline: 'none', boxSizing: 'border-box',
  },
  err: { color: theme.danger, fontSize: 12, marginTop: 8, textAlign: 'center' },
  ok: { color: theme.success, fontSize: 12, marginTop: 8, textAlign: 'center' },
  legal: { fontSize: 11, color: theme.text.tertiary, textAlign: 'center', marginTop: 18 },
  legalLink: { color: theme.accentStrong, textDecoration: 'underline', cursor: 'pointer' },
}

export default function AccountModal({ username, onClose, onDeleted, onLogout }) {
  const overlayRef = useViewportOverlayFix()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [err, setErr] = useState(null)
  const [confirmText, setConfirmText] = useState('')
  const [showConfirm, setShowConfirm] = useState(false)
  const [legalTab, setLegalTab] = useState(null)
  const [showFeedback, setShowFeedback] = useState(false)

  // Just clears the token client-side - there's no server-side session to
  // end (JWTs are stateless), so this is the same as the token silently
  // expiring, just on purpose.
  function logout() {
    localStorage.removeItem('rw_token')
    onLogout()
  }

  async function exportData() {
    setErr(null); setMsg(null); setBusy(true)
    try {
      const data = await api.exportData()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'hexnation-data.json'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      setMsg('Download started.')
    } catch (e) {
      setErr(e.message || 'Export failed')
    } finally {
      setBusy(false)
    }
  }

  async function deleteAccount() {
    setErr(null); setBusy(true)
    try {
      await api.deleteAccount()
      localStorage.removeItem('rw_token')
      onDeleted()
    } catch (e) {
      setErr(e.message || 'Delete failed')
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
        <div style={S.title}>Account</div>
        <div style={S.sub}>{username}</div>

        <button style={S.btn} onClick={logout}>Log out</button>

        <div style={S.h}>Feedback</div>
        <p style={S.p}>Found a bug or have an idea? Send it straight to the developer.</p>
        <button style={S.btn} onClick={() => setShowFeedback(true)}>Send feedback</button>

        <div style={S.h}>Export your data</div>
        <p style={S.p}>
          Download everything tied to this account - profile, territory,
          armies, battles, events - as a JSON file.
        </p>
        <button style={S.btn} onClick={exportData} disabled={busy}>Download my data</button>

        <div style={S.h}>Delete your account</div>
        <p style={S.p}>
          This permanently removes your profile, current territory and armies,
          personal alerts, chat messages, feedback, and push notifications. Past battles
          and season standings keep a de-identified reference only. This cannot
          be undone.
        </p>
        {!showConfirm ? (
          <button style={{ ...S.btn, ...S.danger }} onClick={() => { setShowConfirm(true); setErr(null) }} disabled={busy}>
            Delete account
          </button>
        ) : (
          <>
            <p style={S.p}>Type <b>DELETE</b> to confirm:</p>
            <input
              style={S.input} value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              autoFocus autoComplete="off"
            />
            <button
              style={{ ...S.btn, ...S.danger }}
              onClick={deleteAccount}
              disabled={busy || confirmText !== 'DELETE'}>
              {busy ? 'Deleting...' : 'Permanently delete'}
            </button>
            <button style={{ ...S.btn, marginTop: 6 }} onClick={() => { setShowConfirm(false); setConfirmText('') }} disabled={busy}>
              Cancel
            </button>
          </>
        )}

        {err && <div style={S.err}>{err}</div>}
        {msg && <div style={S.ok}>{msg}</div>}

        <div style={S.legal}>
          <span style={S.legalLink} onClick={() => setLegalTab('privacy')}>Privacy Policy</span>
          {' · '}
          <span style={S.legalLink} onClick={() => setLegalTab('terms')}>Terms of Service</span>
        </div>
      </div>
      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}
      {legalTab && <LegalModal initialTab={legalTab} onClose={() => setLegalTab(null)} />}
    </div>
  )
}

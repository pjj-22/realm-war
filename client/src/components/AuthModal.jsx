import { useState } from 'react'
import { HexColorPicker } from 'react-colorful'
import { api } from '../api/client'
import { useViewportOverlayFix } from '../hooks/useViewportOverlayFix'
import LegalModal from './LegalModal'
import { theme } from '../theme'

const PRESET_COLORS = ['#e05050', '#e09030', '#d0c030', '#50c050', '#3090e0', '#8050d0', '#d050a0']

const styles = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
    padding: 16,
  },
  box: {
    background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 6,
    padding: '32px 40px', minWidth: 320,
    boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
    maxHeight: '100%', overflowY: 'auto',
  },
  title: {
    color: theme.text.primary, fontSize: 22, letterSpacing: 4,
    textTransform: 'uppercase', textAlign: 'center',
    marginBottom: 24, fontFamily: theme.headerFont,
  },
  input: {
    width: '100%', padding: '10px 12px', marginBottom: 12,
    background: 'rgba(255,255,255,0.05)', border: `1px solid ${theme.border}`,
    borderRadius: 4, color: theme.text.primary, fontSize: 14,
    fontFamily: 'Georgia, serif', outline: 'none', boxSizing: 'border-box',
  },
  btn: {
    width: '100%', padding: '10px', marginTop: 4,
    background: theme.accent, border: `1px solid ${theme.accentStrong}`,
    borderRadius: 4, color: theme.accentText, fontSize: 13, fontWeight: 600,
    letterSpacing: 2, textTransform: 'uppercase',
    fontFamily: theme.headerFont, cursor: 'pointer',
  },
  toggle: {
    marginTop: 16, textAlign: 'center', color: theme.text.secondary,
    fontSize: 12, cursor: 'pointer',
  },
  error: {
    color: theme.danger, fontSize: 12, marginBottom: 8, textAlign: 'center',
  },
  legalLink: {
    color: theme.accentStrong, textDecoration: 'underline', cursor: 'pointer',
  },
}

export default function AuthModal({ onAuth, onDismiss, initialMode = 'login' }) {
  const overlayRef = useViewportOverlayFix()
  const [mode, setMode] = useState(initialMode)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [color, setColor] = useState(PRESET_COLORS[0])
  const [agree, setAgree] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [legalTab, setLegalTab] = useState(null)

  async function submit(e) {
    e.preventDefault()
    setError('')
    if (mode === 'register' && !agree) {
      setError('Please confirm you are 16+ and accept the terms')
      return
    }
    setLoading(true)
    try {
      const isNew = mode === 'register'
      const data = isNew
        ? await api.register(username, password, color, agree)
        : await api.login(username, password)
      localStorage.setItem('rw_token', data.token)
      onAuth(data.player, isNew, data.loginBonus || null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div ref={overlayRef} style={styles.overlay}>
      <div style={styles.box}>
        <div style={styles.title}>HexNation</div>
        <form onSubmit={submit}>
          {error && <div style={styles.error}>{error}</div>}
          <input
            style={styles.input} placeholder="Username"
            value={username} onChange={e => setUsername(e.target.value)}
            autoFocus autoComplete="username"
          />
          <input
            style={styles.input} placeholder="Password" type="password"
            value={password} onChange={e => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />

          {mode === 'register' && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: theme.text.secondary, letterSpacing: 2, marginBottom: 8, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 8 }}>
                Faction Color
                <span style={{ width: 14, height: 14, borderRadius: '50%', background: color, display: 'inline-block', border: `1px solid ${theme.border}` }} />
              </div>
              <HexColorPicker
                color={color}
                onChange={setColor}
                style={{ width: '100%', height: 160 }}
              />
            </div>
          )}

          {mode === 'register' && (
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, color: theme.text.secondary, lineHeight: 1.5, marginBottom: 4, cursor: 'pointer' }}>
              <input
                type="checkbox" checked={agree}
                onChange={e => setAgree(e.target.checked)}
                style={{ marginTop: 2, flexShrink: 0 }}
              />
              <span>
                I am 16 or older and I accept the{' '}
                <span style={styles.legalLink} onClick={e => { e.preventDefault(); setLegalTab('terms') }}>Terms</span>{' '}and{' '}
                <span style={styles.legalLink} onClick={e => { e.preventDefault(); setLegalTab('privacy') }}>Privacy Policy</span>.
              </span>
            </label>
          )}

          <button style={styles.btn} disabled={loading}>
            {loading ? '...' : mode === 'login' ? 'Enter the War' : 'Join the War'}
          </button>
        </form>
        <div style={styles.toggle} onClick={() => { setMode(m => m === 'login' ? 'register' : 'login'); setError('') }}>
          {mode === 'login' ? 'No account? Register' : 'Have an account? Login'}
        </div>
        {onDismiss && (
          <div style={{ ...styles.toggle, marginTop: 8, color: theme.text.tertiary }} onClick={onDismiss}>
            Browse as guest
          </div>
        )}
        <div style={{ marginTop: 14, textAlign: 'center', fontSize: 11, color: theme.text.tertiary }}>
          <span style={styles.legalLink} onClick={() => setLegalTab('privacy')}>Privacy</span>
          {' · '}
          <span style={styles.legalLink} onClick={() => setLegalTab('terms')}>Terms</span>
        </div>
      </div>
      {legalTab && <LegalModal initialTab={legalTab} onClose={() => setLegalTab(null)} />}
    </div>
  )
}

import { useState } from 'react'
import { HexColorPicker } from 'react-colorful'
import { api } from '../api/client'

const PRESET_COLORS = ['#e05050', '#e09030', '#d0c030', '#50c050', '#3090e0', '#8050d0', '#d050a0']

const styles = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
  },
  box: {
    background: '#0e0b1e', border: '1px solid #4a3a7a', borderRadius: 8,
    padding: '32px 40px', minWidth: 320,
    boxShadow: '0 0 60px rgba(80,40,160,0.4)',
  },
  title: {
    color: '#c9b99a', fontSize: 22, letterSpacing: 4,
    textTransform: 'uppercase', textAlign: 'center',
    marginBottom: 24, fontFamily: 'Georgia, serif',
  },
  input: {
    width: '100%', padding: '10px 12px', marginBottom: 12,
    background: 'rgba(255,255,255,0.05)', border: '1px solid #4a3a7a',
    borderRadius: 4, color: '#c9b99a', fontSize: 14,
    fontFamily: 'Georgia, serif', outline: 'none', boxSizing: 'border-box',
  },
  btn: {
    width: '100%', padding: '10px', marginTop: 4,
    background: 'rgba(80,40,160,0.5)', border: '1px solid #6a4aaa',
    borderRadius: 4, color: '#c9b99a', fontSize: 13,
    letterSpacing: 2, textTransform: 'uppercase',
    fontFamily: 'Georgia, serif', cursor: 'pointer',
  },
  toggle: {
    marginTop: 16, textAlign: 'center', color: '#7a6a9a',
    fontSize: 12, cursor: 'pointer',
  },
  error: {
    color: '#c05050', fontSize: 12, marginBottom: 8, textAlign: 'center',
  },
}

export default function AuthModal({ onAuth, onDismiss }) {
  const [mode, setMode] = useState('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [color, setColor] = useState(PRESET_COLORS[0])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const isNew = mode === 'register'
      const data = isNew
        ? await api.register(username, password, color)
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
    <div style={styles.overlay}>
      <div style={styles.box}>
        <div style={styles.title}>Realm War</div>
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
              <div style={{ fontSize: 11, color: '#7a6a9a', letterSpacing: 2, marginBottom: 8, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 8 }}>
                Faction Color
                <span style={{ width: 14, height: 14, borderRadius: '50%', background: color, display: 'inline-block', border: '1px solid #4a3a7a' }} />
              </div>
              <HexColorPicker
                color={color}
                onChange={setColor}
                style={{ width: '100%', height: 160 }}
              />
            </div>
          )}

          <button style={styles.btn} disabled={loading}>
            {loading ? '...' : mode === 'login' ? 'Enter the War' : 'Join the War'}
          </button>
        </form>
        <div style={styles.toggle} onClick={() => { setMode(m => m === 'login' ? 'register' : 'login'); setError('') }}>
          {mode === 'login' ? 'No account? Register' : 'Have an account? Login'}
        </div>
        {onDismiss && (
          <div style={{ ...styles.toggle, marginTop: 8, color: '#5a4a6a' }} onClick={onDismiss}>
            Browse as guest
          </div>
        )}
      </div>
    </div>
  )
}

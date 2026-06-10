import { useState } from 'react'
import { api } from '../api/client'
import { toast } from './Toast'
import { AllianceIcon } from './Icons'

const S = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 150, padding: 16,
  },
  box: {
    background: 'rgba(10,8,24,0.98)', border: '1px solid #4a3a7a', borderRadius: 10,
    padding: '24px 28px', width: '100%', maxWidth: 400,
    maxHeight: '85vh', overflowY: 'auto',
    boxShadow: '0 0 50px rgba(80,40,160,0.35)',
    fontFamily: 'Georgia, serif', color: '#c9b99a',
  },
  title: {
    fontSize: 18, letterSpacing: 4, textTransform: 'uppercase',
    textAlign: 'center', marginBottom: 18, color: '#c0a0f0',
  },
  label: { fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: '#7a6890', marginBottom: 6 },
  input: {
    width: '100%', padding: '8px 10px', marginBottom: 12, boxSizing: 'border-box',
    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 4, color: '#c4b498', fontFamily: 'Georgia, serif', fontSize: 14, outline: 'none',
  },
  btn: {
    width: '100%', padding: '9px 0',
    background: 'rgba(120,60,200,0.25)', border: '1px solid rgba(160,80,220,0.4)',
    borderRadius: 4, color: '#c090f0', cursor: 'pointer',
    fontSize: 13, letterSpacing: 2, textTransform: 'uppercase', fontFamily: 'Georgia, serif',
  },
}

export default function AlliancePanel({ alliance, onChanged, onClose }) {
  const [name, setName] = useState('')
  const [tag, setTag] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)

  async function run(fn, successMsg) {
    setBusy(true)
    try {
      await fn()
      if (successMsg) toast(successMsg, 'success')
      onChanged?.()
    } catch (err) {
      toast(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.box} onClick={e => e.stopPropagation()}>
        <button onClick={onClose} style={{
          float: 'right', background: 'none', border: 'none',
          color: '#7a6890', fontSize: 20, cursor: 'pointer', lineHeight: 1,
        }}>×</button>
        <div style={S.title}><AllianceIcon size={16} color="#c0a0f0" /> Alliance</div>

        {alliance ? (
          <>
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 20, color: '#e0d0b0' }}>
                [{alliance.tag}] {alliance.name}
              </div>
              {alliance.code && (
                <div style={{ marginTop: 8, fontSize: 13, color: '#9a8aaa' }}>
                  Invite code: <span style={{ color: '#e0b060', letterSpacing: 2, fontWeight: 'bold' }}>{alliance.code}</span>
                  <div style={{ fontSize: 11, color: '#6a5878', marginTop: 2 }}>Share it to recruit members</div>
                </div>
              )}
            </div>

            <div style={S.label}>Members ({alliance.members.length})</div>
            <div style={{ marginBottom: 16, maxHeight: 180, overflowY: 'auto' }}>
              {alliance.members.map(m => (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 2px', fontSize: 14 }}>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: m.color, flexShrink: 0 }} />
                  <span style={{ color: '#c4b498' }}>{m.username}</span>
                </div>
              ))}
            </div>

            <div style={{ fontSize: 12, color: '#7a6890', lineHeight: 1.6, marginBottom: 14 }}>
              Allies cannot attack each other - armies sent to an ally's hex reinforce its defense.
              You share vision of each other's territory and a private chat channel.
            </div>

            <button
              disabled={busy}
              onClick={() => run(() => api.leaveAlliance(), 'You left the alliance')}
              style={{ ...S.btn, background: 'rgba(160,50,50,0.2)', border: '1px solid rgba(200,80,80,0.35)', color: '#d09090' }}>
              Leave Alliance
            </button>
          </>
        ) : (
          <>
            <div style={S.label}>Found an alliance</div>
            <input style={S.input} placeholder="Alliance name (3-24 chars)" value={name} onChange={e => setName(e.target.value)} maxLength={24} />
            <input style={S.input} placeholder="Tag (2-4 letters)" value={tag} onChange={e => setTag(e.target.value)} maxLength={4} />
            <button
              disabled={busy || !name || !tag}
              onClick={() => run(() => api.createAlliance(name, tag), 'Alliance founded!')}
              style={{ ...S.btn, marginBottom: 22, opacity: !name || !tag ? 0.5 : 1 }}>
              Found Alliance
            </button>

            <div style={S.label}>Or join with an invite code</div>
            <input style={S.input} placeholder="Invite code" value={code} onChange={e => setCode(e.target.value)} maxLength={6} />
            <button
              disabled={busy || !code}
              onClick={() => run(() => api.joinAlliance(code), 'Welcome to the alliance!')}
              style={{ ...S.btn, opacity: !code ? 0.5 : 1 }}>
              Join Alliance
            </button>

            <div style={{ fontSize: 12, color: '#7a6890', lineHeight: 1.6, marginTop: 16 }}>
              Allies can't attack each other, share map vision, reinforce each other's
              battles, and get a private chat channel.
            </div>
          </>
        )}
      </div>
    </div>
  )
}

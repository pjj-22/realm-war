import { useState, useEffect } from 'react'
import { api } from '../api/client'

const TROOPS = [
  { type: 'knight',    label: 'Knights',     cost: '10g',       time: '3min', icon: '⚔' },
  { type: 'archer',    label: 'Archers',     cost: '10g',       time: '3min', icon: '🏹' },
  { type: 'trebuchet', label: 'Trebuchets',  cost: '30g+10m',   time: '8min', icon: '💣' },
]

function TrainingBar({ job }) {
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    function update() {
      const total = new Date(job.completes_at) - new Date(job.started_at)
      const elapsed = Date.now() - new Date(job.started_at)
      setProgress(Math.min(100, (elapsed / total) * 100))
    }
    update()
    const interval = setInterval(update, 500)
    return () => clearInterval(interval)
  }, [job])

  const remaining = Math.max(0, Math.ceil((new Date(job.completes_at) - Date.now()) / 1000))
  const mins = Math.floor(remaining / 60)
  const secs = remaining % 60

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#7a6a9a', marginBottom: 4 }}>
        <span>Training {job.quantity} {job.type}s</span>
        <span>{mins}:{String(secs).padStart(2, '0')}</span>
      </div>
      <div style={{ height: 5, background: 'rgba(255,255,255,0.1)', borderRadius: 2 }}>
        <div style={{
          height: '100%', borderRadius: 2,
          background: 'linear-gradient(90deg, #4a3a9a, #8060d0)',
          width: `${progress}%`, transition: 'width 0.5s linear',
        }} />
      </div>
    </div>
  )
}

export default function MilitaryPanel({ hex, player, onPlayerUpdate, onMarchStart, onClose }) {
  const [military, setMilitary] = useState(null)
  const [quantity, setQuantity] = useState(1)
  const [loading, setLoading] = useState(false)

  async function handleRecall(id) {
    setLoading(true)
    try {
      await api.recallArmy(id)
      await load()
    } catch (err) {
      alert(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const interval = setInterval(load, 5000)
    return () => clearInterval(interval)
  }, [hex.h3])

  async function load() {
    try {
      const data = await api.getMilitary(hex.h3)
      setMilitary(data)
    } catch {}
  }

  async function handleTrain(type) {
    setLoading(true)
    try {
      const result = await api.trainTroops(hex.h3, type, quantity)
      onPlayerUpdate?.(result.player)
      await load()
    } catch (err) {
      alert(err.message)
    } finally {
      setLoading(false)
    }
  }

  const troopMap = {}
  military?.troops?.forEach(t => { troopMap[t.type] = t.quantity })

  return (
    <div style={{
      position: 'absolute', bottom: 30, left: 30,
      background: 'rgba(10,8,25,0.92)', border: '1px solid #4a3a7a',
      borderRadius: 8, padding: '20px 24px', minWidth: 300, maxWidth: 340,
      color: '#c9b99a', fontFamily: 'Georgia, serif',
      boxShadow: '0 0 30px rgba(80,40,160,0.4)',
      maxHeight: '80vh', overflowY: 'auto',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <span style={{ fontSize: 13, letterSpacing: 3, color: '#7a6a9a', textTransform: 'uppercase' }}>Military</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#7a6a9a', cursor: 'pointer', fontSize: 20 }}>×</button>
      </div>

      {/* Quantity selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <span style={{ fontSize: 12, color: '#7a6a9a' }}>QTY</span>
        <input
          type="number" min="1" max="100" value={quantity}
          onChange={e => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
          style={{
            width: 70, padding: '5px 10px', background: 'rgba(255,255,255,0.05)',
            border: '1px solid #4a3a7a', borderRadius: 4, color: '#c9b99a',
            fontFamily: 'Georgia, serif', fontSize: 14,
          }}
        />
      </div>

      {/* Training queue */}
      {military?.training?.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: '#7a6a9a', letterSpacing: 2, marginBottom: 8, textTransform: 'uppercase' }}>Training</div>
          {military.training.map(job => <TrainingBar key={job.id} job={job} />)}
        </div>
      )}

      {/* Troops & actions */}
      <div style={{ fontSize: 12, color: '#7a6a9a', letterSpacing: 2, marginBottom: 10, textTransform: 'uppercase' }}>Troops</div>
      {TROOPS.map(t => (
        <div key={t.type} style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 14 }}>{t.icon} {t.label}</span>
            <span style={{ fontSize: 13, color: '#a090c0' }}>{troopMap[t.type] || 0} ready</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => handleTrain(t.type)}
              disabled={loading}
              style={{
                flex: 1, padding: '7px 0', background: 'rgba(80,40,160,0.25)',
                border: '1px solid #4a3a7a', borderRadius: 4,
                color: '#c9b99a', cursor: 'pointer', fontSize: 11,
                letterSpacing: 1, fontFamily: 'Georgia, serif',
              }}>
              Train {t.cost} · {t.time}
            </button>
            {(troopMap[t.type] || 0) > 0 && (
              <button
                onClick={() => onMarchStart?.(hex.h3, t.type, Math.min(quantity, troopMap[t.type]))}
                disabled={loading}
                style={{
                  padding: '7px 12px', background: 'rgba(160,40,40,0.25)',
                  border: '1px solid #7a3a3a', borderRadius: 4,
                  color: '#c9a0a0', cursor: 'pointer', fontSize: 11,
                  fontFamily: 'Georgia, serif',
                }}>
                March
              </button>
            )}
          </div>
        </div>
      ))}

      {/* Marching armies */}
      {military?.armies?.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <div style={{ fontSize: 12, color: '#7a6a9a', letterSpacing: 2, marginBottom: 8, textTransform: 'uppercase' }}>Marching</div>
          {military.armies.map(a => {
            const total = new Date(a.arrives_at) - new Date(a.departed_at)
            const elapsed = Date.now() - new Date(a.departed_at)
            const progress = Math.min(100, (elapsed / total) * 100)
            const remaining = Math.max(0, Math.ceil((new Date(a.arrives_at) - Date.now()) / 60000))
            return (
              <div key={a.id} style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#7a6a9a', marginBottom: 4 }}>
                  <span>{a.quantity} {a.type}s → {a.to_hex.slice(0, 8)}…</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>{remaining}min</span>
                    <button
                      onClick={() => handleRecall(a.id)}
                      disabled={loading}
                      style={{
                        padding: '1px 7px', background: 'rgba(100,30,30,0.4)',
                        border: '1px solid #6a2a2a', borderRadius: 3,
                        color: '#c09090', cursor: 'pointer', fontSize: 10,
                        fontFamily: 'Georgia, serif',
                      }}>
                      Recall
                    </button>
                  </div>
                </div>
                <div style={{ height: 5, background: 'rgba(255,255,255,0.1)', borderRadius: 2 }}>
                  <div style={{
                    height: '100%', borderRadius: 2,
                    background: 'linear-gradient(90deg, #9a3a3a, #d06060)',
                    width: `${progress}%`, transition: 'width 0.5s linear',
                  }} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

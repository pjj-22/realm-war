import { useState, useEffect } from 'react'
import { api } from '../api/client'

const ICONS = { knight: '⚔', archer: '🏹', trebuchet: '💣' }

function ArmyRow({ army, isOwn, onRecall }) {
  const [progress, setProgress] = useState(0)
  const [remaining, setRemaining] = useState(0)

  useEffect(() => {
    function update() {
      const total = new Date(army.arrives_at) - new Date(army.departed_at)
      const elapsed = Date.now() - new Date(army.departed_at)
      setProgress(Math.min(100, (elapsed / total) * 100))
      setRemaining(Math.max(0, Math.ceil((new Date(army.arrives_at) - Date.now()) / 1000)))
    }
    update()
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [army])

  const mins = Math.floor(remaining / 60)
  const secs = remaining % 60
  const eta = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`

  return (
    <div style={{
      marginBottom: 10, padding: '8px 10px',
      background: isOwn ? 'rgba(80,40,160,0.15)' : 'rgba(160,20,20,0.15)',
      border: `1px solid ${isOwn ? '#4a3a7a' : '#7a2a2a'}`,
      borderRadius: 4,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 12 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: army.color, display: 'inline-block', marginRight: 5 }} />
          {army.username} · {ICONS[army.type]}{army.quantity} {army.type}s
        </span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#7a6a9a' }}>{eta}</span>
          {isOwn && (
            <button onClick={() => onRecall(army.id)} style={{
              padding: '1px 6px', background: 'rgba(100,30,30,0.4)',
              border: '1px solid #6a2a2a', borderRadius: 3,
              color: '#c09090', cursor: 'pointer', fontSize: 10, fontFamily: 'Georgia, serif',
            }}>Recall</button>
          )}
        </div>
      </div>
      <div style={{ fontSize: 11, color: '#7a6a9a', marginBottom: 4 }}>
        → {army.to_hex.slice(0, 10)}…
      </div>
      <div style={{ height: 3, background: 'rgba(255,255,255,0.1)', borderRadius: 2 }}>
        <div style={{
          height: '100%', borderRadius: 2,
          background: isOwn ? 'linear-gradient(90deg, #4a3a9a, #8060d0)' : 'linear-gradient(90deg, #9a3a3a, #d06060)',
          width: `${progress}%`, transition: 'width 1s linear',
        }} />
      </div>
    </div>
  )
}

export default function ArmiesHUD({ armies, player, claimedRef, onRefresh }) {
  const [open, setOpen] = useState(false)

  const myArmies = armies.filter(a => a.owner_id === player?.id)
  const threats = armies.filter(a =>
    player && a.owner_id !== player.id && claimedRef.current[a.to_hex]?.owner_id === player.id
  )
  const totalCount = myArmies.length + threats.length

  async function handleRecall(id) {
    try {
      await api.recallArmy(id)
      onRefresh?.()
    } catch (err) {
      alert(err.message)
    }
  }

  if (!player) return null

  return (
    <div style={{
      position: 'absolute', top: 70, left: 16,
      fontFamily: 'Georgia, serif', zIndex: 10,
    }}>
      {/* Toggle button */}
      <button onClick={() => setOpen(o => !o)} style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 12px',
        background: 'rgba(10,8,25,0.85)', border: `1px solid ${threats.length > 0 ? '#7a2a2a' : '#4a3a7a'}`,
        borderRadius: 6, color: '#c9b99a', cursor: 'pointer',
        fontSize: 12, letterSpacing: 1,
        boxShadow: threats.length > 0 ? '0 0 12px rgba(180,40,40,0.4)' : '0 0 12px rgba(80,40,160,0.3)',
      }}>
        <span>⚔ Armies</span>
        {totalCount > 0 && (
          <span style={{
            background: threats.length > 0 ? '#7a2a2a' : '#4a3a7a',
            borderRadius: 10, padding: '1px 7px', fontSize: 11,
          }}>{totalCount}</span>
        )}
        {threats.length > 0 && (
          <span style={{ color: '#ff6060', fontSize: 11 }}>⚠ {threats.length}</span>
        )}
      </button>

      {/* Panel */}
      {open && (
        <div style={{
          marginTop: 4,
          background: 'rgba(10,8,25,0.92)', border: '1px solid #4a3a7a',
          borderRadius: 6, padding: '14px 16px', width: 300,
          boxShadow: '0 0 30px rgba(80,40,160,0.4)',
          maxHeight: '60vh', overflowY: 'auto',
        }}>
          {myArmies.length > 0 && (
            <>
              <div style={{ fontSize: 11, color: '#7a6a9a', letterSpacing: 2, marginBottom: 8, textTransform: 'uppercase' }}>
                Your Armies ({myArmies.length})
              </div>
              {myArmies.map(a => <ArmyRow key={a.id} army={a} isOwn onRecall={handleRecall} />)}
            </>
          )}

          {threats.length > 0 && (
            <>
              <div style={{ fontSize: 11, color: '#c06060', letterSpacing: 2, marginBottom: 8, marginTop: myArmies.length > 0 ? 10 : 0, textTransform: 'uppercase' }}>
                ⚠ Incoming Threats ({threats.length})
              </div>
              {threats.map(a => <ArmyRow key={a.id} army={a} isOwn={false} onRecall={handleRecall} />)}
            </>
          )}

          {totalCount === 0 && (
            <div style={{ fontSize: 12, color: '#5a4a7a', textAlign: 'center', padding: '10px 0' }}>
              No active armies
            </div>
          )}
        </div>
      )}
    </div>
  )
}

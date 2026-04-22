import { useState, useEffect, useRef } from 'react'
import { api } from '../api/client'

const ROUND_MS = 15000
const DAMAGE_RATE = 0.15

function StrengthBar({ strength, maxStrength, color, losses, side }) {
  const pct = maxStrength > 0 ? Math.min(100, (strength / maxStrength) * 100) : 0
  return (
    <div style={{ flex: 1, textAlign: side === 'left' ? 'left' : 'right' }}>
      <div style={{ fontSize: 13, color, marginBottom: 3, fontWeight: 'bold' }}>
        {strength.toFixed(1)} str
      </div>
      <div style={{ height: 8, background: 'rgba(255,255,255,0.1)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{
          height: '100%', borderRadius: 4,
          background: color,
          width: `${pct}%`,
          transition: 'width 0.1s linear',
          float: side === 'right' ? 'right' : 'left',
        }} />
      </div>
      <div style={{ fontSize: 11, color: '#7a6a9a', marginTop: 2 }}>
        Lost: {losses.toFixed(1)}
      </div>
    </div>
  )
}

export default function BattlePanel({ hex, player, onMarchStart, onClose }) {
  const [data, setData] = useState(null)
  const [display, setDisplay] = useState(null)
  const lastFetchRef = useRef(null)

  useEffect(() => {
    load()
    const interval = setInterval(load, 3000)
    return () => clearInterval(interval)
  }, [hex.h3])

  async function load() {
    try {
      const result = await api.getBattle(hex.h3)
      if (result.battle) {
        setData(result)
        setDisplay({
          atkStr: Number(result.battle.attacker_strength),
          defStr: Number(result.battle.defender_strength),
          atkLoss: Number(result.battle.attacker_losses),
          defLoss: Number(result.battle.defender_losses),
        })
        lastFetchRef.current = Date.now()
      } else {
        setData(null)
      }
    } catch {}
  }

  // Smooth interpolation between polls
  useEffect(() => {
    if (!display) return
    const interval = setInterval(() => {
      const elapsed = (Date.now() - (lastFetchRef.current || Date.now())) / 1000
      const damagePerSec = DAMAGE_RATE / (ROUND_MS / 1000)
      setDisplay(prev => {
        if (!prev) return prev
        const atkDmg = prev.defStr * damagePerSec * 0.1
        const defDmg = prev.atkStr * damagePerSec * 0.1
        return {
          atkStr: Math.max(0, prev.atkStr - atkDmg),
          defStr: Math.max(0, prev.defStr - defDmg),
          atkLoss: prev.atkLoss + defDmg,
          defLoss: prev.defLoss + atkDmg,
        }
      })
    }, 100)
    return () => clearInterval(interval)
  }, [data])

  if (!data?.battle) return null

  const { battle, participants } = data
  const initialAtkStr = Number(battle.attacker_strength) + Number(battle.attacker_losses)
  const initialDefStr = Number(battle.defender_strength) + Number(battle.defender_losses)
  const maxStr = Math.max(initialAtkStr, initialDefStr, 1)
  // Each round the weaker side loses (strongerStr × DAMAGE_RATE), so rounds ≈ weaker / (stronger × rate)
  const roundsLeft = display
    ? Math.max(1, Math.ceil(
        Math.min(display.atkStr, display.defStr) /
        (Math.max(display.atkStr, display.defStr, 0.001) * DAMAGE_RATE)
      ))
    : '?'
  const isParticipant = player && (player.id === battle.attacker_id || player.id === battle.defender_id)

  const attackers = participants.filter(p => p.side === 'attacker')
  const defenders = participants.filter(p => p.side === 'defender')

  return (
    <div style={{
      position: 'absolute', bottom: 30, left: 30,
      background: 'rgba(10,8,25,0.95)',
      border: '1px solid #9a2a2a',
      borderRadius: 8, padding: '18px 22px', width: 340,
      color: '#c9b99a', fontFamily: 'Georgia, serif',
      boxShadow: '0 0 30px rgba(180,40,40,0.4)',
      maxHeight: '80vh', overflowY: 'auto',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <span style={{ fontSize: 12, letterSpacing: 3, color: '#c06060', textTransform: 'uppercase' }}>
          ⚔ Battle in Progress
        </span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#7a6a9a', cursor: 'pointer', fontSize: 20 }}>×</button>
      </div>

      {/* Combatant names */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: battle.attacker_color, display: 'inline-block' }} />
          {battle.attacker_username}
        </span>
        <span style={{ fontSize: 11, color: '#7a6a9a' }}>vs</span>
        <span style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 5 }}>
          {battle.defender_username}
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: battle.defender_color, display: 'inline-block' }} />
        </span>
      </div>

      {/* Strength bars */}
      {display && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
          <StrengthBar
            strength={display.atkStr} maxStrength={maxStr}
            color={battle.attacker_color} losses={display.atkLoss} side="left"
          />
          <StrengthBar
            strength={display.defStr} maxStrength={maxStr}
            color={battle.defender_color} losses={display.defLoss} side="right"
          />
        </div>
      )}

      {/* Round info */}
      <div style={{ fontSize: 11, color: '#7a6a9a', marginBottom: 12, textAlign: 'center' }}>
        Round {battle.round_number} · ~{Math.max(0, roundsLeft)} rounds remaining
      </div>

      <div style={{ borderTop: '1px solid #2a1a3a', marginBottom: 10 }} />

      {/* Participants */}
      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: '#9a4040', letterSpacing: 2, marginBottom: 6, textTransform: 'uppercase' }}>Attackers</div>
          {attackers.map((p, i) => (
            <div key={i} style={{ fontSize: 12, color: '#c9b99a', marginBottom: 3 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: p.color, display: 'inline-block', marginRight: 4 }} />
              {p.quantity} {p.troop_type}s
            </div>
          ))}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: '#4040aa', letterSpacing: 2, marginBottom: 6, textTransform: 'uppercase' }}>Defenders</div>
          {defenders.map((p, i) => (
            <div key={i} style={{ fontSize: 12, color: '#c9b99a', marginBottom: 3 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: p.color, display: 'inline-block', marginRight: 4 }} />
              {p.quantity} {p.troop_type}s
            </div>
          ))}
        </div>
      </div>

      {/* Reinforce button */}
      {isParticipant && onMarchStart && (
        <>
          <div style={{ borderTop: '1px solid #2a1a3a', margin: '12px 0 10px' }} />
          <button
            onClick={() => {
              const side = player.id === battle.attacker_id ? 'attacker' : 'defender'
              onMarchStart(hex.h3, side)
            }}
            style={{
              width: '100%', padding: '8px 0',
              background: 'rgba(120,40,40,0.3)', border: '1px solid #7a3a3a',
              borderRadius: 4, color: '#c9a0a0', cursor: 'pointer',
              fontSize: 12, letterSpacing: 2, textTransform: 'uppercase',
              fontFamily: 'Georgia, serif',
            }}>
            ⚔ Send Reinforcements
          </button>
        </>
      )}
    </div>
  )
}

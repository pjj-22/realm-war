import { useState, useEffect, useRef } from 'react'
import { api } from '../api/client'
import { useSocket } from '../hooks/useSocket'
import { useIsMobile } from '../hooks/useIsMobile'
import { SwordsIcon } from './Icons'

const ROUND_MS = 15000
const DAMAGE_RATE = 0.15

function RoundTimer({ lastRoundAt }) {
  const [secsLeft, setSecsLeft] = useState(ROUND_MS / 1000)
  const baseRef = useRef(Date.now())

  useEffect(() => {
    if (lastRoundAt) baseRef.current = new Date(lastRoundAt).getTime()
  }, [lastRoundAt])

  useEffect(() => {
    function update() {
      const next = baseRef.current + ROUND_MS
      setSecsLeft(Math.max(0, Math.ceil((next - Date.now()) / 1000)))
    }
    update()
    const id = setInterval(update, 500)
    return () => clearInterval(id)
  }, [lastRoundAt])

  return (
    <span style={{ fontSize: 12, color: secsLeft <= 3 ? '#ff8080' : '#9a6a6a', whiteSpace: 'nowrap' }}>
      {secsLeft > 0 ? `next round in ${secsLeft}s` : 'resolving round…'}
    </span>
  )
}

function SoldierIcon({ color, dead, mirror }) {
  return (
    <svg width="13" height="17" viewBox="0 0 13 17" style={{
      display: 'block',
      opacity: dead ? 0.18 : 1,
      transition: 'opacity 0.8s ease',
      transform: mirror ? 'scaleX(-1)' : 'none',
    }}>
      <circle cx="6.5" cy="3.4" r="2.6" fill={dead ? '#666' : color}/>
      <path d="M2.6,16.6 L2.6,10.4 Q2.6,7 6.5,7 Q10.4,7 10.4,10.4 L10.4,16.6 Z" fill={dead ? '#555' : color} opacity="0.85"/>
      <line x1="10.8" y1="1" x2="10.8" y2="12" stroke={dead ? '#555' : color} strokeWidth="1" opacity="0.6"/>
      {dead && <path d="M2,2 L11,15 M11,2 L2,15" stroke="#a03030" strokeWidth="1.4" opacity="0.85"/>}
    </svg>
  )
}

function StrengthBar({ strength, maxStrength, initialStrength, initialQty, color, losses, side }) {
  const pct = maxStrength > 0 ? Math.min(100, (strength / maxStrength) * 100) : 0
  // One icon per soldier up to 24, then each icon represents a share of the army
  const icons = Math.max(1, Math.min(24, Math.round(initialQty || 1)))
  const aliveFrac = initialStrength > 0 ? Math.max(0, Math.min(1, strength / initialStrength)) : 0
  const alive = Math.round(icons * aliveFrac)
  const perIcon = initialQty > icons ? Math.round(initialQty / icons) : 1

  return (
    <div style={{ flex: 1, textAlign: side === 'left' ? 'left' : 'right' }}>
      <div style={{ fontSize: 24, color, marginBottom: 4, fontWeight: 'bold', fontVariantNumeric: 'tabular-nums' }}>
        {strength.toFixed(1)}
        <span style={{ fontSize: 13, fontWeight: 'normal', opacity: 0.7 }}> str</span>
      </div>
      <div style={{ height: 12, background: 'rgba(255,255,255,0.1)', borderRadius: 6, overflow: 'hidden' }}>
        <div style={{
          height: '100%', borderRadius: 6,
          background: color,
          width: `${pct}%`,
          transition: 'width 0.1s linear',
          float: side === 'right' ? 'right' : 'left',
        }} />
      </div>
      {/* The army itself - soldiers fall as strength drops */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 10,
        justifyContent: side === 'right' ? 'flex-end' : 'flex-start',
      }}>
        {Array.from({ length: icons }, (_, i) => {
          // Soldiers die from the outer edge inward (toward the front line)
          const dead = side === 'left' ? i >= alive : i < icons - alive
          return <SoldierIcon key={i} color={color} dead={dead} mirror={side === 'right'} />
        })}
      </div>
      <div style={{ fontSize: 13, color: '#9a7a7a', marginTop: 6 }}>
        Lost: ~{Math.max(0, Math.round((initialQty || 0) * (1 - aliveFrac)))} troops{perIcon > 1 ? ` · 1 figure ≈ ${perIcon}` : ''}
      </div>
    </div>
  )
}

export default function BattlePanel({ hex, player, onMarchStart, onClose }) {
  const isMobile = useIsMobile()
  const [data, setData] = useState(null)
  const [display, setDisplay] = useState(null)
  const lastFetchRef = useRef(null)

  useEffect(() => { load() }, [hex.h3])
  useSocket({ 'battle:update': load })

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
  const totalAtkQty = attackers.reduce((s, p) => s + p.quantity, 0)
  const totalDefQty = defenders.reduce((s, p) => s + p.quantity, 0)

  return (
    <div style={{
      position: 'absolute', bottom: 0,
      left: isMobile ? 0 : '50%',
      transform: isMobile ? 'none' : 'translateX(-50%)',
      width: isMobile ? '100vw' : 'min(780px, 96vw)',
      background: 'linear-gradient(180deg, rgba(24,8,8,0.98) 0%, rgba(12,4,4,0.99) 100%)',
      border: '1px solid rgba(190,60,50,0.5)',
      borderBottom: 'none',
      borderRadius: isMobile ? '10px 10px 0 0' : '14px 14px 0 0',
      boxShadow: '0 -4px 40px rgba(0,0,0,0.7), inset 0 1px 0 rgba(220,80,60,0.2)',
      color: '#c9b99a', fontFamily: 'Georgia, serif',
      zIndex: 20,
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: isMobile ? '12px 16px' : '14px 28px',
        borderBottom: '1px solid rgba(190,60,50,0.2)',
      }}>
        <span style={{ fontSize: 16, letterSpacing: 4, color: '#e07060', textTransform: 'uppercase' }}>
          <SwordsIcon size={15} color="#e07060" /> Battle in Progress
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontSize: 13, color: '#9a6a6a' }}>
            Round {battle.round_number} · ~{Math.max(0, roundsLeft)} left
          </span>
          <RoundTimer lastRoundAt={battle.last_round_at} />
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#9a6a6a', cursor: 'pointer', fontSize: 24, lineHeight: 1 }}>×</button>
        </div>
      </div>

      <div style={{ padding: isMobile ? '16px 16px 20px' : '22px 32px 26px', maxHeight: isMobile ? '52vh' : '42vh', overflowY: 'auto' }}>
        {/* Combatant names */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 17, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 12, height: 12, borderRadius: '50%', background: battle.attacker_color, display: 'inline-block' }} />
            {battle.attacker_username}
          </span>
          <span style={{ fontSize: 14, color: '#9a6a6a', letterSpacing: 2 }}>VS</span>
          <span style={{ fontSize: 17, display: 'flex', alignItems: 'center', gap: 8 }}>
            {battle.defender_username}
            <span style={{ width: 12, height: 12, borderRadius: '50%', background: battle.defender_color, display: 'inline-block' }} />
          </span>
        </div>

        {/* Strength bars */}
        {display && (
          <div style={{ display: 'flex', gap: isMobile ? 16 : 40, marginBottom: 16 }}>
            <StrengthBar
              strength={display.atkStr} maxStrength={maxStr}
              initialStrength={initialAtkStr} initialQty={totalAtkQty}
              color={battle.attacker_color} losses={display.atkLoss} side="left"
            />
            <StrengthBar
              strength={display.defStr} maxStrength={maxStr}
              initialStrength={initialDefStr} initialQty={totalDefQty}
              color={battle.defender_color} losses={display.defLoss} side="right"
            />
          </div>
        )}

        <div style={{ borderTop: '1px solid rgba(190,60,50,0.15)', marginBottom: 14 }} />

        {/* Participants */}
        <div style={{ display: 'flex', gap: isMobile ? 16 : 40 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, color: '#c05050', letterSpacing: 2, marginBottom: 8, textTransform: 'uppercase' }}>Attackers</div>
            {attackers.map((p, i) => (
              <div key={i} style={{ fontSize: 14, color: '#c9b99a', marginBottom: 4 }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: p.color, display: 'inline-block', marginRight: 6 }} />
                {p.quantity} {p.troop_type}s
              </div>
            ))}
          </div>
          <div style={{ flex: 1, textAlign: 'right' }}>
            <div style={{ fontSize: 13, color: '#6060c0', letterSpacing: 2, marginBottom: 8, textTransform: 'uppercase' }}>Defenders</div>
            {defenders.map((p, i) => (
              <div key={i} style={{ fontSize: 14, color: '#c9b99a', marginBottom: 4 }}>
                {p.quantity} {p.troop_type}s
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: p.color, display: 'inline-block', marginLeft: 6 }} />
              </div>
            ))}
          </div>
        </div>

        {/* Reinforce button */}
        {isParticipant && onMarchStart && (
          <button
            onClick={() => {
              const side = player.id === battle.attacker_id ? 'attacker' : 'defender'
              onMarchStart(hex.h3, side)
            }}
            style={{
              width: '100%', padding: '12px 0', marginTop: 18,
              background: 'rgba(150,45,40,0.3)', border: '1px solid rgba(200,80,60,0.5)',
              borderRadius: 6, color: '#e0a090', cursor: 'pointer',
              fontSize: 14, letterSpacing: 3, textTransform: 'uppercase',
              fontFamily: 'Georgia, serif',
            }}>
            <SwordsIcon size={13} color="#e0a090" /> Send Reinforcements
          </button>
        )}
      </div>
    </div>
  )
}

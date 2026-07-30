import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '../api/client'
import { useSocket } from '../hooks/useSocket'
import { useIsMobile } from '../hooks/useIsMobile'
import { SwordsIcon } from './Icons'
import Tooltip from './Tooltip'

function RoundTimer({ nextRoundAt }) {
  const [secsLeft, setSecsLeft] = useState(0)

  useEffect(() => {
    if (!nextRoundAt) return
    const target = new Date(nextRoundAt).getTime()
    function update() {
      setSecsLeft(Math.max(0, Math.ceil((target - Date.now()) / 1000)))
    }
    update()
    const id = setInterval(update, 500)
    return () => clearInterval(id)
  }, [nextRoundAt])

  const m = Math.floor(secsLeft / 60), s = secsLeft % 60
  const label = m > 0 ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`
  return (
    <span style={{ fontSize: 12, color: secsLeft <= 10 ? '#ff8080' : '#9a6a6a', whiteSpace: 'nowrap' }}>
      next round in {label}
    </span>
  )
}

function InfoTooltip({ children }) {
  const [hover, setHover] = useState(false)
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
        border: '1px solid rgba(190,60,50,0.5)', color: '#c08080',
        fontSize: 11, cursor: 'pointer', position: 'relative',
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => setHover(h => !h)}
    >
      ?
      {hover && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 6,
          background: 'rgba(20,8,8,0.98)', border: '1px solid rgba(190,60,50,0.45)',
          borderRadius: 6, padding: '12px 14px',
          fontSize: 12, color: '#c9b99a', fontFamily: 'Georgia, serif',
          boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
          zIndex: 100, width: 260, maxWidth: 'calc(100vw - 32px)', textAlign: 'left', lineHeight: 1.6, whiteSpace: 'normal',
        }}>
          {children}
        </div>
      )}
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

function StrengthBar({ strength, maxStrength, initialQty, color, losses, side }) {
  const pct = maxStrength > 0 ? Math.min(100, (strength / maxStrength) * 100) : 0

  // Fixed two rows of real 1:1 soldier icons - past that, fold the rest into
  // a "…N" slot instead of endlessly stretching what one icon represents.
  const COLS = 8
  const CAP = COLS * 2
  const peakQty = Math.max(1, Math.round(initialQty || 1))
  const overCap = peakQty > CAP
  const shownIcons = overCap ? CAP - 1 : peakQty

  // Real losses (tracked exactly in combat.js), not a strength-ratio estimate -
  // strength is fort/terrain-boosted for the defender, so a ratio against it
  // doesn't land on the real troop count the way this needs to.
  const aliveTotal = Math.max(0, peakQty - Math.round(losses || 0))
  const aliveShown = Math.min(shownIcons, aliveTotal)
  const overflowAlive = Math.max(0, aliveTotal - shownIcons)

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
      <div style={{
        display: 'grid', gridTemplateColumns: `repeat(${COLS}, auto)`, gap: 3, marginTop: 10,
        justifyContent: side === 'right' ? 'end' : 'start',
      }}>
        {Array.from({ length: shownIcons }, (_, i) => {
          // Soldiers die from the outer edge inward (toward the front line)
          const dead = side === 'left' ? i >= aliveShown : i < shownIcons - aliveShown
          return <SoldierIcon key={i} color={color} dead={dead} mirror={side === 'right'} />
        })}
        {overCap && (
          <Tooltip
            text={`${overflowAlive} more troops not individually pictured`}
            style={{
              display: 'flex', alignItems: 'center',
              fontSize: 12, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
              color: overflowAlive > 0 ? color : '#665050',
              opacity: overflowAlive > 0 ? 0.85 : 0.4,
            }}
          >
            …{overflowAlive}
          </Tooltip>
        )}
      </div>
      <div style={{ fontSize: 13, color: '#c9b99a', marginTop: 6 }}>
        {aliveTotal} troops remaining
      </div>
      <div style={{ fontSize: 13, color: '#9a7a7a' }}>
        Lost: {Math.round(losses || 0)} troops
      </div>
    </div>
  )
}

export default function BattlePanel({ hex, player, onMarchStart, onClose }) {
  const isMobile = useIsMobile()
  const [data, setData] = useState(null)

  // load() is shared between the effect below and the 'battle:update' socket
  // handler, so a simple per-effect cancelled flag isn't enough - switching
  // hexes quickly could still let an older in-flight request for a previous
  // hex land after a newer one. Guard by comparing against the latest
  // requested hex instead, dropping any response that's no longer current.
  const currentHexRef = useRef(hex.h3)
  useEffect(() => { currentHexRef.current = hex.h3 })

  const load = useCallback(async () => {
    const requestedHex = hex.h3
    try {
      const result = await api.getBattle(requestedHex)
      if (currentHexRef.current !== requestedHex) return
      setData(result.battle ? result : null)
    } catch {
      // hex may have no active battle (or it just concluded) - treat as no data
    }
  }, [hex.h3])

  // load() sets state from an async fetch keyed on hex.h3 - there's no pure-render
  // substitute for "go fetch this and show it when it arrives".
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])
  useSocket({ 'battle:update': load })

  if (!data?.battle) return null

  const { battle, participants } = data
  // Combat resolves in discrete dice clashes, not a continuously-decaying pool -
  // there's nothing to smoothly animate between polls, so this shows the real
  // last-synced numbers only (same reasoning as the gold display).
  const display = {
    atkStr: Number(battle.attacker_strength),
    defStr: Number(battle.defender_strength),
    atkLoss: Number(battle.attacker_losses),
    defLoss: Number(battle.defender_losses),
  }
  const initialAtkStr = display.atkStr + display.atkLoss
  const initialDefStr = display.defStr + display.defLoss
  const maxStr = Math.max(initialAtkStr, initialDefStr, 1)
  const isParticipant = player && (player.id === battle.attacker_id || player.id === battle.defender_id)
  const concluded = battle.status !== 'active'
  const attackerWon = battle.status === 'attacker_won'

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
      paddingBottom: 'env(safe-area-inset-bottom)',
    }}>
      <div style={{
        display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: isMobile ? 6 : 10,
        padding: isMobile ? '12px 16px' : '14px 28px',
        borderBottom: '1px solid rgba(190,60,50,0.2)',
      }}>
        <span style={{
          fontSize: isMobile ? 14 : 16, letterSpacing: isMobile ? 2 : 4,
          color: concluded ? (attackerWon ? '#70e090' : '#ff8080') : '#e07060',
          textTransform: 'uppercase', whiteSpace: 'nowrap',
        }}>
          <SwordsIcon size={15} color={concluded ? (attackerWon ? '#70e090' : '#ff8080') : '#e07060'} />{' '}
          {concluded ? `${attackerWon ? battle.attacker_username : battle.defender_username} Wins!` : 'Battle in Progress'}
        </span>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: isMobile ? 8 : 14 }}>
          <span style={{ fontSize: 13, color: '#9a6a6a', whiteSpace: 'nowrap' }}>
            {isMobile ? 'C' : 'Clash '}{battle.round_number}
          </span>
          {!isMobile && !concluded && <RoundTimer nextRoundAt={data.next_round_at} />}
          <InfoTooltip>
            Combat resolves in <b style={{ color: '#e0a090' }}>clashes</b>, not one long grind: both
            sides field up to 10 troops on the frontline, each rolls a d20, and pairings are random
            (not highest-vs-highest) - low roll loses that pairing (ties favor the defender). Losers
            are removed; survivors refill the frontline from reserve for the next clash.
            <br /><br />
            <b style={{ color: '#e0a090' }}>Fortification</b> doesn't add more dice or a bigger
            frontline - up to 5 of the defender's frontline instead roll <b>with advantage</b> (2
            dice, take the higher): fort +3, compact borders +1 per friendly neighbor (max +4),
            strategic hex +2. This hex's defender:{' '}
            <b style={{ color: '#e0a090' }}>
              {Math.min(Number(battle.defender_advantage_troops) || 0, Number(battle.defender_frontline) || 0)} of {Number(battle.defender_frontline) || 0}
            </b> frontline troops rolling with advantage.
            <br /><br />
            <b style={{ color: '#e0a090' }}>Str</b> shown below is just the real troop count on
            each side - no hidden multiplier.
            <br /><br />
            <b style={{ color: '#e0a090' }}>Figures</b> below = real troops, one icon each,
            up to two rows. Past that, the rest show as a plain "…N" count instead.
          </InfoTooltip>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#9a6a6a', cursor: 'pointer', fontSize: 24, lineHeight: 1 }}>×</button>
        </div>
      </div>

      <div style={{ padding: isMobile ? '16px 16px 20px' : '22px 32px 26px', maxHeight: isMobile ? '52dvh' : '42vh', overflowY: 'auto' }}>
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

        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#9a7a7a', marginTop: -8, marginBottom: 12 }}>
          <span>Attacker frontline: {battle.attacker_frontline} / 10</span>
          <span>
            Defender frontline: {battle.defender_frontline} / 10
            {Number(battle.defender_advantage_troops) > 0 && ` · ${Math.min(Number(battle.defender_advantage_troops), Number(battle.defender_frontline) || 0)} w/ advantage`}
          </span>
        </div>

        {concluded && (
          <div style={{
            textAlign: 'center', padding: '10px 14px', marginBottom: 16, borderRadius: 6,
            background: attackerWon ? 'rgba(40,120,60,0.18)' : 'rgba(120,40,40,0.18)',
            border: `1px solid ${attackerWon ? 'rgba(70,180,100,0.4)' : 'rgba(180,70,70,0.4)'}`,
            fontSize: 14, color: attackerWon ? '#a0e0b0' : '#e0a0a0',
          }}>
            {attackerWon
              ? `${battle.attacker_username} took the hex with ${Math.round(Number(battle.attacker_troops))} troops surviving.`
              : `${battle.defender_username} held the hex with ${Math.round(Number(battle.defender_troops))} troops surviving.`}
          </div>
        )}

        {display && (
          <div style={{ display: 'flex', gap: isMobile ? 16 : 40, marginBottom: 16 }}>
            <StrengthBar
              strength={display.atkStr} maxStrength={maxStr}
              initialQty={totalAtkQty}
              color={battle.attacker_color} losses={display.atkLoss} side="left"
            />
            <StrengthBar
              strength={display.defStr} maxStrength={maxStr}
              initialQty={totalDefQty}
              color={battle.defender_color} losses={display.defLoss} side="right"
            />
          </div>
        )}

        <div style={{ borderTop: '1px solid rgba(190,60,50,0.15)', marginBottom: 14 }} />

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

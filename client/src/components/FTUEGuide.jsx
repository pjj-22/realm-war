import { useState } from 'react'
import { api } from '../api/client'
import { BannerIcon, SwordsIcon, KeepIcon, BoltIcon, TargetIcon } from './Icons'
import { useIsMobile } from '../hooks/useIsMobile'

const STEPS = [
  {
    id: 'claim',
    title: 'Claim your first territory',
    body: 'Zoom in on the map and click any hex to claim it. Your empire starts here. Marauder camps will appear nearby - raid them for gold.',
    icon: BannerIcon,
  },
  {
    id: 'train',
    title: 'Train your troops',
    body: 'Open the Military tab on your hex and queue some troops. Training is slow here - your capital\'s one building slot is already taken by its free Mine, so a faster Barracks will have to go on the next hex you claim.',
    icon: SwordsIcon,
  },
  {
    id: 'march',
    title: 'Expand your empire',
    body: 'Select troops in the Military tab, hit March, then click an adjacent hex. Claim it to grow your territory.',
    icon: BoltIcon,
  },
  {
    id: 'build',
    title: 'Build a Barracks',
    body: 'Each hex holds one building, and your capital\'s slot is taken by its free Mine. On a hex you just claimed, open Buildings and add a Barracks - troops train 10× faster there.',
    icon: KeepIcon,
  },
]

const STORAGE_KEY = 'rw_ftue_step'

export default function FTUEGuide({ player, onDismiss }) {
  const isMobile = useIsMobile()
  const [stepId, setStepId] = useState(() => localStorage.getItem(STORAGE_KEY) || 'claim')
  const [dismissed, setDismissed] = useState(false)

  function advance(nextId) {
    if (nextId) {
      setStepId(nextId)
      localStorage.setItem(STORAGE_KEY, nextId)
    } else {
      localStorage.setItem(STORAGE_KEY, 'done')
      setDismissed(true)
      onDismiss?.()
    }
  }

  // Auto-advance past 'claim' once a capital exists. This adjusts state from a
  // prop during render (React's documented pattern for this - see "you might
  // not need an effect"/"adjusting state when a prop changes") rather than an
  // effect, since the condition stops being true the instant it fires.
  if (stepId === 'claim' && player?.capital_hex) {
    advance('train')
  }

  if (dismissed || localStorage.getItem(STORAGE_KEY) === 'done') return null

  const idx = STEPS.findIndex(s => s.id === stepId)
  if (idx === -1) return null
  const step = STEPS[idx]
  const isLast = idx === STEPS.length - 1

  return (
    <div style={{
      position: 'absolute',
      top: isMobile ? 'calc(env(safe-area-inset-top) + 52px)' : 60,
      left: isMobile ? 12 : 16,
      right: isMobile ? 12 : 'auto',
      width: isMobile ? 'auto' : 260,
      maxWidth: isMobile ? 'none' : 260,
      background: 'linear-gradient(180deg, rgba(18,10,30,0.97), rgba(10,6,20,0.98))',
      border: '1px solid rgba(160,110,200,0.4)',
      borderRadius: 8,
      boxShadow: '0 4px 24px rgba(0,0,0,0.6), 0 0 0 1px rgba(120,80,200,0.1)',
      fontFamily: 'Georgia, serif',
      zIndex: 25,
      overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', gap: 4, padding: '10px 14px 0', justifyContent: 'center' }}>
        {STEPS.map((s, i) => (
          <div key={s.id} style={{
            width: i === idx ? 16 : 6, height: 6, borderRadius: 3,
            background: i < idx ? '#6040a0' : i === idx ? '#a070e0' : 'rgba(255,255,255,0.12)',
            transition: 'all 0.3s',
          }} />
        ))}
      </div>

      <div style={{ padding: '12px 16px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <step.icon size={18} color="#c090f0" />
          <span style={{ fontSize: 14, color: '#c090f0', letterSpacing: 2, textTransform: 'uppercase' }}>
            {step.title}
          </span>
        </div>
        <p style={{ fontSize: 14, color: '#9a8898', lineHeight: 1.6, margin: '0 0 14px' }}>
          {step.body}
        </p>
        {step.id === 'claim' && (
          <>
            <button
              onClick={async () => {
                try {
                  const s = await api.suggestStart()
                  window.dispatchEvent(new CustomEvent('rw:flyto', { detail: { lat: s.lat, lng: s.lng, zoom: 9.5 } }))
                } catch { /* no suggestion available */ }
              }}
              style={{
                width: '100%', padding: '7px 0', marginBottom: 6,
                background: 'rgba(200,140,40,0.18)',
                border: '1px solid rgba(220,160,60,0.45)',
                borderRadius: 4, color: '#e0b060',
                cursor: 'pointer', fontSize: 14,
                letterSpacing: 1, fontFamily: 'Georgia, serif',
              }}>
              <TargetIcon size={13} color="#e0b060" /> Take me to the front
            </button>
            <p style={{ fontSize: 14, color: '#8a7898', lineHeight: 1.6, margin: '0 0 14px' }}>
              Fast action, but risky - established players are already fighting
              nearby. If you'd rather build up safely first, just click any hex
              on the map instead.
            </p>
          </>
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {step.id === 'claim' ? (
            <span style={{ flex: 1, fontSize: 12, color: '#5a4860', fontStyle: 'italic' }}>
              This advances on its own once you claim a hex.
            </span>
          ) : (
            <button
              onClick={() => advance(STEPS[idx + 1]?.id || null)}
              style={{
                flex: 1, padding: '7px 0',
                background: 'rgba(120,60,200,0.25)',
                border: '1px solid rgba(160,80,220,0.4)',
                borderRadius: 4, color: '#c090f0',
                cursor: 'pointer', fontSize: 14,
                letterSpacing: 1, fontFamily: 'Georgia, serif',
              }}>
              {isLast ? 'Got it - good luck!' : 'Got it →'}
            </button>
          )}
          <button
            onClick={() => { localStorage.setItem(STORAGE_KEY, 'done'); setDismissed(true); onDismiss?.() }}
            style={{
              padding: '7px 10px', background: 'none',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 4, color: '#5a4860',
              cursor: 'pointer', fontSize: 14,
              fontFamily: 'Georgia, serif',
            }}>
            Skip
          </button>
        </div>
      </div>
    </div>
  )
}

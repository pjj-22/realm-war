import { useState, useEffect } from 'react'

const STEPS = [
  {
    id: 'claim',
    title: 'Claim your first territory',
    body: 'Zoom in on the map and click any hex to claim it. Your empire starts here.',
    icon: '⚑',
  },
  {
    id: 'build',
    title: 'Build a Barracks',
    body: 'Click your hex → Buildings tab → build a Barracks. It unlocks troop training and halves train time. You already have a free Mine for gold income.',
    icon: '⚔',
  },
  {
    id: 'train',
    title: 'Train your troops',
    body: 'Open the Military tab on your hex and train some troops. They\'ll be ready in seconds.',
    icon: '🗡',
  },
  {
    id: 'march',
    title: 'Expand your empire',
    body: 'Select troops in the Military tab, hit March, then click an adjacent hex. Claim it to grow your territory.',
    icon: '⚡',
  },
]

const STORAGE_KEY = 'rw_ftue_step'

export default function FTUEGuide({ player, onDismiss }) {
  const [stepId, setStepId] = useState(() => localStorage.getItem(STORAGE_KEY) || 'claim')
  const [dismissed, setDismissed] = useState(false)

  // Auto-advance from 'claim' step once player has a capital hex
  useEffect(() => {
    if (stepId === 'claim' && player?.capital_hex) {
      advance('build')
    }
  }, [player?.capital_hex, stepId])

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

  if (dismissed || localStorage.getItem(STORAGE_KEY) === 'done') return null

  const idx = STEPS.findIndex(s => s.id === stepId)
  if (idx === -1) return null
  const step = STEPS[idx]
  const isLast = idx === STEPS.length - 1

  return (
    <div style={{
      position: 'absolute', top: 60, left: 16,
      width: 260,
      background: 'linear-gradient(180deg, rgba(18,10,30,0.97), rgba(10,6,20,0.98))',
      border: '1px solid rgba(160,110,200,0.4)',
      borderRadius: 8,
      boxShadow: '0 4px 24px rgba(0,0,0,0.6), 0 0 0 1px rgba(120,80,200,0.1)',
      fontFamily: 'Georgia, serif',
      zIndex: 25,
      overflow: 'hidden',
    }}>
      {/* Progress dots */}
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
          <span style={{ fontSize: 18 }}>{step.icon}</span>
          <span style={{ fontSize: 14, color: '#c090f0', letterSpacing: 2, textTransform: 'uppercase' }}>
            {step.title}
          </span>
        </div>
        <p style={{ fontSize: 14, color: '#9a8898', lineHeight: 1.6, margin: '0 0 14px' }}>
          {step.body}
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
            {isLast ? 'Got it — good luck!' : 'Got it →'}
          </button>
          {idx > 0 && (
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
          )}
        </div>
      </div>
    </div>
  )
}

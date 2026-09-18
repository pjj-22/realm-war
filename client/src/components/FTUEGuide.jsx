import { useState, useEffect } from 'react'
import { api } from '../api/client'
import { BannerIcon, SwordsIcon, KeepIcon, BoltIcon, TargetIcon, GoldIcon, CrownIcon, TentIcon } from './Icons'
import { useIsMobile } from '../hooks/useIsMobile'

// One verb per step. Action steps advance only when the player actually does
// the thing (ftueBus events from the success paths, or the player record
// changing), never on a button - the card is a checklist the game ticks off,
// not a reading assignment next to it. Mechanics (building slots, exact
// bonuses) are deliberately left to the UI they belong to.
const STEPS = [
  {
    id: 'claim',
    title: 'Found your capital',
    body: 'Click any land hex. It comes with troops and a mine.',
    icon: BannerIcon,
  },
  {
    id: 'train',
    title: 'Train 5 troops',
    body: 'Military tab → Train.',
    icon: SwordsIcon,
  },
  {
    id: 'march',
    title: 'Take the hex next door',
    body: 'Military → March → click a neighbor. 5 troops claim it on arrival.',
    icon: BoltIcon,
  },
  {
    id: 'build',
    title: 'Build a Barracks on it',
    body: 'Buildings tab → Barracks. Troops train 10× faster there.',
    icon: KeepIcon,
  },
  {
    id: 'banner',
    title: 'Raise your banner',
    body: 'Design the flag that flies over your capital.',
    icon: BannerIcon,
  },
  {
    id: 'world',
    title: 'The long game',
    icon: CrownIcon,
  },
]

// What the world is actually about - shown once the basics are done, when
// there's something on the map to relate it to.
const WORLD = [
  { icon: GoldIcon, label: 'Landmarks', text: 'Gold-bordered hexes - London, Paris, the Eiffel Tower - pay bonus gold every tick, and more for each hex you hold around them.' },
  { icon: CrownIcon, label: 'Crowns', text: "Hold a country's capital city and enough of its land, and you're crowned its Ruler for the whole world to see." },
  { icon: BannerIcon, label: 'Seasons', text: 'When the season timer up top runs out, the largest empire is crowned Champion and the map resets. Your account, banner and titles carry over.' },
]

const STORAGE_KEY = 'rw_ftue_step'

export default function FTUEGuide({ player, onDismiss, onDesignBanner }) {
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

  // Train/march/build report in from where they succeed (see ftueBus.js);
  // only the current step's own event moves the card forward.
  useEffect(() => {
    const NEXT = { train: 'march', march: 'build', build: 'banner' }
    function onProgress(e) {
      if (e.detail === stepId && NEXT[stepId]) advance(NEXT[stepId])
    }
    window.addEventListener('rw:ftue', onProgress)
    return () => window.removeEventListener('rw:ftue', onProgress)
  }, [stepId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Steps keyed on the player record adjust state from a prop during render
  // (React's documented pattern - "adjusting state when a prop changes")
  // rather than in an effect, since the condition stops being true the
  // instant it fires.
  if (stepId === 'claim' && player?.capital_hex) advance('train')
  if (stepId === 'banner' && player?.flag_pixels) advance('world')

  if (dismissed || localStorage.getItem(STORAGE_KEY) === 'done') return null

  const idx = STEPS.findIndex(s => s.id === stepId)
  if (idx === -1) return null
  const step = STEPS[idx]

  const actionBtn = {
    width: '100%', padding: '7px 0', marginBottom: 10,
    background: 'rgba(200,140,40,0.18)',
    border: '1px solid rgba(220,160,60,0.45)',
    borderRadius: 4, color: '#e0b060',
    cursor: 'pointer', fontSize: 14,
    letterSpacing: 1, fontFamily: 'Georgia, serif',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  }

  return (
    <div style={{
      position: 'absolute',
      top: isMobile ? 'calc(env(safe-area-inset-top) + 52px)' : 60,
      left: isMobile ? 12 : 16,
      right: isMobile ? 12 : 'auto',
      width: isMobile ? 'auto' : 280,
      maxWidth: isMobile ? 'none' : 280,
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

        {step.body && (
          <p style={{ fontSize: 15, color: '#b0a0b8', lineHeight: 1.55, margin: '0 0 12px' }}>
            {step.body}
          </p>
        )}

        {step.id === 'claim' && (
          <button
            onClick={async () => {
              try {
                const s = await api.suggestStart()
                window.dispatchEvent(new CustomEvent('rw:flyto', { detail: { lat: s.lat, lng: s.lng, zoom: 9.5 } }))
              } catch { /* no suggestion available */ }
            }}
            style={actionBtn}>
            <TargetIcon size={13} color="#e0b060" /> Find me a good spot
          </button>
        )}

        {step.id === 'banner' && (
          <button onClick={() => onDesignBanner?.()} style={actionBtn}>
            <BannerIcon size={13} color="#e0b060" /> Design my banner
          </button>
        )}

        {step.id === 'world' && (
          <div style={{ marginBottom: 12 }}>
            {WORLD.map(w => (
              <div key={w.label} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 10 }}>
                <span style={{ flexShrink: 0, marginTop: 2 }}><w.icon size={15} color="#e0b060" /></span>
                <div style={{ fontSize: 13, lineHeight: 1.5, color: '#9a8898' }}>
                  <span style={{ color: '#e0c070' }}>{w.label} · </span>{w.text}
                </div>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
              <span style={{ flexShrink: 0, marginTop: 2 }}><TentIcon size={15} color="#c090f0" /></span>
              <div style={{ fontSize: 13, lineHeight: 1.5, color: '#b0a0b8' }}>
                That tent near your capital is a marauder camp. Take it for your first plunder.
              </div>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {step.id === 'world' ? (
            <button
              onClick={() => advance(null)}
              style={{
                flex: 1, padding: '7px 0',
                background: 'rgba(120,60,200,0.25)',
                border: '1px solid rgba(160,80,220,0.4)',
                borderRadius: 4, color: '#c090f0',
                cursor: 'pointer', fontSize: 14,
                letterSpacing: 1, fontFamily: 'Georgia, serif',
              }}>
              To war
            </button>
          ) : (
            <span style={{ flex: 1, fontSize: 12, color: '#5a4860', fontStyle: 'italic' }}>
              {idx + 1} of {STEPS.length} · moves on when you do it
            </span>
          )}
          <button
            onClick={() => advance(null)}
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

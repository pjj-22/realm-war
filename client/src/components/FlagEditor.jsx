import { useEffect, useRef, useState } from 'react'
import {
  FLAG_SIZE, PALETTE, PALETTE_CHARS, PATTERNS, SCHEMES,
  applyPatternScheme, randomFlagString, drawFlagToCanvas,
} from '../flags'
import { useIsMobile } from '../hooks/useIsMobile'
import Tooltip from './Tooltip'
import { DiceIcon } from './Icons'

function Thumb({ pixels, size = 40 }) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current) drawFlagToCanvas(pixels.join(''), ref.current, size / FLAG_SIZE)
  }, [pixels, size])
  return <canvas ref={ref} style={{ width: size, height: size, imageRendering: 'pixelated', borderRadius: 3, border: '1px solid rgba(160,110,30,0.3)' }} />
}

function SchemeSwatch({ colors, size = 40 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: 3, overflow: 'hidden',
      display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr',
      border: '1px solid rgba(160,110,30,0.3)',
    }}>
      {colors.map((c, i) => <div key={i} style={{ background: PALETTE[PALETTE_CHARS.indexOf(c)] }} />)}
    </div>
  )
}

const MOTTO_MAX = 50

export default function FlagEditor({ initialFlag, initialMotto, onSave, onSkip }) {
  const isMobile = useIsMobile()
  const [patternIdx, setPatternIdx] = useState(0)
  const [schemeIdx, setSchemeIdx] = useState(0)
  const [pixels, setPixels] = useState(() =>
    (initialFlag && initialFlag.length === 256 ? initialFlag : applyPatternScheme(PATTERNS[0].grid, SCHEMES[0].colors)).split('')
  )
  const [motto, setMotto] = useState(initialMotto || '')
  const [brush, setBrush] = useState(SCHEMES[0].colors[1])
  const paintingRef = useRef(false)

  function applyPattern(i) {
    setPatternIdx(i)
    setPixels(applyPatternScheme(PATTERNS[i].grid, SCHEMES[schemeIdx].colors).split(''))
  }
  function applyScheme(i) {
    setSchemeIdx(i)
    setPixels(applyPatternScheme(PATTERNS[patternIdx].grid, SCHEMES[i].colors).split(''))
  }
  function paint(cellIdx) {
    setPixels(prev => {
      if (prev[cellIdx] === brush) return prev
      const next = prev.slice()
      next[cellIdx] = brush
      return next
    })
  }
  function randomize() {
    setPixels(randomFlagString().split(''))
  }

  // Touch has no hover/enter events to chain into a drag-paint the way mouse
  // does, so drag-painting on mobile is driven off touch coordinates instead -
  // find whichever cell is currently under the finger and paint it.
  function paintFromTouch(e) {
    const touch = e.touches[0]
    if (!touch) return
    const el = document.elementFromPoint(touch.clientX, touch.clientY)
    const idx = el?.getAttribute?.('data-idx')
    if (idx != null) paint(Number(idx))
  }

  const gridSize = isMobile ? 300 : 256

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', justifyContent: 'center' }}>
        <div
          onMouseLeave={() => { paintingRef.current = false }}
          onMouseUp={() => { paintingRef.current = false }}
          onTouchStart={e => { paintingRef.current = true; paintFromTouch(e) }}
          onTouchMove={e => { if (paintingRef.current) paintFromTouch(e) }}
          onTouchEnd={() => { paintingRef.current = false }}
          style={{
            width: gridSize, height: gridSize, display: 'grid',
            gridTemplateColumns: `repeat(${FLAG_SIZE}, 1fr)`, gridTemplateRows: `repeat(${FLAG_SIZE}, 1fr)`,
            border: '2px solid rgba(160,110,30,0.5)', borderRadius: 4, overflow: 'hidden',
            touchAction: 'none', // let us drive painting from touch coords instead of the page scrolling
            imageRendering: 'pixelated', flexShrink: 0,
          }}
        >
          {pixels.map((ch, i) => (
            <div
              key={i}
              data-idx={i}
              onMouseDown={() => { paintingRef.current = true; paint(i) }}
              onMouseEnter={() => { if (paintingRef.current) paint(i) }}
              onClick={() => paint(i)}
              style={{ background: PALETTE[PALETTE_CHARS.indexOf(ch)], cursor: 'pointer' }}
            />
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: isMobile ? gridSize : 220 }}>
          <div style={{ fontSize: 12, letterSpacing: 2, textTransform: 'uppercase', color: '#9a8060' }}>Palette</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: isMobile ? 8 : 5 }}>
            {PALETTE_CHARS.split('').map((ch, i) => (
              <button
                key={ch}
                onClick={() => setBrush(ch)}
                style={{
                  width: isMobile ? 34 : 22, height: isMobile ? 34 : 22, borderRadius: 3, padding: 0, cursor: 'pointer',
                  background: PALETTE[i],
                  border: brush === ch ? '2px solid #f0c040' : '1px solid rgba(0,0,0,0.4)',
                }}
              />
            ))}
          </div>
          <button
            onClick={randomize}
            style={{
              marginTop: 6, padding: '7px 0', background: 'rgba(120,60,200,0.2)',
              border: '1px solid rgba(160,80,220,0.4)', borderRadius: 4, color: '#c090f0',
              cursor: 'pointer', fontSize: 13, letterSpacing: 1, fontFamily: 'Georgia, serif',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            <DiceIcon size={13} /> Randomize
          </button>
        </div>
      </div>

      <div>
        <div style={{ fontSize: 12, letterSpacing: 2, textTransform: 'uppercase', color: '#9a8060', marginBottom: 8 }}>Patterns</div>
        <div style={{ display: 'flex', gap: isMobile ? 10 : 8, flexWrap: 'wrap' }}>
          {PATTERNS.map((p, i) => (
            <Tooltip key={p.id} text={p.name}>
              <button onClick={() => applyPattern(i)}
                style={{ padding: 0, background: 'none', border: i === patternIdx ? '2px solid #f0c040' : '2px solid transparent', borderRadius: 5, cursor: 'pointer' }}>
                <Thumb pixels={applyPatternScheme(p.grid, SCHEMES[schemeIdx].colors).split('')} size={isMobile ? 48 : 40} />
              </button>
            </Tooltip>
          ))}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 12, letterSpacing: 2, textTransform: 'uppercase', color: '#9a8060', marginBottom: 8 }}>Color Schemes</div>
        <div style={{ display: 'flex', gap: isMobile ? 10 : 8, flexWrap: 'wrap' }}>
          {SCHEMES.map((s, i) => (
            <Tooltip key={s.id} text={s.name}>
              <button onClick={() => applyScheme(i)}
                style={{ padding: 0, background: 'none', border: i === schemeIdx ? '2px solid #f0c040' : '2px solid transparent', borderRadius: 5, cursor: 'pointer' }}>
                <SchemeSwatch colors={s.colors} size={isMobile ? 48 : 40} />
              </button>
            </Tooltip>
          ))}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 12, letterSpacing: 2, textTransform: 'uppercase', color: '#9a8060', marginBottom: 8 }}>
          Motto <span style={{ color: '#5a4838', textTransform: 'none', letterSpacing: 0 }}>({motto.length}/{MOTTO_MAX})</span>
        </div>
        <input
          value={motto}
          onChange={e => setMotto(e.target.value.slice(0, MOTTO_MAX))}
          maxLength={MOTTO_MAX}
          placeholder="A line for the history books..."
          style={{
            width: '100%', padding: '9px 12px', background: 'rgba(0,0,0,0.3)',
            border: '1px solid rgba(160,110,30,0.35)', borderRadius: 4, color: '#e0c070',
            fontSize: 14, fontFamily: 'Georgia, serif', fontStyle: 'italic',
          }}
        />
      </div>

      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 4 }}>
        {onSkip && (
          <button onClick={onSkip} style={{
            padding: '9px 18px', background: 'none', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 4, color: '#7a6858', cursor: 'pointer', fontSize: 14, fontFamily: 'Georgia, serif',
          }}>
            Skip - pick for me
          </button>
        )}
        <button onClick={() => onSave(pixels.join(''), motto)} style={{
          padding: '9px 24px', background: 'rgba(200,140,40,0.22)', border: '1px solid rgba(220,160,60,0.5)',
          borderRadius: 4, color: '#e0b060', cursor: 'pointer', fontSize: 14, letterSpacing: 1, fontFamily: 'Georgia, serif',
        }}>
          Fly Your Colors
        </button>
      </div>
    </div>
  )
}

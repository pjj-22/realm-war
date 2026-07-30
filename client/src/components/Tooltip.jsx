import { useState } from 'react'

// A help tooltip that actually works on mobile. The native `title` attribute
// only shows on hover, which touch devices have no concept of at all - tapping
// an element with just `title=` does nothing on iOS/Android. This wraps its
// children and shows a popover on hover (desktop) OR tap (mobile), matching
// the tap-to-toggle pattern already proven in BattlePanel's InfoTooltip.
// Always wraps children in the same span regardless of whether `text` is
// set, so a card's flex/layout behavior (e.g. style={{ flex: 1 }}) doesn't
// change depending on tooltip state - pass style through for that, don't
// rely on this component's own default display mode for layout-critical uses.
export default function Tooltip({ text, placement = 'top', children, style }) {
  const [open, setOpen] = useState(false)

  const placementStyle = placement === 'bottom'
    ? { top: '100%', marginTop: 6 }
    : { bottom: '100%', marginBottom: 6 }

  return (
    <span
      style={{ position: 'relative', ...style }}
      onMouseEnter={() => text && setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onClick={e => { if (text) { e.stopPropagation(); setOpen(o => !o) } }}
    >
      {children}
      {open && text && (
        <div style={{
          position: 'absolute', left: '50%', transform: 'translateX(-50%)',
          ...placementStyle,
          background: 'rgba(12,8,24,0.98)', border: '1px solid rgba(160,120,220,0.4)',
          borderRadius: 6, padding: '9px 11px', fontSize: 12, color: '#c9b99a',
          whiteSpace: 'pre-line', width: 230, maxWidth: '75vw', zIndex: 50,
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)', textAlign: 'left', lineHeight: 1.5,
          fontFamily: 'Georgia, serif', pointerEvents: 'none',
        }}>
          {text}
        </div>
      )}
    </span>
  )
}

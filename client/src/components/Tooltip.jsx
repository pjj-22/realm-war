import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'

// A help tooltip that actually works on mobile. The native `title` attribute
// only shows on hover, which touch devices have no concept of at all - tapping
// an element with just `title=` does nothing on iOS/Android. This wraps its
// children and shows a popover on hover (desktop) OR tap (mobile), matching
// the tap-to-toggle pattern already proven in BattlePanel's InfoTooltip.
// Always wraps children in the same span regardless of whether `text` is
// set, so a card's flex/layout behavior (e.g. style={{ flex: 1 }}) doesn't
// change depending on tooltip state - pass style through for that, don't
// rely on this component's own default display mode for layout-critical uses.
//
// The popover portals to document.body instead of positioning relative to
// its own trigger - several callers (BottomDrawer's scrollable tab content,
// the top bar's horizontal-scroll strip) sit inside an `overflow` ancestor
// that would otherwise clip an absolutely-positioned popover into invisibility
// the instant it's near that ancestor's edge, regardless of z-index.
export default function Tooltip({ text, placement = 'top', children, style }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const anchorRef = useRef(null)

  function show() {
    if (!text) return
    const r = anchorRef.current?.getBoundingClientRect()
    if (r) {
      // Centering the box on the anchor's midpoint (old behavior) pushes it
      // off-screen whenever the anchor isn't near horizontal center - which
      // is most of the time on a phone-width screen (e.g. the Income card
      // in BottomDrawer sits at the left edge of a row of cards). Clamp the
      // box's left edge to stay within the viewport instead.
      const margin = 8
      const boxWidth = Math.min(230, window.innerWidth * 0.75)
      const center = r.left + r.width / 2
      const left = Math.min(
        Math.max(center - boxWidth / 2, margin),
        Math.max(margin, window.innerWidth - boxWidth - margin)
      )
      // A 'top' placement that opens upward too close to the top of the
      // viewport (e.g. a tag near the top of the BottomDrawer header)
      // renders mostly above y=0 - flip it downward instead.
      const effectivePlacement = placement === 'top' && r.top < 100 ? 'bottom' : placement
      setPos({
        top: effectivePlacement === 'bottom' ? r.bottom + 6 : r.top - 6,
        left,
        width: boxWidth,
        placement: effectivePlacement,
      })
    }
    setOpen(true)
  }

  return (
    <span
      ref={anchorRef}
      style={{ position: 'relative', ...style }}
      onMouseEnter={show}
      onMouseLeave={() => setOpen(false)}
      onClick={e => { if (text) { e.stopPropagation(); open ? setOpen(false) : show() } }}
    >
      {children}
      {open && text && pos && createPortal(
        <div style={{
          position: 'fixed', left: pos.left, top: pos.top,
          transform: pos.placement === 'bottom' ? 'none' : 'translateY(-100%)',
          background: 'rgba(12,8,24,0.98)', border: '1px solid rgba(160,120,220,0.4)',
          borderRadius: 6, padding: '9px 11px', fontSize: 12, color: '#c9b99a',
          whiteSpace: 'pre-line', width: pos.width, zIndex: 1000,
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)', textAlign: 'left', lineHeight: 1.5,
          fontFamily: 'Georgia, serif', pointerEvents: 'none',
        }}>
          {text}
        </div>,
        document.body
      )}
    </span>
  )
}

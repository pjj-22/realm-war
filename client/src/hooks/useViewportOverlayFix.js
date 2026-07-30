import { useEffect, useRef } from 'react'

// iOS Safari positions `fixed` elements against the full layout viewport, not
// the currently-visible visual viewport - when the address bar is expanded
// (e.g. right after a page load, before any scroll), that layout viewport
// extends above what's actually on screen, so a naive `inset:0` overlay
// renders with its top cut off behind Safari's own chrome. Tracking
// window.visualViewport and shifting the overlay to match it is the standard
// fix. No-op (and harmless) on browsers without the API.
export function useViewportOverlayFix() {
  const ref = useRef(null)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv || !ref.current) return

    function sync() {
      if (!ref.current) return
      ref.current.style.transform = `translateY(${vv.offsetTop}px)`
      ref.current.style.height = `${vv.height}px`
    }
    sync()
    vv.addEventListener('resize', sync)
    vv.addEventListener('scroll', sync)
    return () => {
      vv.removeEventListener('resize', sync)
      vv.removeEventListener('scroll', sync)
    }
  }, [])
  return ref
}

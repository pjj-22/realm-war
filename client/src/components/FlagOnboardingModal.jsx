import FlagEditor from './FlagEditor'
import { randomFlagString } from '../flags'
import { api } from '../api/client'
import { useViewportOverlayFix } from '../hooks/useViewportOverlayFix'
import { useIsMobile } from '../hooks/useIsMobile'

function makeStyles(isMobile) { return {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 200, padding: isMobile ? 6 : 16,
  },
  box: {
    background: '#080502', border: '1px solid rgba(160,110,30,0.5)', borderRadius: 10,
    padding: isMobile ? '18px 12px' : '28px 32px', width: '100%', maxWidth: 560,
    maxHeight: '100%', overflowY: 'auto',
    boxShadow: '0 0 60px rgba(160,100,20,0.3)',
    fontFamily: 'Georgia, serif', color: '#c9b99a',
  },
  title: {
    fontSize: 20, letterSpacing: 4, textTransform: 'uppercase',
    textAlign: 'center', marginBottom: 6, color: '#e0c070',
  },
  subtitle: {
    fontSize: 14, color: '#9a8060', textAlign: 'center',
    letterSpacing: 1, marginBottom: 22, lineHeight: 1.5,
  },
} }

// One-time, right after claiming a capital - the flag is permanent (no edit
// route later), so this is the only place it's ever set.
export default function FlagOnboardingModal({ onDone }) {
  const overlayRef = useViewportOverlayFix()
  const isMobile = useIsMobile()
  const S = makeStyles(isMobile)

  async function save(pixels, motto = '') {
    try {
      await api.saveFlag(pixels, motto)
    } catch { /* best-effort - don't block onboarding on a save hiccup */ }
    onDone(pixels, motto)
  }

  return (
    <div ref={overlayRef} style={S.overlay}>
      <div style={S.box}>
        <div style={S.title}>Design Your Banner</div>
        <div style={S.subtitle}>This flies over your capital for good - pick your colors.</div>
        <FlagEditor onSave={save} onSkip={() => save(randomFlagString())} />
      </div>
    </div>
  )
}

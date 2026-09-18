import { useState, useEffect, lazy, Suspense } from 'react'
import GameMap from './components/GameMap'
import AuthModal from './components/AuthModal'
import HelpModal from './components/HelpModal'
import AccountModal from './components/AccountModal'
import FTUEGuide from './components/FTUEGuide'
import FlagOnboardingModal from './components/FlagOnboardingModal'
// Only ever rendered at #admin, so it's split out of the main bundle -
// ~1100 lines of dashboard code every normal player was downloading and
// parsing for nothing.
const AdminPortal = lazy(() => import('./components/AdminPortal'))
import { ToastContainer } from './components/Toast'
import { toast } from './toastBus'
import { api } from './api/client'

if (window.location.hash === '#admin') {
  document.title = 'Admin - HexNation'
}

export default function App() {
  const [player, setPlayer] = useState(null)
  const [checking, setChecking] = useState(true)
  const [showAuth, setShowAuth] = useState(true)
  const [authMode, setAuthMode] = useState('login')
  const [showHelp, setShowHelp] = useState(false)
  const [showAccount, setShowAccount] = useState(false)
  const [showFTUE, setShowFTUE] = useState(false)
  // The banner editor opens on its own the moment a capital exists - except
  // while the guide is running, where it's the "Raise your banner" step and
  // opens from the card instead of cutting in right after the first claim.
  const [bannerRequested, setBannerRequested] = useState(false)

  // Checks stored auth on mount by calling the API - an async fetch, so there's
  // no pure-render substitute for setting player/checking state here.
  useEffect(() => {
    const token = localStorage.getItem('rw_token')
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!token) { setChecking(false); return }
    api.me()
      .then(p => {
        setPlayer(p)
        // Show FTUE for returning players who haven't finished onboarding
        if (localStorage.getItem('rw_ftue_step') && localStorage.getItem('rw_ftue_step') !== 'done') {
          setShowFTUE(true)
        }
      })
      .catch(() => localStorage.removeItem('rw_token'))
      .finally(() => setChecking(false))
  }, [])

  if (window.location.hash === '#admin') return <Suspense fallback={null}><AdminPortal /></Suspense>
  if (checking) return null

  function handleAuth(p, isNew = false, loginBonus = null) {
    setPlayer(p)
    setShowAuth(false)
    if (loginBonus) {
      const streakMsg = loginBonus.streak >= 3 ? ` · Day ${loginBonus.streak} streak!` : ''
      toast(`Daily bonus: +${loginBonus.gold} gold${streakMsg}`, 'success')
    }
    if (isNew || !p.capital_hex) {
      setShowFTUE(true)
    }
  }

  return (
    <>
      <GameMap
        player={player}
        onLoginRequired={(mode) => {
          // The guest CTA passes 'register'; the top-bar button passes a click event
          setAuthMode(mode === 'register' ? 'register' : 'login')
          setShowAuth(true)
        }}
        onPlayerUpdate={updates => setPlayer(p => ({ ...p, ...updates }))}
        onShowHelp={() => setShowHelp(true)}
        onShowAccount={() => setShowAccount(true)}
      />
      {player?.capital_hex && !player?.flag_pixels && (!showFTUE || bannerRequested) && (
        <FlagOnboardingModal onDone={(pixels, motto) => setPlayer(p => ({ ...p, flag_pixels: pixels, motto }))} />
      )}
      {showFTUE && player && (
        <FTUEGuide player={player} onDismiss={() => setShowFTUE(false)} onDesignBanner={() => setBannerRequested(true)} />
      )}
      {!player && showAuth && (
        <AuthModal key={authMode} initialMode={authMode} onAuth={handleAuth} onDismiss={() => setShowAuth(false)} />
      )}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      {showAccount && player && (
        <AccountModal
          username={player.username}
          onClose={() => setShowAccount(false)}
          onDeleted={() => {
            setShowAccount(false)
            setPlayer(null)
            setAuthMode('login')
            setShowAuth(true)
            toast('Your account has been deleted.', 'success')
          }}
          onLogout={() => {
            setShowAccount(false)
            setPlayer(null)
            setAuthMode('login')
            setShowAuth(true)
            toast('Signed out.', 'success')
          }}
        />
      )}
      <ToastContainer />
    </>
  )
}

import { useState, useEffect } from 'react'
import GameMap from './components/GameMap'
import AuthModal from './components/AuthModal'
import HelpModal from './components/HelpModal'
import FTUEGuide from './components/FTUEGuide'
import AdminPortal from './components/AdminPortal'
import { ToastContainer, toast } from './components/Toast'
import { api } from './api/client'

if (window.location.hash === '#admin') {
  document.title = 'Admin - Realm War'
}

export default function App() {
  const [player, setPlayer] = useState(null)
  const [checking, setChecking] = useState(true)

  if (window.location.hash === '#admin') return <AdminPortal />
  const [showAuth, setShowAuth] = useState(true)
  const [authMode, setAuthMode] = useState('login')
  const [showHelp, setShowHelp] = useState(false)
  const [showFTUE, setShowFTUE] = useState(false)

  useEffect(() => {
    const token = localStorage.getItem('rw_token')
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
      />
      {showFTUE && player && (
        <FTUEGuide player={player} onDismiss={() => setShowFTUE(false)} />
      )}
      {!player && showAuth && (
        <AuthModal key={authMode} initialMode={authMode} onAuth={handleAuth} onDismiss={() => setShowAuth(false)} />
      )}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      <ToastContainer />
    </>
  )
}

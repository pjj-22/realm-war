import { useState, useEffect } from 'react'
import GameMap from './components/GameMap'
import AuthModal from './components/AuthModal'
import { api } from './api/client'

export default function App() {
  const [player, setPlayer] = useState(null)
  const [checking, setChecking] = useState(true)
  const [showAuth, setShowAuth] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('rw_token')
    if (!token) { setChecking(false); return }
    api.me()
      .then(setPlayer)
      .catch(() => localStorage.removeItem('rw_token'))
      .finally(() => setChecking(false))
  }, [])

  if (checking) return null

  function handleAuth(p) {
    setPlayer(p)
    setShowAuth(false)
  }

  return (
    <>
      <GameMap
        player={player}
        onLoginRequired={() => setShowAuth(true)}
        onPlayerUpdate={updates => setPlayer(p => ({ ...p, ...updates }))}
      />
      {!player && showAuth && (
        <AuthModal onAuth={handleAuth} onDismiss={() => setShowAuth(false)} />
      )}
    </>
  )
}

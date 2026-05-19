import { useState, useCallback, useEffect, useRef } from 'react'

let _addToast = null

export function toast(message, type = 'error') {
  _addToast?.({ message, type, id: Date.now() + Math.random() })
}

export function ToastContainer() {
  const [toasts, setToasts] = useState([])
  const timers = useRef({})

  _addToast = useCallback((t) => {
    setToasts(prev => [...prev.slice(-4), t])
    timers.current[t.id] = setTimeout(() => {
      setToasts(prev => prev.filter(x => x.id !== t.id))
      delete timers.current[t.id]
    }, 4000)
  }, [])

  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), [])

  if (!toasts.length) return null

  return (
    <div style={{
      position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)',
      display: 'flex', flexDirection: 'column', gap: 8, zIndex: 9999,
      alignItems: 'center', pointerEvents: 'none',
    }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          background: t.type === 'error' ? 'rgba(80,20,20,0.97)' : 'rgba(20,50,20,0.97)',
          border: `1px solid ${t.type === 'error' ? 'rgba(180,50,50,0.6)' : 'rgba(50,140,50,0.6)'}`,
          color: t.type === 'error' ? '#d49090' : '#90d490',
          borderRadius: 6, padding: '9px 18px',
          fontFamily: 'Georgia, serif', fontSize: 13, letterSpacing: 1,
          boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
          animation: 'fadeInUp 0.15s ease',
          whiteSpace: 'nowrap',
        }}>
          {t.message}
        </div>
      ))}
      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}

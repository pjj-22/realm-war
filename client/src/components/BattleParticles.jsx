import { useEffect, useRef } from 'react'
import { cellToLatLng } from 'h3-js'

const PARTICLE_COUNT = 28
const COLORS = ['#ff6600', '#ff3300', '#ffaa00', '#ff5500', '#ff8800', '#ffcc44', '#ff2200']

function makeParticle() {
  return {
    x: 0, y: 0,
    vx: 0, vy: 0,
    life: -Math.random() * 1.5, // staggered start
    maxLife: 0.6 + Math.random() * 0.8,
    size: 1.2 + Math.random() * 2.8,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
  }
}

function resetParticle(p, cx, cy) {
  const angle = Math.random() * Math.PI * 2
  const r = Math.random() * 18
  p.x = cx + Math.cos(angle) * r
  p.y = cy + Math.sin(angle) * r
  p.vx = (Math.random() - 0.5) * 2.2
  p.vy = -1.2 - Math.random() * 2.4
  p.life = p.maxLife
  p.maxLife = 0.5 + Math.random() * 0.9
  p.size = 1.2 + Math.random() * 2.8
  p.color = COLORS[Math.floor(Math.random() * COLORS.length)]
}

export default function BattleParticles({ battles, mapRef }) {
  const canvasRef = useRef(null)
  const battlesRef = useRef(battles)
  battlesRef.current = battles

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')

    function resize() {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    resize()
    window.addEventListener('resize', resize)

    // Particle pools: h3_index -> { particles, prevX, prevY, pulseT }
    const pools = {}

    let raf
    let lastTime = performance.now()

    function frame(now) {
      const dt = Math.min((now - lastTime) / 1000, 0.05) // seconds, capped
      lastTime = now

      ctx.clearRect(0, 0, canvas.width, canvas.height)

      const m = mapRef.current
      if (!m) { raf = requestAnimationFrame(frame); return }

      for (const battle of battlesRef.current) {
        const h3 = battle.h3_index
        const [lat, lng] = cellToLatLng(h3)
        const { x: cx, y: cy } = m.project([lng, lat])

        // Init pool
        if (!pools[h3]) {
          pools[h3] = {
            particles: Array.from({ length: PARTICLE_COUNT }, makeParticle),
            prevX: cx,
            prevY: cy,
            pulseT: Math.random() * Math.PI * 2,
          }
        }

        const pool = pools[h3]
        pool.pulseT += dt * 2.5

        // Offset particles when map pans/zooms
        const dx = cx - pool.prevX
        const dy = cy - pool.prevY
        if (Math.abs(dx) + Math.abs(dy) > 0.01) {
          for (const p of pool.particles) { p.x += dx; p.y += dy }
        }
        pool.prevX = cx
        pool.prevY = cy

        // Draw radial glow under particles
        const pulse = 0.12 + 0.08 * Math.sin(pool.pulseT)
        const glowR = 52 + 10 * Math.sin(pool.pulseT * 0.7)
        const grad = ctx.createRadialGradient(cx, cy, 4, cx, cy, glowR)
        grad.addColorStop(0,   `rgba(255, 90, 20, ${pulse + 0.12})`)
        grad.addColorStop(0.4, `rgba(200, 40, 10, ${pulse})`)
        grad.addColorStop(1,   'rgba(150, 20, 0, 0)')
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.arc(cx, cy, glowR, 0, Math.PI * 2)
        ctx.fill()

        // Update + draw particles
        for (const p of pool.particles) {
          p.life -= dt
          if (p.life < 0) {
            resetParticle(p, cx, cy)
            continue
          }
          p.x  += p.vx * dt * 60
          p.y  += p.vy * dt * 60
          p.vy += 0.06 * dt * 60  // gravity

          const t = p.life / p.maxLife
          const alpha = t < 0.3 ? t / 0.3 : t  // fade in then out
          const size = p.size * (0.4 + 0.6 * t)

          ctx.globalAlpha = Math.min(0.95, alpha)
          ctx.fillStyle = p.color
          ctx.beginPath()
          ctx.arc(p.x, p.y, size, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      // Prune stale pools
      const active = new Set(battlesRef.current.map(b => b.h3_index))
      for (const h3 of Object.keys(pools)) {
        if (!active.has(h3)) delete pools[h3]
      }

      ctx.globalAlpha = 1
      raf = requestAnimationFrame(frame)
    }

    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [mapRef])

  return (
    <canvas ref={canvasRef} style={{
      position: 'absolute', inset: 0,
      pointerEvents: 'none', zIndex: 5,
    }} />
  )
}

import { useEffect, useRef } from 'react'
import { cellToLatLng } from 'h3-js'

const PARTICLE_COUNT = 28
const SMOKE_COUNT = 10
const COLORS = ['#ff6600', '#ff3300', '#ffaa00', '#ff5500', '#ff8800', '#ffcc44', '#ff2200']
const SMOKE_COLORS = ['#3a3a3a', '#2a2a2a', '#4a4238', '#333333']
const SPARK_COLORS = ['#fff6d0', '#ffffff', '#cfe8ff']

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

function makeSmoke() {
  return {
    x: 0, y: 0, vx: 0, vy: 0,
    life: -Math.random() * 3,
    maxLife: 1.8 + Math.random() * 1.6,
    size: 6 + Math.random() * 10,
    color: SMOKE_COLORS[Math.floor(Math.random() * SMOKE_COLORS.length)],
  }
}

function resetSmoke(p, cx, cy) {
  const angle = Math.random() * Math.PI * 2
  const r = Math.random() * 10
  p.x = cx + Math.cos(angle) * r
  p.y = cy + Math.sin(angle) * r
  p.vx = (Math.random() - 0.5) * 0.9
  p.vy = -0.6 - Math.random() * 0.8
  p.life = p.maxLife
  p.maxLife = 1.8 + Math.random() * 1.6
  p.size = 6 + Math.random() * 10
  p.color = SMOKE_COLORS[Math.floor(Math.random() * SMOKE_COLORS.length)]
}

// Brief bright weapon-clash streak - rarer, shorter-lived than the embers/smoke
function makeSpark(cx, cy) {
  const angle = Math.random() * Math.PI * 2
  const speed = 3 + Math.random() * 4
  const life = 0.15 + Math.random() * 0.12
  return {
    x: cx, y: cy,
    vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
    life, maxLife: life,
    color: SPARK_COLORS[Math.floor(Math.random() * SPARK_COLORS.length)],
  }
}

export default function BattleParticles({ battles, mapRef }) {
  const canvasRef = useRef(null)
  const battlesRef = useRef(battles)
  useEffect(() => { battlesRef.current = battles })

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
        let cx, cy
        try {
          const [lat, lng] = cellToLatLng(h3)
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
          const projected = m.project([lng, lat])
          cx = projected.x
          cy = projected.y
          if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue
        } catch {
          continue
        }

        if (!pools[h3]) {
          pools[h3] = {
            particles: Array.from({ length: PARTICLE_COUNT }, makeParticle),
            smoke: Array.from({ length: SMOKE_COUNT }, makeSmoke),
            sparks: [],
            nextSparkAt: 0.3 + Math.random() * 0.6,
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
          for (const p of pool.smoke) { p.x += dx; p.y += dy }
          for (const p of pool.sparks) { p.x += dx; p.y += dy }
        }
        pool.prevX = cx
        pool.prevY = cy

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

        // Smoke - slower, larger, drifts further; drawn under the embers for depth
        for (const p of pool.smoke) {
          p.life -= dt
          if (p.life < 0) {
            resetSmoke(p, cx, cy)
            continue
          }
          p.x += p.vx * dt * 60
          p.y += p.vy * dt * 60
          p.vx *= 1 - 0.15 * dt

          const t = p.life / p.maxLife
          const alpha = (t < 0.25 ? t / 0.25 : t) * 0.3
          const size = p.size * (0.6 + 0.7 * (1 - t))

          ctx.globalAlpha = alpha
          ctx.fillStyle = p.color
          ctx.beginPath()
          ctx.arc(p.x, p.y, size, 0, Math.PI * 2)
          ctx.fill()
        }

        // Embers
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

        // Weapon-clash sparks - short bright streaks, spawned in occasional bursts
        pool.nextSparkAt -= dt
        if (pool.nextSparkAt <= 0) {
          pool.nextSparkAt = 0.4 + Math.random() * 0.8
          const burst = 2 + Math.floor(Math.random() * 3)
          for (let i = 0; i < burst; i++) pool.sparks.push(makeSpark(cx, cy))
        }
        for (let i = pool.sparks.length - 1; i >= 0; i--) {
          const p = pool.sparks[i]
          p.life -= dt
          if (p.life < 0) { pool.sparks.splice(i, 1); continue }
          const px = p.x, py = p.y
          p.x += p.vx * dt * 60
          p.y += p.vy * dt * 60
          const t = p.life / p.maxLife
          ctx.globalAlpha = t
          ctx.strokeStyle = p.color
          ctx.lineWidth = 1.4
          ctx.beginPath()
          ctx.moveTo(px, py)
          ctx.lineTo(p.x, p.y)
          ctx.stroke()
        }
      }

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

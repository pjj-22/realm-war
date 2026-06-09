import { useState, useEffect } from 'react'
import { api } from '../api/client'

function Sparkline({ data, width, height, color = '#8060c0' }) {
  if (!data || data.length < 2) return null

  const counts = data.map(d => d.hex_count)
  const times  = data.map(d => new Date(d.recorded_at).getTime())

  const minC = 0
  const maxC = Math.max(...counts, 1)
  const minT = times[0]
  const maxT = times[times.length - 1]
  const rangeT = maxT - minT || 1

  const px = (t) => ((t - minT) / rangeT) * width
  const py = (c) => height - ((c - minC) / (maxC - minC)) * (height - 8) - 4

  const points = data.map(d => `${px(new Date(d.recorded_at).getTime()).toFixed(1)},${py(d.hex_count).toFixed(1)}`)
  const polyline = points.join(' ')

  // Area fill path
  const areaPath = `M${points[0]} L${points.join(' L')} L${px(times[times.length - 1]).toFixed(1)},${height} L${px(times[0]).toFixed(1)},${height} Z`

  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <defs>
        <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#chartFill)" />
      <polyline points={polyline} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      {/* Current value dot */}
      <circle
        cx={px(times[times.length - 1]).toFixed(1)}
        cy={py(counts[counts.length - 1]).toFixed(1)}
        r="3" fill={color}
      />
    </svg>
  )
}

function timeLabel(ms) {
  const days = Math.floor(ms / 86400000)
  if (days >= 1) return `${days}d ago`
  const hours = Math.floor(ms / 3600000)
  if (hours >= 1) return `${hours}h ago`
  return 'just now'
}

export default function HistoryChart({ player }) {
  const [data, setData]     = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api.getHistory()
      .then(setData)
      .catch(() => setData([]))
      .finally(() => setLoading(false))
  }, [player?.id])

  if (loading) return (
    <div style={{ padding: '12px 0', fontSize: 12, color: '#6a5878', textAlign: 'center' }}>
      Loading history…
    </div>
  )

  if (!data || data.length < 2) return (
    <div style={{ padding: '12px 0', fontSize: 12, color: '#6a5878', textAlign: 'center' }}>
      Not enough data yet - history builds as you play.
    </div>
  )

  const counts   = data.map(d => d.hex_count)
  const peak     = Math.max(...counts)
  const current  = counts[counts.length - 1]
  const oldest   = new Date(data[0].recorded_at).getTime()
  const span     = timeLabel(Date.now() - oldest)

  return (
    <div style={{ fontFamily: 'Georgia, serif' }}>
      {/* Stat chips */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 11, color: '#6a5878', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 2 }}>Current</div>
          <div style={{ fontSize: 18, color: '#c9b99a' }}>{current}<span style={{ fontSize: 12, color: '#6a5878', marginLeft: 4 }}>▲</span></div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: '#6a5878', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 2 }}>Peak</div>
          <div style={{ fontSize: 18, color: current === peak ? '#c9a020' : '#c9b99a' }}>{peak}<span style={{ fontSize: 12, color: '#6a5878', marginLeft: 4 }}>▲</span></div>
        </div>
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: '#6a5878', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 2 }}>Span</div>
          <div style={{ fontSize: 13, color: '#6a5878' }}>Last {span}</div>
        </div>
      </div>

      {/* Chart */}
      <div style={{
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 4,
        padding: '8px 4px 4px',
        overflow: 'hidden',
      }}>
        <Sparkline data={data} width={340} height={80} color={player?.color || '#8060c0'} />
      </div>

      <div style={{ fontSize: 11, color: '#4a3a6a', marginTop: 4, textAlign: 'right' }}>
        territory over time · last 30 days
      </div>
    </div>
  )
}

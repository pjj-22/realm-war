import { useEffect, useRef, useState, useCallback } from 'react'
import { useSocket } from '../hooks/useSocket'
import { toast } from './Toast'
import maplibregl from 'maplibre-gl'
import { latLngToCell, cellToBoundary, cellToLatLng, gridDisk, gridPathCells } from 'h3-js'
import 'maplibre-gl/dist/maplibre-gl.css'
import BottomDrawer from './BottomDrawer'
import ArmiesHUD from './ArmiesHUD'
import LeaderboardPanel from './LeaderboardPanel'
import EventFeed from './EventFeed'
import BattlePanel from './BattlePanel'
import BattleParticles from './BattleParticles'
import { useResourceTicker } from '../hooks/useResourceTicker'
import { useIsMobile } from '../hooks/useIsMobile'
import { api } from '../api/client'
import { GoldIcon } from './Icons'


const HEX_RESOLUTION = 7
const MAX_HEXES = 10000

function getViewportHexes(map) {
  const zoom = map.getZoom()
  if (zoom < 5) return []

  const bounds = map.getBounds()
  const ne = bounds.getNorthEast()
  const sw = bounds.getSouthWest()
  const cellSet = new Set()
  const steps = 25
  const latStep = (ne.lat - sw.lat) / steps
  const lngStep = (ne.lng - sw.lng) / steps

  for (let lat = sw.lat; lat <= ne.lat + latStep; lat += latStep) {
    for (let lng = sw.lng; lng <= ne.lng + lngStep; lng += lngStep) {
      const cell = latLngToCell(lat, lng, HEX_RESOLUTION)
      gridDisk(cell, 1).forEach(c => cellSet.add(c))
    }
  }

  return Array.from(cellSet).slice(0, MAX_HEXES)
}

function hexToGeoJSONFeature(cell, claimed, visibleSet) {
  const boundary = cellToBoundary(cell)
  const coords = boundary.map(([lat, lng]) => [lng, lat])
  coords.push(coords[0])
  // fog = claimed enemy hex outside the visible ring
  const fog = !!claimed?.owner_id && !!visibleSet && !visibleSet.has(cell)
  return {
    type: 'Feature',
    properties: {
      h3: cell,
      owner: claimed?.owner_id || null,
      color: claimed?.color || null,
      username: claimed?.username || null,
      troop_count: fog ? -1 : (claimed?.troop_count || 0),
      upgrade_level: claimed?.upgrade_level || 0,
      country_name: claimed?.country_name || null,
      country_continent: claimed?.country_continent || null,
      fog,
    },
    geometry: { type: 'Polygon', coordinates: [coords] },
  }
}

function buildGeoJSON(cells, claimedHexes, visibleSet) {
  const features = cells.map(cell => hexToGeoJSONFeature(cell, claimedHexes[cell], visibleSet))
  return { type: 'FeatureCollection', features }
}

function parseTypes(types) {
  if (!types) return []
  if (Array.isArray(types)) return types
  return types.replace(/[{}"]/g, '').split(',').filter(Boolean)
}

function buildClaimedGeoJSON(claimedHexes, visibleSet) {
  const features = Object.entries(claimedHexes).map(([cell, claimed]) =>
    hexToGeoJSONFeature(cell, claimed, visibleSet)
  )
  return { type: 'FeatureCollection', features }
}

function buildVisibleSet(claimedHexes, playerId) {
  const visible = new Set()
  for (const [cell, claimed] of Object.entries(claimedHexes)) {
    if (claimed.owner_id !== playerId) continue
    // Own hexes + 1-ring adjacency always visible
    gridDisk(cell, 1).forEach(c => visible.add(c))
  }
  return visible
}

function buildClaimedPoints(claimedHexes, visibleSet) {
  const features = Object.entries(claimedHexes).map(([cell, claimed]) => {
    const [lat, lng] = cellToLatLng(cell)
    const isVisible = !visibleSet || visibleSet.has(cell)
    return {
      type: 'Feature',
      properties: {
        troop_count: isVisible ? (claimed.troop_count || 0) : -1,
      },
      geometry: { type: 'Point', coordinates: [lng, lat] },
    }
  })
  return { type: 'FeatureCollection', features }
}

// Pip colors by building type — matches BottomDrawer dots
const PIP_COLORS = {
  mine:     '#c9902a',
  barracks: '#a84040',
  fort:     '#5a9840',
}

const HEX_SHORT_RAD = 0.0058 // degrees lat, approximate for H3 res 7

function buildPipFeatures(claimedHexes) {
  const features = []
  for (const [cell, claimed] of Object.entries(claimedHexes)) {
    const types = parseTypes(claimed.building_types)
    if (!types.length) continue
    const [clat, clng] = cellToLatLng(cell)
    const cosLat = Math.cos(clat * Math.PI / 180)
    const n = Math.min(types.length, 6)
    // Evenly space pips in a single centered horizontal row
    const spacing = n > 1 ? Math.min(0.30, 1.20 / (n - 1)) : 0
    const startX = -spacing * (n - 1) / 2
    types.slice(0, 6).forEach((type, i) => {
      const ox = startX + i * spacing
      features.push({
        type: 'Feature',
        properties: { pip_color: PIP_COLORS[type] || '#888888' },
        geometry: { type: 'Point', coordinates: [clng + (ox * HEX_SHORT_RAD) / cosLat, clat + 0.12 * HEX_SHORT_RAD] },
      })
    })
  }
  return { type: 'FeatureCollection', features }
}

function HarvestCountdown({ nextTickAt, onExpire }) {
  const [secs, setSecs] = useState(0)
  const firedRef = useRef(false)
  useEffect(() => {
    firedRef.current = false
    function tick() {
      const remaining = Math.max(0, Math.round((new Date(nextTickAt) - Date.now()) / 1000))
      setSecs(remaining)
      if (remaining === 0 && !firedRef.current) {
        firedRef.current = true
        // Re-fetch stats after a brief delay to let the server tick complete
        setTimeout(onExpire, 1500)
      }
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [nextTickAt, onExpire])
  const m = Math.floor(secs / 60), s = secs % 60
  const label = m > 0 ? `${m}m ${String(s).padStart(2,'0')}s` : `${secs}s`
  return (
    <span style={{ fontSize: 11, color: secs <= 5 ? '#c9902a' : '#7a6890' }}>
      harvest in {label}
    </span>
  )
}

function GoldIncomeTooltip({ hexCount, mines, incomeByCountry }) {
  const [hover, setHover] = useState(false)
  const total = hexCount + mines * 3
  return (
    <span
      style={{ fontSize: 11, color: '#6a5848', marginLeft: 2, cursor: 'default', position: 'relative' }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      +{total}g
      {hover && (
        <div style={{
          position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)',
          marginTop: 6,
          background: 'rgba(10,7,2,0.97)', border: '1px solid rgba(160,110,30,0.45)',
          borderRadius: 6, padding: '10px 14px',
          fontSize: 12, color: '#c4b498', fontFamily: 'Georgia, serif',
          boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
          zIndex: 100, minWidth: 200, maxWidth: 280,
        }}>
          <div style={{ color: '#9a8060', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 8 }}>Income per harvest</div>

          {incomeByCountry?.length > 0 ? (
            <>
              {incomeByCountry.map(e => (
                <div key={e.country} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 4, lineHeight: 1.6 }}>
                  <span style={{ color: '#a09070' }}>
                    {e.country}
                    {e.mines > 0 && <span style={{ color: '#6a5838', fontSize: 10 }}> ({e.hexes}h+{e.mines}m)</span>}
                    {e.mines === 0 && <span style={{ color: '#6a5838', fontSize: 10 }}> ({e.hexes}h)</span>}
                  </span>
                  <span style={{ color: '#d4b870', flexShrink: 0 }}>+{e.income}g</span>
                </div>
              ))}
              <div style={{ borderTop: '1px solid rgba(160,110,30,0.2)', marginTop: 6, paddingTop: 6, display: 'flex', justifyContent: 'space-between', color: '#e0c070' }}>
                <span>Total</span>
                <span>+{total}g</span>
              </div>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 3 }}>
                <span>{hexCount} hexes × 1g</span>
                <span style={{ color: '#d4b870' }}>{hexCount}g</span>
              </div>
              {mines > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 3 }}>
                  <span>{mines} mine{mines !== 1 ? 's' : ''} × 3g</span>
                  <span style={{ color: '#d4b870' }}>{mines * 3}g</span>
                </div>
              )}
              <div style={{ borderTop: '1px solid rgba(160,110,30,0.2)', marginTop: 4, paddingTop: 4, display: 'flex', justifyContent: 'space-between', color: '#e0c070' }}>
                <span>Total</span><span>+{total}g</span>
              </div>
            </>
          )}
        </div>
      )}
    </span>
  )
}

export default function GameMap({ player, onLoginRequired, onPlayerUpdate, onShowHelp }) {
  const mapContainer = useRef(null)
  const map = useRef(null)
  const claimedRef = useRef({})
  const [selectedHex, setSelectedHex] = useState(null)
  const [zoom, setZoom] = useState(3)
  const [marchMode, setMarchMode] = useState(null) // { fromHex, type, quantity }
  const [rallyMode, setRallyMode] = useState(null) // fromHex string or null
  const [armies, setArmies] = useState([])
  const [activeBattles, setActiveBattles] = useState([])
  const [stats, setStats] = useState(null)
  const [activeBattle, setActiveBattle] = useState(null)

  const ownedHexCount = Object.values(claimedRef.current).filter(h => h.owner_id === player?.id).length
  const totalTroops = Object.values(claimedRef.current).filter(h => h.owner_id === player?.id).reduce((s, h) => s + (h.troop_count || 0), 0)

  const { display: resources } = useResourceTicker(player, ownedHexCount, [], stats?.tick_interval_ms)
  const isMobile = useIsMobile()

  // Load all claimed hexes from server
  const loadClaimed = useCallback(async () => {
    try {
      const hexes = await api.getHexes()
      const byIndex = {}
      hexes.forEach(h => { byIndex[h.h3_index] = h })
      claimedRef.current = byIndex
      updateHexes()
      updateClaimed()
    } catch {}
  }, [])

  const loadArmies = useCallback(async () => {
    try { setArmies(await api.getArmies()) } catch {}
  }, [])

  const loadActiveBattles = useCallback(async () => {
    try { setActiveBattles(await api.getActiveBattles()) } catch {}
  }, [])

  const loadStats = useCallback(async () => {
    try { setStats(await api.getStats()) } catch {}
  }, [])

  // Initial loads on mount
  useEffect(() => { loadClaimed() }, [loadClaimed])
  useEffect(() => { loadArmies() }, [loadArmies])
  useEffect(() => { loadActiveBattles() }, [loadActiveBattles])
  useEffect(() => { if (player) loadStats() }, [player?.id, loadStats])

  // Socket-driven updates — replace polling intervals
  useSocket({
    'hexes:update': loadClaimed,
    'armies:update': loadArmies,
    'battle:update': loadActiveBattles,
    'tick': loadStats,
  })

  useEffect(() => {
    if (!selectedHex) { setActiveBattle(null); return }
    async function checkBattle() {
      try {
        const result = await api.getBattle(selectedHex.h3)
        const newBattle = result.battle || null
        setActiveBattle(prev => {
          if (prev && !newBattle) loadClaimed() // battle just resolved — refresh map immediately
          return newBattle
        })
      } catch { setActiveBattle(null) }
    }
    checkBattle()
    const interval = setInterval(checkBattle, 5000)
    return () => clearInterval(interval)
  }, [selectedHex?.h3, loadClaimed])

  useEffect(() => {
    if (map.current) return

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: 'https://tiles.openfreemap.org/styles/dark',
      center: [0, 30],
      zoom: 3,
      attributionControl: false,
    })

    map.current.on('load', () => {
      // Always-visible claimed territory layer (visible at all zoom levels)
      map.current.addSource('claimed', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      map.current.addLayer({
        id: 'claimed-fill',
        type: 'fill',
        source: 'claimed',
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': ['case', ['boolean', ['get', 'fog'], false], 0.1, 0.35],
        },
      })

      // Point source for labels — avoids polygon-tile duplication at high zoom
      map.current.addSource('claimed-points', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })

      // Full hex grid (visible at zoom 5+)
      map.current.addSource('hexes', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      map.current.addLayer({
        id: 'hex-fill',
        type: 'fill',
        source: 'hexes',
        paint: {
          'fill-color': ['case', ['!=', ['get', 'color'], null], ['get', 'color'], 'rgba(30,20,60,0.35)'],
          'fill-opacity': ['case', ['boolean', ['get', 'fog'], false], 0.1, 0.35],
        },
      })
      map.current.addLayer({
        id: 'hex-border',
        type: 'line',
        source: 'hexes',
        paint: { 'line-color': '#4a3a7a', 'line-width': 0.6, 'line-opacity': 0.8 },
      })
      map.current.addLayer({
        id: 'hex-selected',
        type: 'line',
        source: 'hexes',
        filter: ['==', ['get', 'h3'], ''],
        paint: { 'line-color': '#f0c040', 'line-width': 2 },
      })

      // Troop count labels on claimed hexes (zoom 7+)
      map.current.addLayer({
        id: 'hex-troop-labels',
        type: 'symbol',
        source: 'claimed-points',
        minzoom: 7,
        layout: {
          'text-field': ['case',
            ['==', ['get', 'troop_count'], -1], '?',
            ['>', ['get', 'troop_count'], 0], ['concat', ['to-string', ['get', 'troop_count']], '⚔'],
            ''
          ],
          'text-size': 15,
          'text-allow-overlap': false,
          'text-offset': [0, 1.0],
        },
        paint: {
          'text-color': 'rgba(255,255,255,0.95)',
          'text-halo-color': 'rgba(0,0,0,0.8)',
          'text-halo-width': 2,
        },
      })

      // Building pips — one colored dot per building, arranged in a 3×2 grid inside each hex
      map.current.addSource('building-pips', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      map.current.addLayer({
        id: 'building-pips',
        type: 'circle',
        source: 'building-pips',
        minzoom: 6.5,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 6.5, 3, 9, 6],
          'circle-color': ['get', 'pip_color'],
          'circle-stroke-width': 1,
          'circle-stroke-color': 'rgba(0,0,0,0.55)',
          'circle-opacity': 0.92,
        },
      })

      // Army markers (visible at zoom 5+)
      map.current.addSource('armies', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      map.current.addLayer({
        id: 'army-circle',
        type: 'circle',
        source: 'armies',
        minzoom: 5,
        paint: {
          'circle-radius': 14,
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.9,
          'circle-stroke-width': 2,
          'circle-stroke-color': ['case', ['get', 'isEnemy'], '#ff4444', '#ffffff'],
        },
      })
      map.current.addLayer({
        id: 'army-label',
        type: 'symbol',
        source: 'armies',
        minzoom: 5,
        layout: {
          'text-field': ['get', 'label'],
          'text-size': 13,
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': 'rgba(0,0,0,0.8)',
          'text-halo-width': 1,
        },
      })

      updateHexes()
      updateClaimed()
      // armies state may already be loaded — force a sync
      map.current.once('idle', () => {
        setArmies(prev => [...prev])
      })
    })

    map.current.on('moveend', updateHexes)
    map.current.on('zoomend', updateHexes)
    map.current.on('zoom', () => setZoom(map.current.getZoom()))

    map.current.on('click', 'hex-fill', (e) => {
      const hex = e.features[0]?.properties
      if (!hex) return

      // Rally mode: set rally destination
      if (rallyModeRef.current) {
        const fromHex = rallyModeRef.current
        api.setRally(fromHex, hex.h3)
          .then(() => loadClaimed())
          .catch(err => toast(err.message))
        setRallyMode(null)
        return
      }

      setMarchMode(prev => {
        if (prev) {
          if (prev.battleMode && !prev.fromHex) {
            // Battle reinforce: user clicked source hex
            setSelectedHex(hex)
            map.current.setFilter('hex-selected', ['==', ['get', 'h3'], hex.h3])
            return { ...prev, fromHex: hex.h3 }
          }
          if (prev.troops) {
            // Multi-type dispatch from the drawer
            const entries = Object.entries(prev.troops).filter(([, qty]) => qty > 0)
            Promise.all(entries.map(([type, qty]) => api.marchArmy(prev.fromHex, hex.h3, type, qty)))
              .then(() => loadClaimed())
              .catch(err => toast(err.message))
            return null
          }
          // Single-type march
          api.marchArmy(prev.fromHex, hex.h3, prev.type, prev.quantity)
            .then(() => loadClaimed())
            .catch(err => toast(err.message))
          return null
        }
        // Normal click — select hex
        setSelectedHex(hex)
        map.current.setFilter('hex-selected', ['==', ['get', 'h3'], hex.h3])
        return null
      })
    })

    map.current.on('mouseenter', 'hex-fill', () => {
      map.current.getCanvas().style.cursor = (marchModeRef.current || rallyModeRef.current) ? 'crosshair' : 'pointer'
    })
    map.current.on('mouseleave', 'hex-fill', () => { map.current.getCanvas().style.cursor = '' })

    return () => {
      Object.values(battleMarkersRef.current).forEach(m => m.remove())
      battleMarkersRef.current = {}
      map.current?.remove()
      map.current = null
    }
  }, [])

  const battleMarkersRef = useRef({})
  useEffect(() => {
    if (!map.current) return
    const activeIds = new Set(activeBattles.map(b => b.h3_index))

    // Add new markers
    for (const battle of activeBattles) {
      if (battleMarkersRef.current[battle.h3_index]) continue
      const [lat, lng] = cellToLatLng(battle.h3_index)
      const el = document.createElement('div')
      el.className = 'battle-ring'
      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([lng, lat])
        .addTo(map.current)
      battleMarkersRef.current[battle.h3_index] = marker
    }

    // Remove stale markers
    for (const [id, marker] of Object.entries(battleMarkersRef.current)) {
      if (!activeIds.has(id)) {
        marker.remove()
        delete battleMarkersRef.current[id]
      }
    }
  }, [activeBattles])

  function updateHexes() {
    if (!map.current?.getSource('hexes')) return
    const cells = getViewportHexes(map.current)
    map.current.getSource('hexes').setData(buildGeoJSON(cells, claimedRef.current, visibleSetRef.current))
  }

  function updateClaimed() {
    if (!map.current?.getSource('claimed')) return
    const visibleSet = player ? buildVisibleSet(claimedRef.current, player.id) : null
    visibleSetRef.current = visibleSet
    map.current.getSource('claimed').setData(buildClaimedGeoJSON(claimedRef.current, visibleSet))
    map.current.getSource('claimed-points')?.setData(buildClaimedPoints(claimedRef.current, visibleSet))
    map.current.getSource('building-pips')?.setData(buildPipFeatures(claimedRef.current))
  }

  const visibleSetRef = useRef(null)
  const marchModeRef = useRef(marchMode)
  marchModeRef.current = marchMode
  const rallyModeRef = useRef(null)
  rallyModeRef.current = rallyMode
  const armiesRef = useRef([])
  armiesRef.current = armies
  const playerRef = useRef(null)
  playerRef.current = player
  const markersRef = useRef({})

  useEffect(() => {

    function updateArmyPositions() {
      if (!map.current?.getSource('armies')) return
      const currentPlayer = playerRef.current
      const currentClaimed = claimedRef.current
      const activeIds = new Set()

      const features = armiesRef.current.map(a => {
        let path
        try { path = gridPathCells(a.from_hex, a.to_hex) } catch { return null }
        const total = new Date(a.arrives_at) - new Date(a.departed_at)
        const elapsed = Date.now() - new Date(a.departed_at)
        const progress = Math.min(1, Math.max(0, elapsed / total))
        const idx = Math.min(Math.floor(progress * (path.length - 1)), path.length - 1)
        const [lat, lng] = cellToLatLng(path[idx])
        const isEnemy = currentPlayer && a.owner_id !== currentPlayer.id
        const isThreat = isEnemy && currentClaimed[a.to_hex]?.owner_id === currentPlayer?.id

        // Manage pulsing HTML markers for incoming threats
        if (isThreat && map.current) {
          activeIds.add(a.id)
          if (!markersRef.current[a.id]) {
            const el = document.createElement('div')
            el.className = 'army-threat-marker'
            el.style.cssText = `width:20px;height:20px;border-radius:50%;background:${a.color || '#ff4444'};border:2px solid #ff4444;position:relative;`
            const ring = document.createElement('div')
            ring.className = 'army-threat-ring'
            el.appendChild(ring)
            markersRef.current[a.id] = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map.current)
          } else {
            markersRef.current[a.id].setLngLat([lng, lat])
          }
        }

        return {
          type: 'Feature',
          properties: {
            label: `⚔${a.quantity}`,
            color: a.color || '#f0c040',
            isEnemy: isEnemy ? 1 : 0,
          },
          geometry: { type: 'Point', coordinates: [lng, lat] },
        }
      }).filter(Boolean)

      // Remove stale threat markers
      for (const [id, marker] of Object.entries(markersRef.current)) {
        if (!activeIds.has(id)) {
          marker.remove()
          delete markersRef.current[id]
        }
      }

      map.current.getSource('armies').setData({ type: 'FeatureCollection', features })
    }

    updateArmyPositions()
    const interval = setInterval(updateArmyPositions, 1000)
    return () => clearInterval(interval)
  }, [armies])

  async function handleClaim(h3Index) {
    if (!player) return
    try {
      await api.claimHex(h3Index)
      await loadClaimed()
      updateClaimed()
      setSelectedHex(prev => ({ ...prev, color: player.color, username: player.username, owner: player.id }))
    } catch (err) {
      toast(err.message)
    }
  }

  const [searchQuery, setSearchQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)

  async function handleSearch(e) {
    e.preventDefault()
    const q = searchQuery.trim()
    if (!q) return
    // Direct H3 index (15 hex chars starting with 8)
    if (/^8[0-9a-f]{14}$/i.test(q)) {
      try {
        const [lat, lng] = cellToLatLng(q)
        map.current?.flyTo({ center: [lng, lat], zoom: 9 })
        setSearchOpen(false)
        setSearchQuery('')
      } catch { toast('Invalid hex index') }
      return
    }
    // Geocode with Nominatim
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`
      const res = await fetch(url, { headers: { 'Accept-Language': 'en' } })
      const data = await res.json()
      if (data[0]) {
        map.current?.flyTo({ center: [parseFloat(data[0].lon), parseFloat(data[0].lat)], zoom: 9 })
        setSearchOpen(false)
        setSearchQuery('')
      } else {
        toast('Location not found')
      }
    } catch { toast('Search failed') }
  }

  const goldCap = stats?.gold_cap ?? null
  const goldOverCap = goldCap !== null && resources.gold >= goldCap

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh' }}>
      <div ref={mapContainer} style={{ position: 'absolute', inset: 0 }} />

      {activeBattles.length > 0 && (
        <BattleParticles battles={activeBattles} mapRef={map} />
      )}

      {/* ── Top bar ────────────────────────────────────────────── */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 48,
        background: 'rgba(5,3,14,0.94)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', alignItems: 'center', gap: 0,
        fontFamily: 'Georgia, serif', zIndex: 20, padding: '0 16px',
      }}>
        {/* Title — hidden on mobile */}
        {!isMobile && (
          <span style={{ fontSize: 13, letterSpacing: 5, color: '#7a6890', textTransform: 'uppercase', marginRight: 20, userSelect: 'none' }}>
            Realm War
          </span>
        )}

        {/* Search */}
        {searchOpen ? (
          <form onSubmit={handleSearch} style={{ display: 'flex', gap: 5 }}>
            <input autoFocus value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              placeholder={isMobile ? 'City or hex…' : 'City, country or hex ID…'}
              style={{
                padding: '4px 10px', width: isMobile ? 140 : 200,
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 4, color: '#c4b498', fontFamily: 'Georgia, serif', fontSize: 13, outline: 'none',
              }}
            />
            <button type="submit" style={{ padding: '4px 10px', background: 'rgba(80,50,160,0.3)', border: '1px solid rgba(120,80,200,0.3)', borderRadius: 4, color: '#c4b498', cursor: 'pointer', fontSize: 13, fontFamily: 'Georgia, serif' }}>Go</button>
            <button type="button" onClick={() => setSearchOpen(false)} style={{ padding: '4px 8px', background: 'none', border: 'none', color: '#5a4870', cursor: 'pointer', fontSize: 16 }}>×</button>
          </form>
        ) : (
          <button onClick={() => setSearchOpen(true)} style={{ background: 'none', border: 'none', color: '#7a6890', cursor: 'pointer', fontSize: 16, padding: '4px 8px' }}>
            🔍
          </button>
        )}

        <div style={{ flex: 1 }} />

        {/* Resources */}
        {player && (
          <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 10 : 20, marginRight: isMobile ? 8 : 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <GoldIcon size={14} />
              <span style={{ fontSize: 15, color: goldOverCap ? '#e8a020' : '#c9902a', fontWeight: 'bold' }}>
                {resources.gold}
              </span>
              {goldCap !== null && (
                <span style={{ fontSize: 11, color: goldOverCap ? '#8a5818' : '#7a6890' }}>
                  {goldOverCap ? '⚠' : `/ ${goldCap}`}
                </span>
              )}
              {stats && !isMobile && <GoldIncomeTooltip hexCount={stats.hex_count || 0} mines={stats.mines || 0} incomeByCountry={stats.income_by_country} />}
            </div>
            {stats?.next_tick_at && <HarvestCountdown nextTickAt={stats.next_tick_at} onExpire={loadStats} />}
            {!isMobile && <span style={{ fontSize: 13, color: '#7a6890' }}>▲ {stats?.hex_count ?? ownedHexCount}</span>}
            {!isMobile && totalTroops > 0 && <span style={{ fontSize: 13, color: '#7a6890' }}>⚔ {totalTroops}</span>}
            {!isMobile && import.meta.env.DEV && (
              <button
                onClick={async () => { try { const r = await api.devRefill(); onPlayerUpdate?.({ ...player, gold: r.gold }) } catch {} }}
                style={{ padding: '3px 10px', background: 'rgba(30,60,30,0.4)', border: '1px solid rgba(50,100,50,0.4)', borderRadius: 4, color: '#70a870', cursor: 'pointer', fontSize: 11, letterSpacing: 1, fontFamily: 'Georgia, serif' }}>
                Refill
              </button>
            )}
          </div>
        )}

        {/* Player + events */}
        {player ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <EventFeed />
            {!isMobile && <span style={{ fontSize: 13, color: '#c4b498' }}>{player.username}</span>}
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: player.color, display: 'inline-block' }} />
          </div>
        ) : (
          <button onClick={onLoginRequired} style={{
            padding: isMobile ? '6px 10px' : '6px 16px',
            background: 'rgba(80,50,160,0.3)', border: '1px solid rgba(120,80,200,0.4)',
            borderRadius: 4, color: '#c4b498', cursor: 'pointer',
            fontSize: isMobile ? 11 : 12, letterSpacing: isMobile ? 1 : 2,
            textTransform: 'uppercase', fontFamily: 'Georgia, serif',
          }}>
            {isMobile ? 'Login' : 'Login / Register'}
          </button>
        )}

        {/* Help button */}
        <button
          onClick={onShowHelp}
          title="How to Play"
          style={{
            marginLeft: 8, width: isMobile ? 34 : 28, height: isMobile ? 34 : 28,
            background: 'rgba(80,40,160,0.25)', border: '1px solid #4a3a7a',
            borderRadius: '50%', color: '#7a6a9a', cursor: 'pointer',
            fontSize: 14, fontFamily: 'Georgia, serif', lineHeight: 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
          ?
        </button>
      </div>

      {/* ── Armies HUD (below top bar) ──────────────────────────── */}
      {player && (
        <ArmiesHUD
          armies={armies}
          activeBattles={activeBattles}
          player={player}
          claimedRef={claimedRef}
          onRefresh={() => api.getArmies().then(setArmies).catch(() => {})}
          onFlyTo={(h3) => {
            try {
              const [lat, lng] = cellToLatLng(h3)
              map.current?.flyTo({ center: [lng, lat], zoom: 12, speed: 1.5 })
            } catch {}
          }}
        />
      )}

      {/* ── Leaderboard ─────────────────────────────────────────── */}
      <LeaderboardPanel
        player={player}
        onFlyTo={(lng, lat) => map.current?.flyTo({ center: [lng, lat], zoom: 9, speed: 1.5 })}
      />

      {/* ── Zoom hint ───────────────────────────────────────────── */}
      {zoom < 5 && (
        <div style={{
          position: 'absolute', bottom: 90, left: '50%', transform: 'translateX(-50%)',
          color: '#6a5878', fontSize: 12, letterSpacing: 3, pointerEvents: 'none', whiteSpace: 'nowrap',
        }}>
          ZOOM IN TO SEE THE BATTLEFIELD
        </div>
      )}

      {/* ── Mode banners ─────────────────────────────────────────── */}
      {(marchMode || rallyMode) && (
        <div style={{
          position: 'absolute', top: 56,
          left: isMobile ? 8 : '50%',
          right: isMobile ? 8 : 'auto',
          transform: isMobile ? 'none' : 'translateX(-50%)',
          background: rallyMode ? 'rgba(20,60,20,0.94)' : 'rgba(80,20,20,0.94)',
          border: `1px solid ${rallyMode ? 'rgba(50,150,50,0.5)' : 'rgba(180,50,50,0.5)'}`,
          borderRadius: 6, padding: isMobile ? '10px 16px' : '9px 22px',
          color: rallyMode ? '#90d490' : '#d49090',
          fontFamily: 'Georgia, serif', fontSize: isMobile ? 12 : 13, letterSpacing: 2,
          textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 16,
          justifyContent: isMobile ? 'space-between' : 'flex-start',
        }}>
          <span>
            {rallyMode
              ? 'Click an owned hex to set as rally point'
              : marchMode?.battleMode && !marchMode.fromHex
                ? 'Select source hex to reinforce from'
                : 'Select target hex'}
          </span>
          <button
            onClick={() => { setMarchMode(null); setRallyMode(null) }}
            style={{
              background: 'none',
              border: `1px solid ${rallyMode ? 'rgba(50,150,50,0.5)' : 'rgba(180,50,50,0.5)'}`,
              borderRadius: 4, color: rallyMode ? '#90d490' : '#d49090',
              cursor: 'pointer', padding: '2px 10px', fontSize: 12,
            }}>
            Cancel
          </button>
        </div>
      )}

      {/* ── Battle panel ────────────────────────────────────────── */}
      {activeBattle && selectedHex && (
        <BattlePanel
          hex={selectedHex}
          player={player}
          onMarchStart={(targetHex, side) => setMarchMode({ fromHex: null, targetHex, side, battleMode: true })}
          onClose={() => setActiveBattle(null)}
        />
      )}

      {/* ── Bottom drawer — replaces all floating panels ────────── */}
      {selectedHex && !activeBattle && (
        <BottomDrawer
          hex={selectedHex}
          player={player}
          onClaim={handleClaim}
          onLoginRequired={onLoginRequired}
          onBuild={(updatedPlayer, h3Index, buildingType) => {
            onPlayerUpdate(updatedPlayer)
            if (h3Index && buildingType && claimedRef.current[h3Index]) {
              const h = claimedRef.current[h3Index]
              claimedRef.current[h3Index] = { ...h, building_types: [...parseTypes(h.building_types), buildingType] }
              updateClaimed()
              updateHexes()
            }
          }}
          onPlayerUpdate={onPlayerUpdate}
          onMarchStart={(fromHex, troops) => {
            setSelectedHex(null)
            map.current?.setFilter('hex-selected', ['==', ['get', 'h3'], ''])
            setMarchMode({ fromHex, troops })
          }}
          onSetRallyMode={fromHex => setRallyMode(fromHex)}
          onClose={() => {
            setSelectedHex(null)
            map.current?.setFilter('hex-selected', ['==', ['get', 'h3'], ''])
          }}
        />
      )}
    </div>
  )
}

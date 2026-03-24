import { useEffect, useRef, useState, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import { latLngToCell, cellToBoundary, cellToLatLng, gridDisk, gridPathCells } from 'h3-js'
import 'maplibre-gl/dist/maplibre-gl.css'
import HexPanel from './HexPanel'
import MilitaryPanel from './MilitaryPanel'
import ArmiesHUD from './ArmiesHUD'
import LeaderboardPanel from './LeaderboardPanel'
import BattlePanel from './BattlePanel'
import { useResourceTicker } from '../hooks/useResourceTicker'
import { api } from '../api/client'

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

function hexToGeoJSONFeature(cell, claimed) {
  const boundary = cellToBoundary(cell)
  const coords = boundary.map(([lat, lng]) => [lng, lat])
  coords.push(coords[0])
  return {
    type: 'Feature',
    properties: {
      h3: cell,
      owner: claimed?.owner_id || null,
      color: claimed?.color || null,
      username: claimed?.username || null,
      troop_count: claimed?.troop_count || 0,
    },
    geometry: { type: 'Polygon', coordinates: [coords] },
  }
}

function buildGeoJSON(cells, claimedHexes) {
  const features = cells.map(cell => hexToGeoJSONFeature(cell, claimedHexes[cell]))
  return { type: 'FeatureCollection', features }
}

function buildClaimedGeoJSON(claimedHexes) {
  const features = Object.entries(claimedHexes).map(([cell, claimed]) =>
    hexToGeoJSONFeature(cell, claimed)
  )
  return { type: 'FeatureCollection', features }
}

export default function GameMap({ player, onLoginRequired, onPlayerUpdate }) {
  const mapContainer = useRef(null)
  const map = useRef(null)
  const claimedRef = useRef({})
  const [selectedHex, setSelectedHex] = useState(null)
  const [showMilitary, setShowMilitary] = useState(false)
  const [zoom, setZoom] = useState(3)
  const [marchMode, setMarchMode] = useState(null) // { fromHex, type, quantity }
  const [armies, setArmies] = useState([])
  const [stats, setStats] = useState(null)
  const [activeBattle, setActiveBattle] = useState(null)

  const ownedHexCount = Object.values(claimedRef.current).filter(h => h.owner_id === player?.id).length
  const { display: resources } = useResourceTicker(player, ownedHexCount)

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

  useEffect(() => {
    loadClaimed()
    const interval = setInterval(loadClaimed, 15000)
    return () => clearInterval(interval)
  }, [loadClaimed])

  useEffect(() => {
    async function loadArmies() {
      try { setArmies(await api.getArmies()) } catch {}
    }
    loadArmies()
    const interval = setInterval(loadArmies, 10000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!player) return
    async function loadStats() {
      try { setStats(await api.getStats()) } catch {}
    }
    loadStats()
    const interval = setInterval(loadStats, 30000)
    return () => clearInterval(interval)
  }, [player?.id])

  useEffect(() => {
    if (!selectedHex) { setActiveBattle(null); return }
    async function checkBattle() {
      try {
        const result = await api.getBattle(selectedHex.h3)
        setActiveBattle(result.battle || null)
      } catch { setActiveBattle(null) }
    }
    checkBattle()
    const interval = setInterval(checkBattle, 5000)
    return () => clearInterval(interval)
  }, [selectedHex?.h3])

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
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.6 },
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
          'fill-opacity': 0.7,
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
        source: 'claimed',
        minzoom: 7,
        layout: {
          'text-field': ['case', ['>', ['get', 'troop_count'], 0], ['to-string', ['get', 'troop_count']], ''],
          'text-size': 11,
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': 'rgba(255,255,255,0.9)',
          'text-halo-color': 'rgba(0,0,0,0.7)',
          'text-halo-width': 1.5,
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
          'circle-radius': 10,
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
          'text-size': 10,
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
      setMarchMode(prev => {
        if (prev) {
          // In targeting mode — send the march
          api.marchArmy(prev.fromHex, hex.h3, prev.type, prev.quantity)
            .then(() => loadClaimed())
            .catch(err => alert(err.message))
          return null
        }
        // Normal click — select hex
        setSelectedHex(hex)
        map.current.setFilter('hex-selected', ['==', ['get', 'h3'], hex.h3])
        return null
      })
    })

    map.current.on('mouseenter', 'hex-fill', () => {
      map.current.getCanvas().style.cursor = marchMode ? 'crosshair' : 'pointer'
    })
    map.current.on('mouseleave', 'hex-fill', () => { map.current.getCanvas().style.cursor = '' })

    return () => { map.current?.remove(); map.current = null }
  }, [])

  function updateHexes() {
    if (!map.current?.getSource('hexes')) return
    const cells = getViewportHexes(map.current)
    map.current.getSource('hexes').setData(buildGeoJSON(cells, claimedRef.current))
  }

  function updateClaimed() {
    if (!map.current?.getSource('claimed')) return
    map.current.getSource('claimed').setData(buildClaimedGeoJSON(claimedRef.current))
  }

  const armiesRef = useRef([])
  armiesRef.current = armies
  const playerRef = useRef(null)
  playerRef.current = player
  const markersRef = useRef({})
  const claimedPublicRef = useRef(claimedRef)
  claimedPublicRef.current = claimedRef

  useEffect(() => {
    const ICONS = { knight: '⚔', archer: '🏹', trebuchet: '💣' }

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
            label: `${ICONS[a.type] || '⚔'}${a.quantity}`,
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
      alert(err.message)
    }
  }

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh' }}>
      <div ref={mapContainer} style={{ position: 'absolute', inset: 0 }} />

      <div style={{
        position: 'absolute', top: 20, left: '50%', transform: 'translateX(-50%)',
        color: '#c9b99a', fontSize: '24px', letterSpacing: '6px', textTransform: 'uppercase',
        textShadow: '0 0 20px rgba(100,60,200,0.8)', pointerEvents: 'none', fontFamily: 'Georgia, serif',
      }}>
        Realm War
      </div>

      {player && (
        <div style={{
          position: 'absolute', top: 16, right: 16,
          background: 'rgba(10,8,25,0.85)', border: '1px solid #4a3a7a',
          borderRadius: 6, padding: '10px 14px',
          color: '#c9b99a', fontSize: 13, letterSpacing: 1,
          fontFamily: 'Georgia, serif', textAlign: 'right',
          boxShadow: '0 0 20px rgba(80,40,160,0.3)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, justifyContent: 'flex-end' }}>
            <span>{player.username}</span>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: player.color, display: 'inline-block', flexShrink: 0 }} />
          </div>
          <div style={{ color: '#7a6a9a', fontSize: 11, marginBottom: 4, textAlign: 'right' }}>
            ▲ {stats?.hex_count ?? ownedHexCount} territories
          </div>
          <div style={{ color: '#7a6a9a', fontSize: 11, display: 'flex', gap: 12, justifyContent: 'flex-end', marginBottom: 2 }}>
            <span>⚜ {resources.gold}</span>
            <span>✦ {resources.mana}</span>
          </div>
          {stats && (
            <div style={{ color: '#5a4a6a', fontSize: 10, display: 'flex', gap: 8, justifyContent: 'flex-end', marginBottom: 8 }}>
              <span>+{(stats.hex_count || 0) + (stats.mines || 0) * 3}/tick gold</span>
              {stats.wells > 0 && <span>+{stats.wells * 3}/tick mana</span>}
            </div>
          )}
          <button
            onClick={async () => {
              try {
                const r = await api.devRefill()
                onPlayerUpdate?.({ ...player, gold: r.gold, mana: r.mana })
              } catch {}
            }}
            style={{
              width: '100%', padding: '5px 0', marginBottom: 4,
              background: 'rgba(40,80,40,0.3)', border: '1px solid #3a6a3a',
              borderRadius: 4, color: '#90c090', cursor: 'pointer',
              fontSize: 10, letterSpacing: 2, textTransform: 'uppercase',
              fontFamily: 'Georgia, serif',
            }}>
            ⚗ Refill
          </button>
          <button
            onClick={() => setShowMilitary(s => !s)}
            style={{
              width: '100%', padding: '5px 0',
              background: showMilitary ? 'rgba(160,40,40,0.4)' : 'rgba(80,40,160,0.3)',
              border: `1px solid ${showMilitary ? '#7a3a3a' : '#4a3a7a'}`,
              borderRadius: 4, color: '#c9b99a', cursor: 'pointer',
              fontSize: 10, letterSpacing: 2, textTransform: 'uppercase',
              fontFamily: 'Georgia, serif',
            }}>
            ⚔ Military
          </button>
        </div>
      )}

      {player && (
        <ArmiesHUD
          armies={armies}
          player={player}
          claimedRef={claimedRef}
          onRefresh={() => api.getArmies().then(setArmies).catch(() => {})}
        />
      )}

      <LeaderboardPanel player={player} />

      {zoom < 5 && (
        <div style={{
          position: 'absolute', bottom: 40, left: '50%', transform: 'translateX(-50%)',
          color: '#7a6a9a', fontSize: '13px', letterSpacing: '2px', pointerEvents: 'none',
        }}>
          ZOOM IN TO SEE THE BATTLEFIELD
        </div>
      )}

      {marchMode && (
        <div style={{
          position: 'absolute', top: 70, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(120,30,30,0.92)', border: '1px solid #9a3a3a',
          borderRadius: 6, padding: '10px 24px',
          color: '#f0c0c0', fontFamily: 'Georgia, serif', fontSize: 14, letterSpacing: 2,
          textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 16,
          boxShadow: '0 0 20px rgba(180,40,40,0.5)',
        }}>
          <span>⚔ Select target hex</span>
          <button
            onClick={() => setMarchMode(null)}
            style={{ background: 'none', border: '1px solid #9a3a3a', borderRadius: 4, color: '#f0c0c0', cursor: 'pointer', padding: '2px 10px', fontSize: 12 }}>
            Cancel
          </button>
        </div>
      )}

      {activeBattle && selectedHex && (
        <BattlePanel
          hex={selectedHex}
          player={player}
          onMarchStart={(targetHex, side) => setMarchMode({ fromHex: null, targetHex, side, battleMode: true })}
          onClose={() => setActiveBattle(null)}
        />
      )}

      {showMilitary && player && selectedHex && !activeBattle && (
        <MilitaryPanel
          hex={selectedHex}
          player={player}
          onPlayerUpdate={onPlayerUpdate}
          onMarchStart={(fromHex, type, quantity) => setMarchMode({ fromHex, type, quantity })}
          onClose={() => setShowMilitary(false)}
        />
      )}

      {selectedHex && (
        <HexPanel
          hex={selectedHex}
          player={player}
          onClaim={handleClaim}
          onLoginRequired={onLoginRequired}
          onBuild={onPlayerUpdate}
          onClose={() => {
            setSelectedHex(null)
            map.current?.setFilter('hex-selected', ['==', ['get', 'h3'], ''])
          }}
        />
      )}
    </div>
  )
}

import { useEffect, useRef, useState, useCallback } from 'react'
import { useSocket } from '../hooks/useSocket'
import { toast } from './Toast'
import maplibregl from 'maplibre-gl'
import { polygonToCells, cellToBoundary, cellToLatLng, cellToParent, gridDisk, gridPathCells } from 'h3-js'
import 'maplibre-gl/dist/maplibre-gl.css'
import BottomDrawer from './BottomDrawer'
import ArmiesHUD from './ArmiesHUD'
import LeaderboardPanel from './LeaderboardPanel'
import EventFeed from './EventFeed'
import BattlePanel from './BattlePanel'
import BattleParticles from './BattleParticles'
import ChatPanel from './ChatPanel'
import AlliancePanel from './AlliancePanel'
import SeasonPanel, { SeasonChip, SeasonEndOverlay } from './SeasonPanel'
import { useResourceTicker } from '../hooks/useResourceTicker'
import { useIsMobile } from '../hooks/useIsMobile'
import { api } from '../api/client'
import { GoldIcon, SearchIcon, AllianceIcon, SwordsIcon, WarningIcon } from './Icons'


const HEX_RESOLUTION = 7

// Register an SVG as a map sprite (no-op if already present)
function addSvgImage(map, id, svg) {
  if (map.hasImage?.(id)) return
  const img = new Image()
  img.onload = () => { if (map && !map.hasImage?.(id)) map.addImage(id, img) }
  img.src = 'data:image/svg+xml;base64,' + btoa(svg)
}

// Mini building badges - white glyph on the building's pip color
const PIP_SPRITES = {
  'pip-mine': `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 16 16">
    <circle cx="8" cy="8" r="7" fill="#c9902a" stroke="rgba(0,0,0,0.55)" stroke-width="1.4"/>
    <g transform="translate(2.9,2.9) scale(0.64)">
      <line x1="5" y1="13.5" x2="10.8" y2="4.4" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
      <path d="M4 5.8C6.5 2.2 11 2 13.3 4.4c-1.8-.5-4.3-.3-6 .8Z" fill="#fff"/>
    </g>
  </svg>`,
  'pip-barracks': `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 16 16">
    <circle cx="8" cy="8" r="7" fill="#a84040" stroke="rgba(0,0,0,0.55)" stroke-width="1.4"/>
    <g transform="translate(3.1,2.9) scale(0.62)">
      <path d="M3.5 14V5.5h1.6V3.8h1.8v1.7h2.2V3.8h1.8v1.7h1.6V14Z" fill="#fff"/>
    </g>
  </svg>`,
  'pip-fort': `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 16 16">
    <circle cx="8" cy="8" r="7" fill="#5a9840" stroke="rgba(0,0,0,0.55)" stroke-width="1.4"/>
    <g transform="translate(3.1,2.9) scale(0.62)">
      <path d="M8 1.8l5 1.9v4.1c0 3.3-3.4 5.6-5 6.4-1.6-.8-5-3.1-5-6.4V3.7Z" fill="#fff"/>
    </g>
  </svg>`,
}

const GARRISON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 16 16">
  <g stroke="rgba(0,0,0,0.7)" stroke-width="3" stroke-linecap="round" fill="none">
    <path d="M3 2.5l9 9M13 2.5l-9 9"/><path d="M10.6 11.4l-1.4 1.4M5.4 11.4l1.4 1.4"/>
  </g>
  <g stroke="#e8d8b0" stroke-width="1.6" stroke-linecap="round" fill="none">
    <path d="M3 2.5l9 9M13 2.5l-9 9"/><path d="M10.6 11.4l-1.4 1.4M5.4 11.4l1.4 1.4"/>
  </g>
</svg>`

function getViewportPolygon(map) {
  const bounds = map.getBounds()
  const ne = bounds.getNorthEast()
  const sw = bounds.getSouthWest()
  return [[
    [ne.lat, sw.lng],
    [ne.lat, ne.lng],
    [sw.lat, ne.lng],
    [sw.lat, sw.lng],
    [ne.lat, sw.lng],
  ]]
}

function getViewportHexes(map) {
  if (map.getZoom() < 8) return []
  return polygonToCells(getViewportPolygon(map), HEX_RESOLUTION)
}

function getOverviewHexes(map) {
  const zoom = map.getZoom()
  if (zoom >= 8 || zoom < 3) return { cells: [], res: 4 }
  const res = zoom < 5 ? 2 : zoom < 6 ? 3 : zoom < 7 ? 4 : 5
  return { cells: polygonToCells(getViewportPolygon(map), res), res }
}

function buildOverviewGeoJSON(cells, res, claimedHexes) {
  // Bottom-up: walk claimed hexes once, find their parent at overview res - O(claimed) not O(cells × children)
  const ownerByParent = {}
  for (const [cell, claimed] of Object.entries(claimedHexes)) {
    if (!claimed.owner_id) continue
    const parent = cellToParent(cell, res)
    if (!ownerByParent[parent]) ownerByParent[parent] = {}
    const entry = ownerByParent[parent][claimed.owner_id] ||= { count: 0, color: claimed.color }
    entry.count++
  }

  return {
    type: 'FeatureCollection',
    features: cells.map(cell => {
      const boundary = cellToBoundary(cell)
      const coords = boundary.map(([lat, lng]) => [lng, lat])
      coords.push(coords[0])
      const tally = ownerByParent[cell] || {}
      const dominant = Object.values(tally).sort((a, b) => b.count - a.count)[0]
      return {
        type: 'Feature',
        properties: { color: dominant?.color || null },
        geometry: { type: 'Polygon', coordinates: [coords] },
      }
    }),
  }
}

function hexToGeoJSONFeature(cell, claimed, visibleSet) {
  const boundary = cellToBoundary(cell)
  const coords = boundary.map(([lat, lng]) => [lng, lat])
  coords.push(coords[0])
  // fog = claimed enemy hex outside the visible ring - unless its garrison
  // (or its owner's total host) is too massive to hide (power projection)
  const fog = !!claimed?.owner_id && !!visibleSet && !visibleSet.has(cell) && !claimed?.projected
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

function buildVisibleSet(claimedHexes, playerId, allyIds) {
  const visible = new Set()
  for (const [cell, claimed] of Object.entries(claimedHexes)) {
    const isOwn = claimed.owner_id === playerId
    const isAlly = !!allyIds && allyIds.has(claimed.owner_id)
    if (!isOwn && !isAlly) continue
    // Own + allied hexes + 1-ring adjacency always visible
    gridDisk(cell, 1).forEach(c => visible.add(c))
  }
  return visible
}

function buildClaimedPoints(claimedHexes, visibleSet) {
  const features = Object.entries(claimedHexes).map(([cell, claimed]) => {
    const [lat, lng] = cellToLatLng(cell)
    const isVisible = !visibleSet || visibleSet.has(cell) || claimed.projected
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

// Pip colors by building type - matches BottomDrawer dots
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
      if (!PIP_COLORS[type]) return
      const ox = startX + i * spacing
      features.push({
        type: 'Feature',
        properties: { pip_type: type },
        geometry: { type: 'Point', coordinates: [clng + (ox * HEX_SHORT_RAD) / cosLat, clat + 0.12 * HEX_SHORT_RAD] },
      })
    })
  }
  return { type: 'FeatureCollection', features }
}

function HarvestCountdown({ nextTickAt, onExpire, compact }) {
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
    <span style={{ fontSize: 11, color: secs <= 5 ? '#c9902a' : '#7a6890', whiteSpace: 'nowrap' }}>
      {compact ? `⏳${label}` : `harvest in ${label}`}
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
  const [alliance, setAlliance] = useState(null)
  const [showAlliance, setShowAlliance] = useState(false)
  const allyIdsRef = useRef(null)
  const [season, setSeason] = useState(null)
  const [seasonHistory, setSeasonHistory] = useState([])
  const [showSeason, setShowSeason] = useState(false)
  const [endedSeason, setEndedSeason] = useState(null)

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

  const strategicRef = useRef({})
  const zonesRef = useRef(new Map()) // h3 → city name, for click enrichment
  const zoneBonusRef = useRef(2)     // server's ZONE_BONUS_PER_HEX, for click enrichment
  const [zoneBonus, setZoneBonus] = useState(2) // same value, for the legend re-render

  const loadStrategic = useCallback(async () => {
    if (!map.current?.getSource('strategic')) return
    try {
      const hexes = await api.getStrategicHexes()
      // Store for click enrichment
      const byIndex = {}
      hexes.forEach(h => { byIndex[h.h3_index] = h })
      strategicRef.current = byIndex

      const features = hexes.map(h => {
        const boundary = cellToBoundary(h.h3_index)
        const coords = boundary.map(([lat, lng]) => [lng, lat])
        coords.push(coords[0])
        return {
          type: 'Feature',
          properties: {
            name: h.name,
            primary: h.primary || false,
            zone: h.zone || false,
            bonus_gold: h.bonus_gold,
            owner_color: h.owner?.color || null,
            owner_username: h.owner?.username || null,
          },
          geometry: { type: 'Polygon', coordinates: [coords] },
        }
      })
      map.current.getSource('strategic').setData({ type: 'FeatureCollection', features })
    } catch {}
  }, [])

  // City zones are static - fetch once and shade them
  const loadZones = useCallback(async () => {
    if (!map.current?.getSource('zones')) return
    try {
      const { bonus, hexes: zones } = await api.getZones()
      zoneBonusRef.current = bonus
      setZoneBonus(bonus)
      zonesRef.current = new Map(zones.map(z => [z.h3, z.city]))
      const features = zones.map(z => {
        const boundary = cellToBoundary(z.h3)
        const coords = boundary.map(([lat, lng]) => [lng, lat])
        coords.push(coords[0])
        return {
          type: 'Feature',
          properties: { city: z.city },
          geometry: { type: 'Polygon', coordinates: [coords] },
        }
      })
      map.current.getSource('zones').setData({ type: 'FeatureCollection', features })
    } catch { /* zones are static, best-effort */ }
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

  const loadAlliance = useCallback(async () => {
    try {
      const a = await api.getMyAlliance()
      setAlliance(a)
      allyIdsRef.current = a ? new Set(a.members.map(m => m.id)) : null
    } catch { /* not logged in */ }
  }, [])

  const loadSeason = useCallback(async () => {
    try {
      const s = await api.getSeason()
      setSeason(s)
      // Rolled over since we last looked? Show the final-standings moment.
      const lastSeen = parseInt(localStorage.getItem('rw_season') || '0', 10)
      if (lastSeen > 0 && s.number > lastSeen) {
        const hist = await api.getSeasonHistory()
        setSeasonHistory(hist)
        const prev = hist.find(h => h.number === s.number - 1) || hist[0]
        if (prev) setEndedSeason(prev)
        // Player state (gold, capital) was reset server-side - resync
        if (playerRef.current) api.me().then(p => onPlayerUpdate?.(p)).catch(() => {})
      }
      localStorage.setItem('rw_season', String(s.number))
    } catch { /* no active season */ }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Initial loads on mount
  useEffect(() => { loadClaimed() }, [loadClaimed])
  useEffect(() => { loadArmies() }, [loadArmies])
  useEffect(() => { loadActiveBattles() }, [loadActiveBattles])
  useEffect(() => { if (player) loadStats() }, [player?.id, loadStats])
  useEffect(() => { loadStrategic() }, [loadStrategic])
  useEffect(() => {
    // Recompute fog of war for the (possibly new) player and their allies
    if (player) loadAlliance().then(() => updateClaimed())
    else { setAlliance(null); allyIdsRef.current = null; updateClaimed() }
  }, [player?.id, loadAlliance]) // eslint-disable-line react-hooks/exhaustive-deps

  // External fly-to requests (e.g. FTUE "take me to the front")
  useEffect(() => {
    const handler = (e) => {
      const { lat, lng, zoom: z } = e.detail || {}
      if (lat == null || lng == null) return
      map.current?.flyTo({ center: [lng, lat], zoom: z || 9, speed: 1.2 })
    }
    window.addEventListener('rw:flyto', handler)
    return () => window.removeEventListener('rw:flyto', handler)
  }, [])

  useEffect(() => { loadSeason() }, [loadSeason])

  // Socket-driven updates - replace polling intervals
  useSocket({
    'hexes:update': () => { loadClaimed(); loadStrategic() },
    'armies:update': loadArmies,
    'battle:update': loadActiveBattles,
    'tick': loadStats,
    'season:update': loadSeason,
  })

  useEffect(() => {
    if (!selectedHex) { setActiveBattle(null); return }
    async function checkBattle() {
      try {
        const result = await api.getBattle(selectedHex.h3)
        const newBattle = result.battle || null
        setActiveBattle(prev => {
          if (prev && !newBattle) loadClaimed() // battle just resolved - refresh map immediately
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
      // Sprites for garrison + building badges
      addSvgImage(map.current, 'garrison-icon', GARRISON_SVG)
      for (const [id, svg] of Object.entries(PIP_SPRITES)) addSvgImage(map.current, id, svg)

      // City zones - subtle background shading for each city's ring of influence.
      // Sits beneath ownership so claimed colors paint over it.
      map.current.addSource('zones', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      map.current.addLayer({
        id: 'zone-fill',
        type: 'fill',
        source: 'zones',
        minzoom: 4,
        paint: { 'fill-color': '#e0b84a', 'fill-opacity': 0.16 },
      })
      map.current.addLayer({
        id: 'zone-border',
        type: 'line',
        source: 'zones',
        minzoom: 4,
        paint: { 'line-color': '#e0b84a', 'line-width': 1.2, 'line-opacity': 0.45 },
      })

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

      // Point source for labels - avoids polygon-tile duplication at high zoom
      map.current.addSource('claimed-points', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })

      // Overview hex grid - coarser resolution at low zoom (zoom 3–7)
      map.current.addSource('overview-hexes', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      map.current.addLayer({
        id: 'overview-hex-fill',
        type: 'fill',
        source: 'overview-hexes',
        paint: {
          'fill-color': ['case', ['!=', ['get', 'color'], null], ['get', 'color'], 'rgba(60,40,120,0.5)'],
          'fill-opacity': 0.4,
        },
      })
      map.current.addLayer({
        id: 'overview-hex-border',
        type: 'line',
        source: 'overview-hexes',
        paint: { 'line-color': '#4a3a7a', 'line-width': 0.8, 'line-opacity': 0.6 },
      })

      // Full hex grid (visible at zoom 7+)
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
          'icon-image': ['case', ['!=', ['get', 'troop_count'], 0], 'garrison-icon', ''],
          'icon-size': ['interpolate', ['linear'], ['zoom'], 7, 0.32, 10, 0.46],
          'icon-anchor': 'right',
          'icon-offset': [2, 32],
          'text-field': ['case',
            ['==', ['get', 'troop_count'], -1], '?',
            ['>', ['get', 'troop_count'], 0], ['to-string', ['get', 'troop_count']],
            ''
          ],
          'text-font': ['Noto Sans Regular'],
          'text-size': 15,
          'text-allow-overlap': false,
          'text-anchor': 'left',
          'text-offset': [0.15, 1.0],
        },
        paint: {
          'text-color': 'rgba(255,255,255,0.95)',
          'text-halo-color': 'rgba(0,0,0,0.8)',
          'text-halo-width': 2,
        },
      })

      // Building pips - one colored dot per building, arranged in a 3×2 grid inside each hex
      map.current.addSource('building-pips', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      map.current.addLayer({
        id: 'building-pips',
        type: 'symbol',
        source: 'building-pips',
        minzoom: 6.5,
        layout: {
          'icon-image': ['concat', 'pip-', ['get', 'pip_type']],
          'icon-size': ['interpolate', ['linear'], ['zoom'], 6.5, 0.3, 9.5, 0.62],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      })

      // March beam paths - rendered below army dots
      map.current.addSource('march-paths', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.current.addSource('march-dests', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      // Outer glow
      map.current.addLayer({
        id: 'march-path-glow', type: 'line', source: 'march-paths', minzoom: 5,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': 14, 'line-blur': 10, 'line-opacity': 0.18 },
      })
      // Core beam line
      map.current.addLayer({
        id: 'march-path-core', type: 'line', source: 'march-paths', minzoom: 5,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': 1.5, 'line-opacity': 0.55 },
      })
      // Destination ring
      map.current.addLayer({
        id: 'march-dest-ring', type: 'circle', source: 'march-dests', minzoom: 5,
        paint: {
          'circle-radius': 16,
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': ['get', 'color'],
          'circle-stroke-opacity': 0.45,
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
          'circle-stroke-color': ['case', ['==', ['get', 'isEnemy'], 1], '#ff4444', '#ffffff'],
        },
      })
      map.current.addLayer({
        id: 'army-label',
        type: 'symbol',
        source: 'armies',
        minzoom: 5,
        layout: {
          'text-field': ['get', 'label'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 12,
          'text-anchor': 'left',
          'text-offset': [0.55, 0.05],
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': 'rgba(0,0,0,0.8)',
          'text-halo-width': 1,
        },
      })

      // Crossed-swords sprite for marching armies (matches Icons.jsx)
      const armySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 16 16">
        <g stroke="rgba(0,0,0,0.65)" stroke-width="3" stroke-linecap="round" fill="none">
          <path d="M3 2.5l9 9M13 2.5l-9 9"/><path d="M10.6 11.4l-1.4 1.4M5.4 11.4l1.4 1.4"/>
        </g>
        <g stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" fill="none">
          <path d="M3 2.5l9 9M13 2.5l-9 9"/><path d="M10.6 11.4l-1.4 1.4M5.4 11.4l1.4 1.4"/>
        </g>
      </svg>`
      const armyImg = new Image(40, 40)
      armyImg.onload = () => {
        if (!map.current || map.current.hasImage?.('army-icon')) return
        map.current.addImage('army-icon', armyImg)
        map.current.setLayoutProperty('army-label', 'icon-image', 'army-icon')
        map.current.setLayoutProperty('army-label', 'icon-size', 0.42)
        map.current.setLayoutProperty('army-label', 'icon-allow-overlap', true)
        map.current.setLayoutProperty('army-label', 'icon-ignore-placement', true)
        map.current.setLayoutProperty('army-label', 'icon-anchor', 'right')
        map.current.setLayoutProperty('army-label', 'icon-offset', [8, 1])
      }
      armyImg.src = 'data:image/svg+xml;base64,' + btoa(armySvg)

      // Strategic hex layer - always visible, shows name + gold bonus
      map.current.addSource('strategic', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      map.current.addLayer({
        id: 'strategic-fill',
        type: 'fill',
        source: 'strategic',
        paint: {
          'fill-color': ['case', ['!=', ['get', 'owner_color'], null], ['get', 'owner_color'], '#c9902a'],
          'fill-opacity': ['case', ['!=', ['get', 'owner_color'], null], 0.55, 0.25],
        },
      })
      map.current.addLayer({
        id: 'strategic-border',
        type: 'line',
        source: 'strategic',
        paint: { 'line-color': '#f0c040', 'line-width': 1.5, 'line-opacity': 0.9 },
      })
      map.current.addLayer({
        id: 'strategic-label',
        type: 'symbol',
        source: 'strategic',
        minzoom: 4,
        layout: {
          'text-field': ['concat',
            ['get', 'name'],
            '\n+', ['to-string', ['get', 'bonus_gold']], 'g',
            ['case', ['boolean', ['get', 'zone'], false], ' +zone', ''],
          ],
          'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 4, 9, 8, 13],
          'text-allow-overlap': false,
          'text-anchor': 'center',
        },
        paint: {
          'text-color': '#f0d080',
          'text-halo-color': 'rgba(0,0,0,0.85)',
          'text-halo-width': 2,
        },
      })

      // Battle hexes - the whole contested hex burns red; scales with zoom
      map.current.addSource('battle-hexes', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      map.current.addLayer({
        id: 'battle-hex-fill',
        type: 'fill',
        source: 'battle-hexes',
        paint: { 'fill-color': '#ff3030', 'fill-opacity': 0.25 },
      })
      map.current.addLayer({
        id: 'battle-hex-border',
        type: 'line',
        source: 'battle-hexes',
        layout: { 'line-join': 'round' },
        paint: { 'line-color': '#ff4040', 'line-width': 3, 'line-opacity': 0.9 },
      })

      updateHexes()
      updateOverview()
      updateClaimed()
      loadStrategic()
      loadZones()
      // armies state may already be loaded - force a sync
      map.current.once('idle', () => {
        setArmies(prev => [...prev])
      })

      // New player with no capital - zoom to Europe at a playable level
      if (!playerRef.current?.capital_hex) {
        map.current.flyTo({ center: [10, 48], zoom: 8, speed: 0.6 })
      }
    })

    map.current.on('moveend', () => { updateHexes(); updateOverview() })
    map.current.on('zoomend', () => { updateHexes(); updateOverview() })
    map.current.on('zoom', () => {
      const z = map.current.getZoom()
      setZoom(z)
      if (z < 8 && !marchModeRef.current && !rallyModeRef.current) {
        map.current.getCanvas().style.cursor = 'zoom-in'
      } else if (z >= 8) {
        map.current.getCanvas().style.cursor = ''
      }
    })

    map.current.on('click', 'hex-fill', (e) => {
      const hex = e.features[0]?.properties
      if (!hex) return

      // Rally mode: set rally destination
      if (rallyModeRef.current) {
        const fromHex = rallyModeRef.current
        api.setRally(fromHex, hex.h3)
          .then(() => { loadClaimed(); toast('Rally point set', 'success') })
          .catch(err => toast(err.message))
        setRallyMode(null)
        map.current.getCanvas().style.cursor = ''
        return
      }

      setMarchMode(prev => {
        if (prev) {
          if (prev.battleMode) {
            // Battle reinforce: clicked hex is the source - send everything there at once
            const src = claimedRef.current[hex.h3]
            const qty = src?.owner_id === playerRef.current?.id ? (src?.troop_count || 0) : 0
            if (qty <= 0) {
              toast('Pick one of your hexes with troops stationed')
              return prev
            }
            api.marchArmy(hex.h3, prev.targetHex, 'troop', qty)
              .then(() => toast(`${qty} troops marching to the battle`, 'success'))
              .catch(err => toast(err.message))
            map.current.getCanvas().style.cursor = ''
            return null
          }
          if (prev.troops) {
            // Multi-type dispatch from the drawer
            const entries = Object.entries(prev.troops).filter(([, qty]) => qty > 0)
            Promise.all(entries.map(([type, qty]) => api.marchArmy(prev.fromHex, hex.h3, type, qty)))
              .then(() => loadClaimed())
              .catch(err => toast(err.message))
            map.current.getCanvas().style.cursor = ''
            return null
          }
          // Single-type march
          api.marchArmy(prev.fromHex, hex.h3, prev.type, prev.quantity)
            .then(() => loadClaimed())
            .catch(err => toast(err.message))
          map.current.getCanvas().style.cursor = ''
          return null
        }
        // Normal click - select hex, enrich with strategic + city-zone info
        const strategic = strategicRef.current[hex.h3]
        const enriched = {
          ...hex,
          zone_city: zonesRef.current.get(hex.h3) || null,
          zone_bonus: zoneBonusRef.current,
          ...(strategic ? {
            strategic_name: strategic.name,
            strategic_bonus: strategic.bonus_gold,
            strategic_primary: strategic.primary,
          } : {}),
        }
        setSelectedHex(enriched)
        map.current.setFilter('hex-selected', ['==', ['get', 'h3'], hex.h3])
        return null
      })
    })

    map.current.on('mouseenter', 'hex-fill', () => {
      map.current.getCanvas().style.cursor = (marchModeRef.current || rallyModeRef.current) ? 'crosshair' : 'pointer'
    })
    map.current.on('mouseleave', 'hex-fill', () => { map.current.getCanvas().style.cursor = '' })

    // Clicking an overview hex zooms into that area
    map.current.on('click', 'overview-hex-fill', (e) => {
      const center = e.lngLat
      map.current.flyTo({ center: [center.lng, center.lat], zoom: 7, speed: 0.8 })
    })

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

    // Whole-hex battle overlay
    if (map.current.getSource('battle-hexes')) {
      const features = activeBattles.map(b => {
        try {
          const boundary = cellToBoundary(b.h3_index)
          const coords = boundary.map(([lat, lng]) => [lng, lat])
          coords.push(coords[0])
          return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [coords] } }
        } catch { return null }
      }).filter(Boolean)
      map.current.getSource('battle-hexes').setData({ type: 'FeatureCollection', features })
    }

    // Add new markers
    for (const battle of activeBattles) {
      if (battleMarkersRef.current[battle.h3_index]) continue
      const [lat, lng] = cellToLatLng(battle.h3_index)
      const el = document.createElement('div')
      el.className = 'battle-ring'
      el.innerHTML = `<svg viewBox="0 0 16 16" style="position:absolute;top:50%;left:50%;width:24px;height:24px;transform:translate(-50%,-50%)"><g stroke="#ff5050" stroke-width="1.6" stroke-linecap="round" fill="none"><path d="M3 2.5l9 9M13 2.5l-9 9"/><path d="M10.6 11.4l-1.4 1.4M5.4 11.4l1.4 1.4"/></g></svg>`
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

    // Pulse the burning hex while battles rage
    if (activeBattles.length === 0) return
    let t = 0
    const pulse = setInterval(() => {
      if (!map.current?.getLayer('battle-hex-fill')) return
      t += 0.15
      const wave = 0.5 + 0.5 * Math.sin(t)
      try {
        map.current.setPaintProperty('battle-hex-fill', 'fill-opacity', 0.15 + 0.25 * wave)
        map.current.setPaintProperty('battle-hex-border', 'line-opacity', 0.5 + 0.45 * wave)
      } catch { /* layer mid-update */ }
    }, 60)
    return () => clearInterval(pulse)
  }, [activeBattles])

  function updateHexes() {
    if (!map.current?.getSource('hexes')) return
    const cells = getViewportHexes(map.current)
    map.current.getSource('hexes').setData(buildGeoJSON(cells, claimedRef.current, visibleSetRef.current))
  }

  function updateOverview() {
    if (!map.current?.getSource('overview-hexes')) return
    const { cells, res } = getOverviewHexes(map.current)
    map.current.getSource('overview-hexes').setData(buildOverviewGeoJSON(cells, res, claimedRef.current))
  }

  function updateClaimed() {
    if (!map.current?.getSource('claimed')) return
    const p = playerRef.current
    const visibleSet = p ? buildVisibleSet(claimedRef.current, p.id, allyIdsRef.current) : null
    visibleSetRef.current = visibleSet
    map.current.getSource('claimed').setData(buildClaimedGeoJSON(claimedRef.current, visibleSet))
    map.current.getSource('claimed-points')?.setData(buildClaimedPoints(claimedRef.current, visibleSet))
    map.current.getSource('building-pips')?.setData(buildPipFeatures(claimedRef.current))
    updateOverview()
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

    // Hex paths don't change while an army marches - compute once per army
    const pathCache = new Map()

    // Continuous position along the army's hex path, so the dot glides
    // instead of snapping hex-to-hex (and stays glued to the beam line)
    function armyPathPos(a) {
      let path = pathCache.get(a.id)
      if (!path) {
        try { path = gridPathCells(a.from_hex, a.to_hex).map(cellToLatLng) } catch { return null }
        pathCache.set(a.id, path)
      }
      const total = new Date(a.arrives_at) - new Date(a.departed_at)
      const elapsed = Date.now() - new Date(a.departed_at)
      const progress = Math.min(1, Math.max(0, elapsed / total))
      const segs = path.length - 1
      if (segs <= 0) return { lat: path[0][0], lng: path[0][1] }
      const t = progress * segs
      const i = Math.min(Math.floor(t), segs - 1)
      const frac = t - i
      const [aLat, aLng] = path[i]
      const [bLat, bLng] = path[i + 1]
      return { lat: aLat + (bLat - aLat) * frac, lng: aLng + (bLng - aLng) * frac }
    }

    function updateArmyPositions() {
      if (!map.current?.getSource('armies')) return
      const currentPlayer = playerRef.current
      const currentClaimed = claimedRef.current
      const activeIds = new Set()

      const features = armiesRef.current.map(a => {
        const pos = armyPathPos(a)
        if (!pos) return null
        const { lat, lng } = pos
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
            label: `${a.quantity}`,
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

      // Beam paths: line from the marching dot → destination (shrinks as army travels)
      if (map.current.getSource('march-paths')) {
        const pathFeatures = armiesRef.current.map(a => {
          try {
            const pos = armyPathPos(a)
            if (!pos) return null
            const [tLat, tLng] = cellToLatLng(a.to_hex)
            return {
              type: 'Feature',
              properties: { color: a.color || '#f0c040' },
              geometry: { type: 'LineString', coordinates: [[pos.lng, pos.lat], [tLng, tLat]] },
            }
          } catch { return null }
        }).filter(Boolean)
        map.current.getSource('march-paths').setData({ type: 'FeatureCollection', features: pathFeatures })
      }

      // Destination rings
      if (map.current.getSource('march-dests')) {
        const destFeatures = armiesRef.current.map(a => {
          try {
            const [tLat, tLng] = cellToLatLng(a.to_hex)
            return {
              type: 'Feature',
              properties: { color: a.color || '#f0c040' },
              geometry: { type: 'Point', coordinates: [tLng, tLat] },
            }
          } catch { return null }
        }).filter(Boolean)
        map.current.getSource('march-dests').setData({ type: 'FeatureCollection', features: destFeatures })
      }
    }

    updateArmyPositions()
    const interval = setInterval(updateArmyPositions, 150)

    // Pulse the destination ring opacity
    let pulseT = 0
    const pulseInterval = setInterval(() => {
      if (!map.current?.getLayer('march-dest-ring')) return
      pulseT += 0.12
      const opacity = 0.2 + 0.35 * (0.5 + 0.5 * Math.sin(pulseT))
      try { map.current.setPaintProperty('march-dest-ring', 'circle-stroke-opacity', opacity) } catch {}
    }, 50)

    return () => { clearInterval(interval); clearInterval(pulseInterval) }
  }, [armies])

  async function handleClaim(h3Index) {
    if (!player) return
    try {
      const result = await api.claimHex(h3Index)
      if (result.isCapital) {
        onPlayerUpdate?.({ capital_hex: h3Index })
        toast('Capital founded! A free Mine has been built.', 'success')
      } else {
        toast('Territory claimed.', 'success')
      }
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
        {/* Title - hidden on mobile */}
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
            <SearchIcon size={16} color="#7a6890" />
          </button>
        )}

        {season && (
          <SeasonChip
            season={season}
            isMobile={isMobile}
            onClick={async () => {
              try { setSeasonHistory(await api.getSeasonHistory()) } catch { /* offline */ }
              setShowSeason(true)
            }}
          />
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
              {goldCap !== null && (goldOverCap || !isMobile) && (
                <span style={{ fontSize: 11, color: goldOverCap ? '#8a5818' : '#7a6890' }}>
                  {goldOverCap ? <WarningIcon size={11} color="#e8a020" /> : `/ ${goldCap}`}
                </span>
              )}
              {stats && !isMobile && <GoldIncomeTooltip hexCount={stats.hex_count || 0} mines={stats.mines || 0} incomeByCountry={stats.income_by_country} />}
            </div>
            {stats?.next_tick_at && <HarvestCountdown nextTickAt={stats.next_tick_at} onExpire={loadStats} compact={isMobile} />}
            {!isMobile && <span style={{ fontSize: 13, color: '#7a6890' }}>▲ {stats?.hex_count ?? ownedHexCount}</span>}
            {!isMobile && totalTroops > 0 && <span style={{ fontSize: 13, color: '#7a6890' }}><SwordsIcon size={12} color="#7a6890" /> {totalTroops}</span>}
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
            <button
              onClick={() => setShowAlliance(true)}
              title={alliance ? `Alliance: ${alliance.name}` : 'Join or found an alliance'}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: alliance ? '#c0a0f0' : '#7a6890', fontSize: 15, padding: '4px 6px',
                fontFamily: 'Georgia, serif',
              }}>
              <AllianceIcon size={15} color={alliance ? '#c0a0f0' : '#7a6890'} />{alliance && !isMobile ? ` ${alliance.tag}` : ''}
            </button>
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

      {/* ── City-zone legend ─────────────────────────────────────── */}
      {zoom >= 5 && !isMobile && (
        <div style={{
          // chat bubble (ChatPanel) occupies bottom-left 16px when logged in
          position: 'absolute', bottom: 16, left: player ? 74 : 16, pointerEvents: 'none',
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'rgba(20,15,40,0.82)', border: '1px solid rgba(224,184,74,0.35)',
          borderRadius: 6, padding: '6px 11px',
          fontFamily: 'Georgia, serif', fontSize: 12, color: '#cdb98a', letterSpacing: 0.5,
        }}>
          <span style={{ width: 13, height: 13, borderRadius: 3, background: 'rgba(224,184,74,0.35)', border: '1px solid rgba(224,184,74,0.7)' }} />
          City zone — <span style={{ color: '#e0b84a' }}>+{zoneBonus}g</span> per hex you hold
        </div>
      )}

      {/* ── Zoom hint ───────────────────────────────────────────── */}
      {zoom < 8 && (
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
                : marchMode?.troops
                  ? `Marching ${Object.values(marchMode.troops).reduce((s, n) => s + n, 0)} troops - click destination`
                  : 'Select target hex'}
          </span>
          <button
            onClick={() => { setMarchMode(null); setRallyMode(null); map.current.getCanvas().style.cursor = '' }}
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

      {/* ── Chat (bottom-left) ──────────────────────────────────── */}
      <ChatPanel player={player} alliance={alliance} />

      {/* ── Alliance modal ──────────────────────────────────────── */}
      {showAlliance && (
        <AlliancePanel
          alliance={alliance}
          onChanged={loadAlliance}
          onClose={() => setShowAlliance(false)}
        />
      )}

      {/* ── Season dashboard ────────────────────────────────────── */}
      {showSeason && season && (
        <SeasonPanel
          season={season}
          history={seasonHistory}
          player={player}
          onClose={() => setShowSeason(false)}
        />
      )}

      {/* ── Season end - final standings moment ─────────────────── */}
      {endedSeason && season && (
        <SeasonEndOverlay
          endedSeason={endedSeason}
          newNumber={season.number}
          player={player}
          onDismiss={() => setEndedSeason(null)}
        />
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

      {/* ── Bottom drawer - replaces all floating panels ────────── */}
      {selectedHex && !activeBattle && (
        <BottomDrawer
          hex={selectedHex}
          player={player}
          stats={stats}
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
          onSetRallyMode={fromHex => { setRallyMode(fromHex); setSelectedHex(null) }}
          onClose={() => {
            setSelectedHex(null)
            map.current?.setFilter('hex-selected', ['==', ['get', 'h3'], ''])
          }}
        />
      )}
    </div>
  )
}

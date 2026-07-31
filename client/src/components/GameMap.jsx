import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useSocket, identifySocket } from '../hooks/useSocket'
import { toast } from '../toastBus'
import maplibregl from 'maplibre-gl'
import { polygonToCells, cellToBoundary, cellToLatLng, gridDisk, gridPathCells } from 'h3-js'
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
import { GoldIcon, SearchIcon, AllianceIcon, SwordsIcon, WarningIcon, KeepIcon } from './Icons'
import { resolveFlag, flagImageId, flagToImageData } from '../flags'
import { playSound } from '../sound.js'


const HEX_RESOLUTION = 7
// Chat ships behind a flag until there's moderation (see server config.js)
const CHAT_ON = import.meta.env.VITE_CHAT_ENABLED === 'true'

// Map marker sprites are rasterized once (via Image() + addImage) and reused
// as WebGL textures - unlike the DOM <Svg> icons in Icons.jsx, which stay
// vector and rescale losslessly, these bake to a fixed pixel size. Generating
// them at only their logical CSS size makes them soft/blurry on any
// high-DPI (retina) display, since MapLibre would otherwise assume 1x source
// density and upscale. DPR renders each sprite's own width/height attributes
// (not just the viewBox) at device pixel density, and pixelRatio on
// addImage tells MapLibre how to map that back to logical size - so every
// existing icon-size value elsewhere keeps working unchanged.
const DPR = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 3) : 1

function addSvgImage(map, id, svg) {
  if (map.hasImage?.(id)) return
  const img = new Image()
  img.onload = () => { if (map && !map.hasImage?.(id)) map.addImage(id, img, { pixelRatio: DPR }) }
  img.src = 'data:image/svg+xml;base64,' + btoa(svg)
}

// Mini building badges - white glyph on the building's pip color
const PIP_SPRITES = {
  'pip-mine': `<svg xmlns="http://www.w3.org/2000/svg" width="${28 * DPR}" height="${28 * DPR}" viewBox="0 0 16 16">
    <circle cx="8" cy="8" r="7" fill="#c9902a" stroke="rgba(0,0,0,0.55)" stroke-width="1.4"/>
    <g transform="translate(2.9,2.9) scale(0.64)">
      <line x1="5" y1="13.5" x2="10.8" y2="4.4" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
      <path d="M4 5.8C6.5 2.2 11 2 13.3 4.4c-1.8-.5-4.3-.3-6 .8Z" fill="#fff"/>
    </g>
  </svg>`,
  'pip-barracks': `<svg xmlns="http://www.w3.org/2000/svg" width="${28 * DPR}" height="${28 * DPR}" viewBox="0 0 16 16">
    <circle cx="8" cy="8" r="7" fill="#a84040" stroke="rgba(0,0,0,0.55)" stroke-width="1.4"/>
    <g transform="translate(3.1,2.9) scale(0.62)">
      <path d="M3.5 14V5.5h1.6V3.8h1.8v1.7h2.2V3.8h1.8v1.7h1.6V14Z" fill="#fff"/>
    </g>
  </svg>`,
  'pip-fort': `<svg xmlns="http://www.w3.org/2000/svg" width="${28 * DPR}" height="${28 * DPR}" viewBox="0 0 16 16">
    <circle cx="8" cy="8" r="7" fill="#5a9840" stroke="rgba(0,0,0,0.55)" stroke-width="1.4"/>
    <g transform="translate(3.1,2.9) scale(0.62)">
      <path d="M8 1.8l5 1.9v4.1c0 3.3-3.4 5.6-5 6.4-1.6-.8-5-3.1-5-6.4V3.7Z" fill="#fff"/>
    </g>
  </svg>`,
}

const GARRISON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="${32 * DPR}" height="${32 * DPR}" viewBox="0 0 16 16">
  <g stroke="rgba(0,0,0,0.7)" stroke-width="3" stroke-linecap="round" fill="none">
    <path d="M3 2.5l9 9M13 2.5l-9 9"/><path d="M10.6 11.4l-1.4 1.4M5.4 11.4l1.4 1.4"/>
  </g>
  <g stroke="#e8d8b0" stroke-width="1.6" stroke-linecap="round" fill="none">
    <path d="M3 2.5l9 9M13 2.5l-9 9"/><path d="M10.6 11.4l-1.4 1.4M5.4 11.4l1.4 1.4"/>
  </g>
</svg>`

// World Wonders: each landmark gets its own gold silhouette on the shared
// dark disc, so the set reads as one family but every wonder is recognizable
const wonderSprite = (glyph) => `<svg xmlns="http://www.w3.org/2000/svg" width="${44 * DPR}" height="${44 * DPR}" viewBox="0 0 22 22">
  <circle cx="11" cy="11" r="10" fill="rgba(18,12,30,0.92)" stroke="#e0b84a" stroke-width="1.4"/>
  <g fill="#e8c55a">${glyph}</g>
</svg>`

const WONDER_SPRITES = {
  // Generic temple - fallback for any wonder without a bespoke glyph
  generic: wonderSprite(`
    <path d="M11 4.2 L17 8 H5 Z"/>
    <rect x="5.6" y="8.8" width="1.9" height="5.4"/>
    <rect x="10.05" y="8.8" width="1.9" height="5.4"/>
    <rect x="14.5" y="8.8" width="1.9" height="5.4"/>
    <rect x="4.6" y="14.8" width="12.8" height="1.9"/>`),
  // Eiffel Tower - flared lattice tower with two decks
  eiffel: wonderSprite(`
    <path d="M10.2 3.8h1.6l.4 4.6c.3 2.7 1.5 5.7 3.5 8.4h-2.6c-.8-1.3-1.5-2.7-2.1-4.4-.6 1.7-1.3 3.1-2.1 4.4H6.3c2-2.7 3.2-5.7 3.5-8.4Z"/>
    <rect x="8.4" y="8.2" width="5.2" height="1.2"/>
    <rect x="6.6" y="12.6" width="8.8" height="1.2"/>`),
  // Pyramids of Giza - two pyramids
  giza: wonderSprite(`
    <path d="M8.6 6.2 14.2 16 H3 Z"/>
    <path d="M14.6 9.2 18.9 16 h-8.6 Z"/>`),
  // Colosseum - arched arena front
  colosseum: wonderSprite(`
    <path fill-rule="evenodd" d="M4.4 16.2V9.8C4.4 7.2 7.2 5.4 11 5.4s6.6 1.8 6.6 4.4v6.4h-2.8v-4.1a1.45 1.45 0 0 0-2.9 0v4.1h-1.8v-4.1a1.45 1.45 0 0 0-2.9 0v4.1Z"/>`),
  // Tower of London - crenellated keep
  tower: wonderSprite(`
    <path d="M5.2 16.2V6.4h2v1.7h2.2V6.4h3.2v1.7h2.2V6.4h2v9.8Z"/>
    <rect x="9.9" y="11.4" width="2.2" height="4.8" fill="rgba(18,12,30,0.92)"/>`),
  // Mount Fuji - snow-capped cone
  fuji: wonderSprite(`
    <path d="M3.2 16 9.4 6h3.2L18.8 16Z"/>
    <path d="M9.7 6.5h2.6l1.2 2c-.9.8-1.7.2-2.5.9-.8-.7-1.6-.1-2.5-.9Z" fill="#f5eeda"/>`),
  // Taj Mahal - onion dome, plinth and minarets
  taj: wonderSprite(`
    <path d="M11 3.6c.3 1 .9 1.5 1.9 2.2 1.2.8 1.9 2 1.9 3.4 0 1-.3 1.9-.8 2.7H8c-.5-.8-.8-1.7-.8-2.7 0-1.4.7-2.6 1.9-3.4 1-.7 1.6-1.2 1.9-2.2Z"/>
    <rect x="4.4" y="8.2" width="1.3" height="4.3"/>
    <rect x="16.3" y="8.2" width="1.3" height="4.3"/>
    <rect x="4.4" y="13.2" width="13.2" height="1.4"/>
    <rect x="5.4" y="15.3" width="11.2" height="1.5"/>`),
  // Christ the Redeemer - figure with outstretched arms
  redeemer: wonderSprite(`
    <circle cx="11" cy="4.4" r="1.3"/>
    <path d="M10.2 6.2h1.6v.9l5.6.9v1.6l-5.6-.3v4.9h1.7v2h-5v-2h1.7V9.3l-5.6.3V8l5.6-.9Z"/>`),
  // Great Wall - stepped crenellated wall
  greatwall: wonderSprite(`
    <path d="M3.4 16.2v-5.4h1.5v1.3h1.7v-1.3h1.7v1.3H10V9.4h1.7V8.1h1.5v1.3h1.7v1.4h1.7v-1.4h2v6.8Z"/>`),
  // Machu Picchu - terraced twin peaks
  machupicchu: wonderSprite(`
    <path d="M3.2 16 8 8l1.8 2.9L12.9 5.4 18.8 16Z"/>
    <path d="M4.8 13.6h7.4v.9H4.3Zm1.3-2.2h5.2v.9H5.6Z" fill="rgba(18,12,30,0.92)"/>`),
  // Red Square - St Basil's onion dome and tent tower
  redsquare: wonderSprite(`
    <rect x="10.65" y="1.9" width="0.7" height="1.7"/>
    <path d="M11 3.4c1.6 1.5 2.5 2.6 2.5 4 0 1.3-1.1 2.3-2.5 2.3S8.5 8.7 8.5 7.4c0-1.4.9-2.5 2.5-4Z"/>
    <path d="M9.3 10.4h3.4l.8 3.2H8.5Z"/>
    <rect x="7.2" y="14.2" width="7.6" height="2.2"/>`),
  // Sydney Opera House - overlapping sails
  opera: wonderSprite(`
    <path d="M4.3 14.8C5.3 10 7.8 7.1 11.4 5.6c-1.2 2.2-1.8 4.2-1.9 6.2 1.5-2.9 4-4.8 7.5-5.5-1.9 2.3-3 4.6-3.4 8.5Z"/>
    <rect x="3.6" y="15.4" width="14.8" height="1.4"/>`),
  // Statue of Liberty - torch raised over the harbor
  liberty: wonderSprite(`
    <circle cx="10.6" cy="6.2" r="1.3"/>
    <path d="M8.9 4.9 7.6 3.6l.6-.6 1.3 1.3Zm3.4-.9-.4-1.8.8-.2.4 1.8Z"/>
    <circle cx="15.2" cy="3.4" r="1"/>
    <path d="M13.3 6.6l1.4-2.5.9.5-1.3 2.5Z"/>
    <path d="M9.6 8.2h2l1 6h1.6v2H7.2v-2h1.4Z"/>`),
  // Golden Gate Bridge - twin towers and draped cables
  goldengate: wonderSprite(`
    <rect x="5.5" y="4.6" width="1.7" height="9.4"/>
    <rect x="14.8" y="4.6" width="1.7" height="9.4"/>
    <rect x="2.6" y="13.2" width="16.8" height="1.7"/>
    <path d="M2.6 6.2h1c.6 3.1 3 4.9 7.4 4.9s6.8-1.8 7.4-4.9h1v1.2c-1 3.4-3.8 5.2-8.4 5.2S3.6 10.8 2.6 7.4Z"/>`),
}

// Champion's Monument: gold obelisk on a dark disc - permanent across seasons
const MONUMENT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="${44 * DPR}" height="${44 * DPR}" viewBox="0 0 22 22">
  <circle cx="11" cy="11" r="10" fill="rgba(18,12,30,0.92)" stroke="#b89ae0" stroke-width="1.4"/>
  <g fill="#e8c55a">
    <path d="M11 3.4 L12.7 6 L12.1 13.6 H9.9 L9.3 6 Z"/>
    <rect x="8.2" y="14.2" width="5.6" height="1.7"/>
    <rect x="6.8" y="16.4" width="8.4" height="1.9"/>
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

function getViewportHexes(map, resolution = HEX_RESOLUTION) {
  if (map.getZoom() < 8) return []
  return polygonToCells(getViewportPolygon(map), resolution)
}

function getOverviewHexes(map, baseResolution = HEX_RESOLUTION) {
  const zoom = map.getZoom()
  if (zoom >= 8 || zoom < 3) return { cells: [], res: Math.max(0, baseResolution - 3) }
  // Coarser tiers as you zoom out, relative to the base resolution (at the
  // default res 7 this reproduces the original fixed ladder 2/3/4/5) instead
  // of hardcoded absolute resolutions that only made sense at res 7.
  const offset = zoom < 5 ? 5 : zoom < 6 ? 4 : zoom < 7 ? 3 : 2
  const res = Math.max(0, baseResolution - offset)
  return { cells: polygonToCells(getViewportPolygon(map), res), res }
}

// overviewSummary is a pre-aggregated { [parentCell]: { color } } map from
// GET /hexes/overview - the dominant-owner-per-region tally now happens
// server-side (scanning every claimed hex to summarize a huge low-zoom area
// isn't something the client has the data to do anymore now that its own
// hex cache is scoped to "mine + current viewport", and doing it server-side
// keeps the response tiny regardless of total hex count or zoom level).
function buildOverviewGeoJSON(cells, overviewSummary) {
  return {
    type: 'FeatureCollection',
    features: cells.map(cell => {
      const boundary = cellToBoundary(cell)
      const coords = boundary.map(([lat, lng]) => [lng, lat])
      coords.push(coords[0])
      return {
        type: 'Feature',
        properties: { color: overviewSummary[cell]?.color || null },
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
      capital_hex: claimed?.capital_hex || null,
      flag_pixels: claimed?.flag_pixels || null,
      motto: claimed?.motto || null,
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

// Marching armies get more leeway than static hexes - a moving column is
// easier to spot at a distance than a quiet border.
const ARMY_VISION_RINGS = 4

function buildVisibleSet(claimedHexes, playerId, allyIds, ring = 1) {
  const visible = new Set()
  for (const [cell, claimed] of Object.entries(claimedHexes)) {
    const isOwn = claimed.owner_id === playerId
    const isAlly = !!allyIds && allyIds.has(claimed.owner_id)
    if (!isOwn && !isAlly) continue
    gridDisk(cell, ring).forEach(c => visible.add(c))
  }
  return visible
}

// requiredGarrison/playerId are optional - only your own hexes ever show the
// decay warning, and only once your empire is big enough to be at risk at all.
function buildClaimedPoints(claimedHexes, visibleSet, playerId, requiredGarrison = 0) {
  const features = Object.entries(claimedHexes).map(([cell, claimed]) => {
    const [lat, lng] = cellToLatLng(cell)
    const isVisible = !visibleSet || visibleSet.has(cell) || claimed.projected
    const troopCount = claimed.troop_count || 0

    // Mirrors BottomDrawer's atDecayRisk exactly: own, undeveloped, border,
    // under-garrisoned hex, once the empire is past the decay threshold.
    let decayRisk = false
    if (playerId && requiredGarrison > 0 && claimed.owner_id === playerId
      && claimed.capital_hex !== cell && troopCount < requiredGarrison
      && parseTypes(claimed.building_types).length === 0) {
      const neighbors = gridDisk(cell, 1).filter(n => n !== cell)
      const friendlyCount = neighbors.filter(n => claimedHexes[n]?.owner_id === playerId).length
      decayRisk = friendlyCount < neighbors.length // border hex only - interior never decays
    }

    return {
      type: 'Feature',
      properties: {
        troop_count: isVisible ? troopCount : -1,
        decay_risk: decayRisk,
      },
      geometry: { type: 'Point', coordinates: [lng, lat] },
    }
  })
  return { type: 'FeatureCollection', features }
}

// One point per capital hex, carrying the flag image id registered for that
// owner - see ensureFlagImages, which keeps map.addImage in sync with this.
function buildCapitalFeatures(claimedHexes) {
  const features = []
  for (const [cell, claimed] of Object.entries(claimedHexes)) {
    if (claimed.capital_hex !== cell) continue
    const [lat, lng] = cellToLatLng(cell)
    const flagString = resolveFlag(claimed)
    features.push({
      type: 'Feature',
      properties: { owner: claimed.owner_id, iconId: flagImageId(claimed.owner_id, flagString) },
      geometry: { type: 'Point', coordinates: [lng, lat] },
    })
  }
  return { type: 'FeatureCollection', features }
}

// Register (or refresh) the map image for every capital currently in view -
// a no-op for owners already registered under their current flag's image id;
// a changed flag naturally gets a new id (see flagImageId) so it just works.
function ensureFlagImages(map, claimedHexes) {
  for (const claimed of Object.values(claimedHexes)) {
    if (claimed.capital_hex !== claimed.h3_index) continue
    const flagString = resolveFlag(claimed)
    const id = flagImageId(claimed.owner_id, flagString)
    if (!map.hasImage(id)) map.addImage(id, flagToImageData(flagString))
  }
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
  const retryRef = useRef(null)
  useEffect(() => {
    clearInterval(retryRef.current)
    function tick() {
      const remaining = Math.max(0, Math.round((new Date(nextTickAt) - Date.now()) / 1000))
      setSecs(remaining)
      // Hitting 0 doesn't guarantee the real server tick has landed yet (clock
      // skew, request latency) - keep re-fetching until nextTickAt actually
      // moves into the future instead of trusting a single one-shot refetch.
      if (remaining === 0 && !retryRef.current) {
        retryRef.current = setInterval(onExpire, 2000)
      }
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => { clearInterval(id); clearInterval(retryRef.current); retryRef.current = null }
  }, [nextTickAt, onExpire])
  const m = Math.floor(secs / 60), s = secs % 60
  const label = m > 0 ? `${m}m ${String(s).padStart(2,'0')}s` : `${secs}s`
  return (
    <span style={{ fontSize: 11, color: secs <= 5 ? '#c9902a' : '#7a6890', whiteSpace: 'nowrap' }}>
      {compact ? `⏳${label}` : `harvest in ${label}`}
    </span>
  )
}

function GoldIncomeTooltip({ hexCount, mines, incomeByCountry, wonderIncome, total }) {
  const [hover, setHover] = useState(false)
  const [pos, setPos] = useState(null)
  const anchorRef = useRef(null)
  // Server total (income_per_harvest) is authoritative - it's the only place
  // that includes strategic-hex and city-zone bonuses. This naive fallback is
  // only for the rare case stats hasn't loaded that field yet.
  const displayTotal = total ?? (hexCount + mines * 3)

  function show() {
    const r = anchorRef.current?.getBoundingClientRect()
    if (r) setPos({ top: r.bottom + 6, left: r.left + r.width / 2 })
    setHover(true)
  }

  return (
    <span
      ref={anchorRef}
      style={{ fontSize: 11, color: '#6a5848', marginLeft: 2, cursor: 'default', position: 'relative' }}
      onMouseEnter={show}
      onMouseLeave={() => setHover(false)}
    >
      +{displayTotal}g
      {hover && pos && createPortal(
        <div style={{
          position: 'fixed', top: pos.top, left: pos.left, transform: 'translateX(-50%)',
          background: 'rgba(10,7,2,0.97)', border: '1px solid rgba(160,110,30,0.45)',
          borderRadius: 6, padding: '10px 14px',
          fontSize: 12, color: '#c4b498', fontFamily: 'Georgia, serif',
          boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
          zIndex: 1000, minWidth: 200, maxWidth: 280,
        }}>
          <div style={{ color: '#9a8060', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 8 }}>Income per harvest</div>

          {incomeByCountry?.length > 0 ? (
            <>
              {incomeByCountry.map(e => {
                const parts = [`${e.hexes}h`]
                if (e.mines > 0) parts.push(`+${e.mines}m`)
                if (e.strategic > 0) parts.push(`+${e.strategic}★`)
                if (e.zone > 0) parts.push(`+${e.zone}◇`)
                return (
                  <div key={e.country} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 4, lineHeight: 1.6 }}>
                    <span style={{ color: '#a09070' }}>
                      {e.country}
                      <span style={{ color: '#6a5838', fontSize: 10 }}> ({parts.join('')})</span>
                    </span>
                    <span style={{ color: '#d4b870', flexShrink: 0 }}>+{e.income}g</span>
                  </div>
                )
              })}
              {wonderIncome > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 4, lineHeight: 1.6 }}>
                  <span style={{ color: '#a09070' }}>World Wonders</span>
                  <span style={{ color: '#d4b870', flexShrink: 0 }}>+{wonderIncome}g</span>
                </div>
              )}
              <div style={{ borderTop: '1px solid rgba(160,110,30,0.2)', marginTop: 6, paddingTop: 6, display: 'flex', justifyContent: 'space-between', color: '#e0c070' }}>
                <span>Total</span>
                <span>+{displayTotal}g</span>
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
                <span>Total</span><span>+{displayTotal}g</span>
              </div>
            </>
          )}
        </div>,
        document.body
      )}
    </span>
  )
}

export default function GameMap({ player, onLoginRequired, onPlayerUpdate, onShowHelp }) {
  const mapContainer = useRef(null)
  const map = useRef(null)
  // claimedRef is the merge of two sources, kept separate so each can be
  // refreshed independently: myHexesRef (own + allied territory - small,
  // always fully loaded regardless of viewport, needed for fog-of-war/stats/
  // auto-train) and viewportHexesRef (whatever's currently on screen -
  // refetched on pan/zoom). Previously claimedRef was populated from one
  // GET /hexes call that returned every claimed hex on the entire map -
  // multi-megabyte and growing all season, refetched on every hexes:update.
  const claimedRef = useRef({})
  const myHexesRef = useRef({})
  const viewportHexesRef = useRef({})
  const overviewSummaryRef = useRef({}) // parent-cell -> {color}, for the low-zoom overview layer
  const [selectedHex, setSelectedHex] = useState(null)
  const [zoom, setZoom] = useState(3)
  const [marchMode, setMarchMode] = useState(null) // { fromHex, type, quantity }
  const [rallyMode, setRallyMode] = useState(null) // fromHex string or null
  const [armies, setArmies] = useState([])
  const [pendingClaims, setPendingClaims] = useState([]) // your troops on not-yet-owned hexes
  const [activeBattles, setActiveBattles] = useState([])
  const [stats, setStats] = useState(null)
  const [activeBattle, setActiveBattle] = useState(null)
  const dismissedBattleRef = useRef(null) // battle id the player already closed - don't reopen it from the background poll

  // Joins this connection's personal-events room so insertEvent() (server)
  // can target just us instead of broadcasting to every connected client.
  useEffect(() => { identifySocket(player?.id) }, [player?.id])
  const [alliance, setAlliance] = useState(null)
  const [showAlliance, setShowAlliance] = useState(false)
  const allyIdsRef = useRef(null)
  const [season, setSeason] = useState(null)
  const [seasonHistory, setSeasonHistory] = useState([])
  const [showSeason, setShowSeason] = useState(false)
  const [endedSeason, setEndedSeason] = useState(null)

  const visibleSetRef = useRef(null)
  const armyVisibleSetRef = useRef(null)
  const marchModeRef = useRef(marchMode)
  const rallyModeRef = useRef(rallyMode)
  const armiesRef = useRef(armies)
  const playerRef = useRef(player)
  const markersRef = useRef({})
  const battleMarkersRef = useRef({})
  useEffect(() => {
    marchModeRef.current = marchMode
    rallyModeRef.current = rallyMode
    armiesRef.current = armies
    playerRef.current = player
  })

  // Decay-scaling formula constants, for the on-map warning badge below -
  // mirrors config.js's requiredGarrisonForHexCount() exactly. Also carries
  // min_troops_to_claim for the pending-claim "3/5" indicator.
  const decayConfigRef = useRef({ decay_hex_threshold: 30, decay_scale_hexes_per_step: 10, min_troops_to_claim: 5 })

  // The active season's H3 resolution - a ref (not state) because it only
  // ever changes at a season boundary, which already forces a full page
  // reload (see loadSeason below) rather than trying to live-rebuild the
  // map's hex grid and MapLibre sources for a new resolution mid-session.
  const hexResolutionRef = useRef(HEX_RESOLUTION)

  // These read only refs (map, claimedRef, playerRef, etc.) so they're stable
  // across renders - safe to depend on elsewhere without causing re-runs.
  const updateHexes = useCallback(() => {
    if (!map.current?.getSource('hexes')) return
    const cells = getViewportHexes(map.current, hexResolutionRef.current)
    map.current.getSource('hexes').setData(buildGeoJSON(cells, claimedRef.current, visibleSetRef.current))
  }, [])

  const updateOverview = useCallback(() => {
    if (!map.current?.getSource('overview-hexes')) return
    const { cells } = getOverviewHexes(map.current, hexResolutionRef.current)
    map.current.getSource('overview-hexes').setData(buildOverviewGeoJSON(cells, overviewSummaryRef.current))
  }, [])

  const updateClaimed = useCallback(() => {
    if (!map.current?.getSource('claimed')) return
    const p = playerRef.current
    const visibleSet = p ? buildVisibleSet(claimedRef.current, p.id, allyIdsRef.current) : null
    visibleSetRef.current = visibleSet
    armyVisibleSetRef.current = p ? buildVisibleSet(claimedRef.current, p.id, allyIdsRef.current, ARMY_VISION_RINGS) : null
    map.current.getSource('claimed').setData(buildClaimedGeoJSON(claimedRef.current, visibleSet))

    // Same requiredGarrisonForHexCount formula as config.js - mirrors
    // BottomDrawer's decay-risk card, but for every owned hex at a glance.
    let requiredGarrison = 0
    if (p) {
      const myHexCount = Object.values(claimedRef.current).filter(h => h.owner_id === p.id).length
      const { decay_hex_threshold, decay_scale_hexes_per_step } = decayConfigRef.current
      if (myHexCount > decay_hex_threshold) {
        requiredGarrison = 1 + Math.floor((myHexCount - decay_hex_threshold) / decay_scale_hexes_per_step)
      }
    }
    map.current.getSource('claimed-points')?.setData(buildClaimedPoints(claimedRef.current, visibleSet, p?.id, requiredGarrison))
    map.current.getSource('building-pips')?.setData(buildPipFeatures(claimedRef.current))
    if (map.current.getSource('capitals')) {
      ensureFlagImages(map.current, claimedRef.current)
      map.current.getSource('capitals').setData(buildCapitalFeatures(claimedRef.current))
    }
    updateOverview()
  }, [updateOverview])

  // claimedRef is intentionally kept outside React state - claimed-hex data
  // changes far too often (every tick, every capture) to put it in state
  // without re-rendering the whole map on each update. Reading it here during
  // render is safe in practice: these values are re-derived on every render,
  // and the socket/tick handlers that mutate claimedRef also trigger a
  // re-render of this component via other state (armies, stats, etc.).
  const ownedHexCount = Object.values(claimedRef.current).filter(h => h.owner_id === player?.id).length
  const totalTroops = Object.values(claimedRef.current).filter(h => h.owner_id === player?.id).reduce((s, h) => s + (h.troop_count || 0), 0)

  const { display: resources } = useResourceTicker(player)
  const isMobile = useIsMobile()

  const mergeClaimed = useCallback(() => {
    // myHexesRef last so it wins on overlap - it's the more authoritative of
    // the two for any hex that happens to be both mine and on screen.
    claimedRef.current = { ...viewportHexesRef.current, ...myHexesRef.current }
    updateHexes()
    updateClaimed()
  }, [updateHexes, updateClaimed])

  const loadMyHexes = useCallback(async () => {
    try {
      const hexes = await api.getMyHexes()
      const byIndex = {}
      hexes.forEach(h => { byIndex[h.h3_index] = h })
      myHexesRef.current = byIndex
      mergeClaimed()
    } catch { /* map not ready yet, or a transient fetch failure - next tick retries */ }
  }, [mergeClaimed])

  const loadViewportHexes = useCallback(async () => {
    if (!map.current) return
    const cells = getViewportHexes(map.current, hexResolutionRef.current)
    if (cells.length === 0) return // zoomed out past individual-hex range - overview layer handles this instead
    try {
      const hexes = await api.getHexesViewport(cells)
      const byIndex = {}
      hexes.forEach(h => { byIndex[h.h3_index] = h })
      viewportHexesRef.current = byIndex
      mergeClaimed()
    } catch { /* transient fetch failure - next pan/zoom or hexes:update retries */ }
  }, [mergeClaimed])

  const loadOverviewSummary = useCallback(async () => {
    if (!map.current) return
    const { cells, res } = getOverviewHexes(map.current, hexResolutionRef.current)
    if (cells.length === 0) return // zoomed in past overview range - viewport layer handles this instead
    try {
      overviewSummaryRef.current = await api.getHexOverview(res)
      updateOverview()
    } catch { /* transient fetch failure - next pan/zoom or hexes:update retries */ }
  }, [updateOverview])

  // Kept as one combined call so every existing call site (claim, build,
  // rally, battle resolution, etc.) that used to mean "the hex I just
  // touched changed, refresh" still does the right thing unchanged - it's
  // always either my own hex or one I'm currently looking at.
  const loadClaimed = useCallback(async () => {
    await Promise.all([loadMyHexes(), loadViewportHexes()])
  }, [loadMyHexes, loadViewportHexes])

  const strategicRef = useRef({})
  const zonesRef = useRef(new Map()) // h3 → city name, for click enrichment
  const zoneBonusRef = useRef(2)     // server's ZONE_BONUS_PER_HEX, for click enrichment

  useEffect(() => {
    api.getConfig().then(cfg => {
      decayConfigRef.current = {
        decay_hex_threshold: cfg.decay_hex_threshold ?? 30,
        decay_scale_hexes_per_step: cfg.decay_scale_hexes_per_step ?? 10,
        min_troops_to_claim: cfg.min_troops_to_claim ?? 5,
        troop_gold_cost: cfg.troop_gold_cost ?? 10,
      }
    }).catch(() => {})
  }, [])

  // Entrenchment count for the defense-breakdown card in BottomDrawer - reads
  // the same claimedRef map already loaded for map rendering, so no extra
  // network round-trip is needed just to look at a hex.
  const getFriendlyNeighborCount = useCallback((h3, ownerId) => {
    if (!ownerId) return 0
    return gridDisk(h3, 1).filter(n => n !== h3 && claimedRef.current[n]?.owner_id === ownerId).length
  }, [])

  // Shared enrichment for hex selection - adds city-zone + strategic-hex info
  // on top of base hex props, whether the hex came from a map click or a
  // programmatic jump (Armies HUD rows).
  const enrichHex = useCallback((h3, baseProps) => {
    const strategic = strategicRef.current[h3]
    return {
      ...baseProps,
      zone_city: zonesRef.current.get(h3) || null,
      zone_bonus: zoneBonusRef.current,
      ...(strategic ? {
        strategic_name: strategic.name,
        strategic_bonus: strategic.bonus_gold,
        strategic_primary: strategic.primary,
      } : {}),
    }
  }, [])

  // Programmatic hex selection (Armies HUD rows) - same shape + enrichment as
  // a map click on hex-fill, so the drawer opens ready to march from there.
  const selectHexByIndex = useCallback((h3) => {
    const props = hexToGeoJSONFeature(h3, claimedRef.current[h3], null).properties
    setSelectedHex(enrichHex(h3, props))
    map.current?.setFilter('hex-selected', ['==', ['get', 'h3'], h3])
  }, [enrichHex])
  const [zoneBonus, setZoneBonus] = useState(2) // same value, for the legend re-render
  const zoneCirclesRef = useRef([])  // one [lat,lng,radiusDeg] per city, for viewport checks
  const zoneSeenRef = useRef(false)  // legend already shown for the zones currently in view
  const zoneLegendTimer = useRef(null)
  const [zoneLegendVisible, setZoneLegendVisible] = useState(false)
  const [capitalInView, setCapitalInView] = useState(true)
  const wondersRef = useRef([])      // latest /world/wonders payload, for the chronicle card
  const [wonderCard, setWonderCard] = useState(null) // wonder object, or null

  // Escape backs out of transient modes: march/rally targeting, wonder card
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      setWonderCard(null)
      if (marchModeRef.current || rallyModeRef.current) {
        setMarchMode(null)
        setRallyMode(null)
        if (map.current) map.current.getCanvas().style.cursor = ''
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Show the zone legend only while a city zone is on screen (fades after a
  // few seconds); track whether the capital is visible for the Home button.
  const checkViewport = useCallback(() => {
    if (!map.current) return
    const bounds = map.current.getBounds()
    const z = map.current.getZoom()
    const w = bounds.getWest(), e = bounds.getEast(), s = bounds.getSouth(), n = bounds.getNorth()
    const zoneIn = z >= 5 && zoneCirclesRef.current.some(([lat, lng, r]) =>
      lat + r > s && lat - r < n && lng + r > w && lng - r < e)
    if (zoneIn && !zoneSeenRef.current) {
      zoneSeenRef.current = true
      setZoneLegendVisible(true)
      clearTimeout(zoneLegendTimer.current)
      zoneLegendTimer.current = setTimeout(() => setZoneLegendVisible(false), 6000)
    } else if (!zoneIn) {
      zoneSeenRef.current = false
      setZoneLegendVisible(false)
    }
    const cap = playerRef.current?.capital_hex
    if (cap) {
      const [lat, lng] = cellToLatLng(cap)
      setCapitalInView(bounds.contains([lng, lat]))
    } else {
      setCapitalInView(true)
    }
  }, [])

  const loadStrategic = useCallback(async () => {
    if (!map.current?.getSource('strategic')) return
    try {
      const hexes = await api.getStrategicHexes()
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
    } catch { /* strategic hexes are static, best-effort */ }
  }, [])

  // Wonders + monuments - refreshed on wonder seizure and season rollover
  const loadLandmarks = useCallback(async () => {
    if (!map.current?.getSource('wonders')) return
    try {
      const [wonders, monuments] = await Promise.all([api.getWonders(), api.getMonuments()])
      wondersRef.current = wonders // full payload (holder + history) for the chronicle card
      map.current.getSource('wonders').setData({
        type: 'FeatureCollection',
        features: wonders.map(w => ({
          type: 'Feature',
          properties: { id: w.id, name: w.name, ...(w.holder ? { holder: w.holder.username } : {}) },
          geometry: { type: 'Point', coordinates: [w.lng, w.lat] },
        })),
      })
      map.current.getSource('monuments').setData({
        type: 'FeatureCollection',
        features: monuments.map(m => {
          const [lat, lng] = cellToLatLng(m.h3_index)
          return {
            type: 'Feature',
            properties: { username: m.username, season: m.season_number },
            geometry: { type: 'Point', coordinates: [lng, lat] },
          }
        }),
      })
    } catch { /* cosmetic layer, best-effort */ }
  }, [])

  // City zones are static - fetch once and shade them
  const loadZones = useCallback(async () => {
    if (!map.current?.getSource('zones')) return
    try {
      const { bonus, hexes: zones } = await api.getZones()
      zoneBonusRef.current = bonus
      setZoneBonus(bonus)
      zonesRef.current = new Map(zones.map(z => [z.h3, z.city]))
      // Collapse each city's ring of hexes to a bounding circle
      const byCity = new Map()
      for (const z of zones) {
        const c = cellToLatLng(z.h3)
        if (!byCity.has(z.city)) byCity.set(z.city, [])
        byCity.get(z.city).push(c)
      }
      zoneCirclesRef.current = [...byCity.values()].map(pts => {
        const lat = pts.reduce((s, p) => s + p[0], 0) / pts.length
        const lng = pts.reduce((s, p) => s + p[1], 0) / pts.length
        const r = Math.max(...pts.map(([la, ln]) => Math.max(Math.abs(la - lat), Math.abs(ln - lng))))
        return [lat, lng, r]
      })
      checkViewport()
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
  }, [checkViewport])

  const loadArmies = useCallback(async () => {
    try { setArmies(await api.getArmies()) } catch { /* keep showing last-known armies on a transient failure */ }
  }, [])

  // player?.id (not the whole player object) - the body only checks
  // truthiness, so this only needs to be stable across login/logout, not
  // re-identify on every refreshed player snapshot (api.me() always returns
  // a fresh object even when nothing actually changed, which was making this
  // - and the mount effect below that depends on it - refire on every single
  // player-data refresh instead of only when it actually mattered).
  const loadPendingClaims = useCallback(async () => {
    try { setPendingClaims(player ? await api.getPendingClaims() : []) } catch { /* keep showing last-known pending claims */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player?.id])

  const loadActiveBattles = useCallback(async () => {
    try { setActiveBattles(await api.getActiveBattles()) } catch { /* keep showing last-known battles */ }
  }, [])

  const loadStats = useCallback(async () => {
    try { setStats(await api.getStats()) } catch { /* keep showing last-known stats */ }
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
        // A resolution change only ever takes effect on a brand-new season
        // (which already wipes all hex data server-side). Rebuilding this
        // client's hex grid, viewport caches, and MapLibre sources in place
        // for a new resolution mid-session is a lot riskier than just
        // reloading fresh - so do that instead of trying to patch it live.
        if (s.hex_resolution != null && s.hex_resolution !== hexResolutionRef.current) {
          localStorage.setItem('rw_season', String(s.number))
          window.location.reload()
          return
        }
        const hist = await api.getSeasonHistory()
        setSeasonHistory(hist)
        const prev = hist.find(h => h.number === s.number - 1) || hist[0]
        if (prev) setEndedSeason(prev)
        if (playerRef.current) api.me().then(p => onPlayerUpdate?.(p)).catch(() => {})
      }
      hexResolutionRef.current = s.hex_resolution ?? HEX_RESOLUTION
      localStorage.setItem('rw_season', String(s.number))
    } catch { /* no active season */ }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadClaimed(); loadOverviewSummary() }, [loadClaimed, loadOverviewSummary])
  useEffect(() => { loadArmies() }, [loadArmies])
  useEffect(() => { loadPendingClaims() }, [loadPendingClaims])

  useEffect(() => {
    if (!map.current?.getSource('pending-claims')) return
    const needed = decayConfigRef.current.min_troops_to_claim
    const features = pendingClaims.map(({ h3_index, quantity }) => {
      try {
        const [lat, lng] = cellToLatLng(h3_index)
        return { type: 'Feature', properties: { quantity, needed }, geometry: { type: 'Point', coordinates: [lng, lat] } }
      } catch { return null }
    }).filter(Boolean)
    map.current.getSource('pending-claims').setData({ type: 'FeatureCollection', features })
  }, [pendingClaims])
  useEffect(() => { loadActiveBattles() }, [loadActiveBattles])
  useEffect(() => { if (player?.id) loadStats() }, [player?.id, loadStats])
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

  // hexes:update/armies:update fire very often during active bot combat -
  // loadClaimed() alone pulls every claimed hex on the map (2MB+ and
  // growing as the season goes on), so refetching on every single event
  // with bots numerous meant repeatedly downloading/parsing that on every
  // client, constantly. Debounce so a burst of activity collapses into one
  // fetch, same pattern already used in LeaderboardPanel for the same reason.
  const hexesDebounceRef = useRef(null)
  const armiesDebounceRef = useRef(null)

  // Socket-driven updates - replace polling intervals
  useSocket({
    'hexes:update': () => {
      clearTimeout(hexesDebounceRef.current)
      hexesDebounceRef.current = setTimeout(() => { loadClaimed(); loadOverviewSummary(); loadStrategic(); loadPendingClaims() }, 800)
    },
    'armies:update': () => {
      clearTimeout(armiesDebounceRef.current)
      armiesDebounceRef.current = setTimeout(() => { loadArmies(); loadPendingClaims() }, 800)
    },
    // battle:update is global - it fires for every battle anywhere, not just
    // yours (BattlePanel needs that for whatever hex is currently selected).
    // It used to also refetch this player's own data on every single one of
    // those, which with bots numerous meant constant api.me() calls and a
    // fresh player object on nearly every battle in the game - and since
    // that object is a dependency of other effects (loadPendingClaims, etc.),
    // each one cascaded into its own refetch too. events:new is now scoped to
    // just this player's own events (see server/socket.js), so that's the
    // correct trigger for "something changed for me, refresh my data".
    'battle:update': () => { loadActiveBattles() },
    'events:new': () => { api.me().then(p => onPlayerUpdate?.(p)).catch(() => {}) },
    'tick': () => { loadStats(); api.me().then(p => onPlayerUpdate?.(p)).catch(() => {}) },
    'season:update': () => { loadSeason(); loadLandmarks() },
    'wonder:update': loadLandmarks,
  })

  useEffect(() => {
    dismissedBattleRef.current = null
    if (!selectedHex?.h3) { setActiveBattle(null); return }
    async function checkBattle() {
      try {
        const result = await api.getBattle(selectedHex.h3)
        const newBattle = result.battle || null
        setActiveBattle(prev => {
          if (prev && !newBattle) loadClaimed() // battle just resolved - refresh map immediately
          // The server keeps a concluded battle visible for a 20s results
          // window - without this check, the next poll would silently pop
          // the panel back open right after the player closed it.
          if (newBattle && newBattle.id === dismissedBattleRef.current) return null
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
    if (import.meta.env.DEV) window.__map = map.current

    // MapLibre sizes its canvas from the container's dimensions at construction
    // time and never re-checks on its own. Mobile browsers (esp. iOS Safari)
    // often haven't settled their real viewport width/toolbar state at that
    // exact moment, so the canvas can get stuck rendering at a stale, too-narrow
    // size even though the container itself is the correct full width - a
    // ResizeObserver catches that (and any later layout change) and tells the
    // map to re-measure.
    const resizeObserver = new ResizeObserver(() => map.current?.resize())
    resizeObserver.observe(mapContainer.current)

    map.current.on('load', () => {
      // Sprites for garrison + building badges
      addSvgImage(map.current, 'garrison-icon', GARRISON_SVG)
      for (const [id, svg] of Object.entries(WONDER_SPRITES)) addSvgImage(map.current, `wonder-${id}`, svg)
      addSvgImage(map.current, 'monument-icon', MONUMENT_SVG)
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
          // Decay warning rides along in the same text field (not a separate
          // layer) so it always sits directly next to the number regardless
          // of how many digits the troop count has - no offset-guessing.
          'text-field': ['case',
            ['==', ['get', 'troop_count'], -1], '?',
            ['>', ['get', 'troop_count'], 0], ['format',
              ['to-string', ['get', 'troop_count']], {},
              ['case', ['boolean', ['get', 'decay_risk'], false], '  ⚠', ''], { 'text-color': '#e0a030' },
            ],
            ''
          ],
          'text-font': ['Noto Sans Regular'],
          'text-size': 15,
          // Garrison size is critical info (esp. on strategic hexes, which
          // also render a centered zone-name label at the same spot) - it
          // must never lose the collision and just silently disappear.
          'icon-allow-overlap': true,
          'text-allow-overlap': true,
          'text-anchor': 'left',
          'text-offset': [0.15, 1.0],
        },
        paint: {
          'text-color': 'rgba(255,255,255,0.95)',
          'text-halo-color': 'rgba(0,0,0,0.8)',
          'text-halo-width': 2,
        },
      })

      // Your own troops sitting on a hex you don't own yet (mid-claim, waiting
      // on MIN_TROOPS_TO_CLAIM) - without this, those troops are real in the
      // DB but invisible on the map, reading as "my troops disappeared."
      map.current.addSource('pending-claims', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      map.current.addLayer({
        id: 'pending-claim-labels',
        type: 'symbol',
        source: 'pending-claims',
        minzoom: 7,
        layout: {
          'text-field': ['concat', ['to-string', ['get', 'quantity']], '/', ['to-string', ['get', 'needed']]],
          'text-font': ['Noto Sans Regular'],
          'text-size': 13,
          'text-allow-overlap': true,
        },
        paint: {
          'text-color': '#c9a04a',
          'text-halo-color': 'rgba(0,0,0,0.85)',
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

      // World Wonders + Champion's Monuments - the dangling carrots. Always
      // visible so every player (and every guest) sees what can be won.
      map.current.addSource('wonders', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.current.addLayer({
        id: 'wonder-icons',
        type: 'symbol',
        source: 'wonders',
        layout: {
          // Per-landmark sprite, falling back to the generic temple for any
          // wonder id the client doesn't have a glyph for yet
          'icon-image': ['coalesce',
            ['image', ['concat', 'wonder-', ['get', 'id']]],
            ['image', 'wonder-generic']],
          'icon-size': ['interpolate', ['linear'], ['zoom'], 2, 0.5, 8, 0.9],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'text-field': ['case', ['has', 'holder'],
            ['concat', ['get', 'name'], '\nheld by ', ['get', 'holder']],
            ['get', 'name']],
          'text-font': ['Noto Sans Regular'],
          'text-size': 11,
          'text-anchor': 'top',
          'text-offset': [0, 1.2],
          'text-optional': true,
        },
        paint: {
          'text-color': '#e8c55a',
          'text-halo-color': 'rgba(0,0,0,0.85)',
          'text-halo-width': 1.6,
        },
      })
      map.current.addSource('monuments', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.current.addLayer({
        id: 'monument-icons',
        type: 'symbol',
        source: 'monuments',
        layout: {
          'icon-image': 'monument-icon',
          'icon-size': ['interpolate', ['linear'], ['zoom'], 2, 0.45, 8, 0.85],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'text-field': ['concat', ['get', 'username'], '\nChampion of Age ', ['to-string', ['get', 'season']]],
          'text-font': ['Noto Sans Regular'],
          'text-size': 11,
          'text-anchor': 'top',
          'text-offset': [0, 1.2],
          'text-optional': true,
        },
        paint: {
          'text-color': '#cdb2ee',
          'text-halo-color': 'rgba(0,0,0,0.85)',
          'text-halo-width': 1.6,
        },
      })

      // Capital flags - pixel-art banners, one per player, only worth
      // rendering once you're zoomed in enough to actually see them
      map.current.addSource('capitals', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.current.addLayer({
        id: 'capital-flags',
        type: 'symbol',
        source: 'capitals',
        minzoom: 12,
        layout: {
          'icon-image': ['image', ['get', 'iconId']],
          // A res-7 hex is ~2.4km across; a real-world Mercator pixel scale
          // doubles every zoom level, so an exponential-base-2 stop pair (not
          // linear) is what actually keeps the flag pinned to ~half the
          // hex's on-screen width at every zoom, not just at two endpoints -
          // the old linear curve held its top value constant past zoom 10,
          // so flags stopped growing while the hex kept getting bigger *and*
          // stayed a flat pixel size well below zoom 10, dwarfing tiny hexes.
          'icon-size': ['interpolate', ['exponential', 2], ['zoom'], 12, 0.5, 16, 8],
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
      const armySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${40 * DPR}" height="${40 * DPR}" viewBox="0 0 16 16">
        <g stroke="rgba(0,0,0,0.65)" stroke-width="3" stroke-linecap="round" fill="none">
          <path d="M3 2.5l9 9M13 2.5l-9 9"/><path d="M10.6 11.4l-1.4 1.4M5.4 11.4l1.4 1.4"/>
        </g>
        <g stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" fill="none">
          <path d="M3 2.5l9 9M13 2.5l-9 9"/><path d="M10.6 11.4l-1.4 1.4M5.4 11.4l1.4 1.4"/>
        </g>
      </svg>`
      const armyImg = new Image()
      armyImg.onload = () => {
        if (!map.current || map.current.hasImage?.('army-icon')) return
        map.current.addImage('army-icon', armyImg, { pixelRatio: DPR })
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
      // Inserted before hex-troop-labels so this fill/border sits underneath
      // the garrison count instead of hazing over it (both target the same
      // strategic hexes).
      map.current.addLayer({
        id: 'strategic-fill',
        type: 'fill',
        source: 'strategic',
        paint: {
          'fill-color': ['case', ['!=', ['get', 'owner_color'], null], ['get', 'owner_color'], '#c9902a'],
          'fill-opacity': ['case', ['!=', ['get', 'owner_color'], null], 0.55, 0.25],
        },
      }, 'hex-troop-labels')
      map.current.addLayer({
        id: 'strategic-border',
        type: 'line',
        source: 'strategic',
        paint: { 'line-color': '#f0c040', 'line-width': 1.5, 'line-opacity': 0.9 },
      }, 'hex-troop-labels')
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
          // Nudged up off-center so it clears the garrison count label
          // (hex-troop-labels), which sits lower/right at the same hex.
          'text-offset': [0, -1.4],
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
      loadLandmarks()
      // armies state may already be loaded - force a sync
      map.current.once('idle', () => {
        setArmies(prev => [...prev])
      })

      // New player with no capital - zoom to Europe at a playable level
      if (!playerRef.current?.capital_hex) {
        map.current.flyTo({ center: [10, 48], zoom: 8, speed: 0.6 })
      }
    })

    // Re-render immediately from whatever's already cached (instant, even if
    // stale/incomplete for a newly-panned-to area), then fetch fresh data for
    // the new viewport - panning to a claimed hex we've never loaded a value
    // for should be blank rather than wrong, not silently show nothing until
    // the next hexes:update happens to come along.
    map.current.on('moveend', () => { updateHexes(); updateOverview(); checkViewport(); loadViewportHexes(); loadOverviewSummary() })
    map.current.on('zoomend', () => { updateHexes(); updateOverview(); checkViewport(); loadViewportHexes(); loadOverviewSummary() })
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
        setSelectedHex(enrichHex(hex.h3, hex))
        map.current.setFilter('hex-selected', ['==', ['get', 'h3'], hex.h3])
        return null
      })
    })

    map.current.on('mouseenter', 'hex-fill', () => {
      map.current.getCanvas().style.cursor = (marchModeRef.current || rallyModeRef.current) ? 'crosshair' : 'pointer'
    })
    map.current.on('mouseleave', 'hex-fill', () => { map.current.getCanvas().style.cursor = '' })

    map.current.on('click', 'overview-hex-fill', (e) => {
      const center = e.lngLat
      map.current.flyTo({ center: [center.lng, center.lat], zoom: 7, speed: 0.8 })
    })

    // Clicking a wonder opens its chronicle (unless mid-march/rally, where the
    // click must stay a destination pick for the hex underneath)
    map.current.on('click', 'wonder-icons', (e) => {
      if (marchModeRef.current || rallyModeRef.current) return
      const id = e.features[0]?.properties?.id
      const w = wondersRef.current.find(x => x.id === id)
      if (w) setWonderCard(w)
    })
    map.current.on('mouseenter', 'wonder-icons', () => {
      if (!marchModeRef.current && !rallyModeRef.current) map.current.getCanvas().style.cursor = 'pointer'
    })
    map.current.on('mouseleave', 'wonder-icons', () => {
      if (!marchModeRef.current && !rallyModeRef.current) map.current.getCanvas().style.cursor = ''
    })

    return () => {
      resizeObserver.disconnect()
      Object.values(battleMarkersRef.current).forEach(m => m.remove())
      battleMarkersRef.current = {}
      map.current?.remove()
      map.current = null
    }
    // All of these are useCallback-memoized on refs/[] only, so they're stable
    // across renders - listing them here doesn't cause the map to reinitialize.
  }, [checkViewport, enrichHex, loadClaimed, loadLandmarks, loadOverviewSummary, loadStrategic, loadViewportHexes, loadZones, updateClaimed, updateHexes, updateOverview])

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
      let lat, lng
      try {
        ;[lat, lng] = cellToLatLng(battle.h3_index)
      } catch (err) {
        console.warn('[battle-ring] cellToLatLng failed for', battle.h3_index, err)
        continue
      }
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        console.warn('[battle-ring] non-finite lat/lng for', battle.h3_index, { lat, lng })
        continue
      }
      // MapLibre positions the marker's root element itself by writing an
      // inline `transform: translate(...)` to it every frame. A CSS animation
      // on that same element that also animates `transform` (like the
      // battle-ring pulse) overrides that inline value completely, so the
      // marker renders at its unpositioned default (top-left of the map
      // container) instead of tracking the hex. Keep the outer element plain
      // and put the pulsing animation on an inner child instead - same
      // pattern as the army-threat-marker/army-threat-ring pair above.
      const el = document.createElement('div')
      el.className = 'battle-ring-anchor'
      const ring = document.createElement('div')
      ring.className = 'battle-ring'
      ring.innerHTML = `<svg viewBox="0 0 16 16" style="position:absolute;top:50%;left:50%;width:24px;height:24px;transform:translate(-50%,-50%)"><g stroke="#ff5050" stroke-width="1.6" stroke-linecap="round" fill="none"><path d="M3 2.5l9 9M13 2.5l-9 9"/><path d="M10.6 11.4l-1.4 1.4M5.4 11.4l1.4 1.4"/></g></svg>`
      el.appendChild(ring)
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

    // Fog of war for marching armies: your own + allied armies are always
    // visible, huge forces can't hide (server-computed `projected`), and
    // everything else only shows up if it's marching to/from near your
    // territory (a wider ring than hex fog - see ARMY_VISION_RINGS).
    function isArmyVisible(a, currentPlayer) {
      if (!currentPlayer) return a.projected
      if (a.owner_id === currentPlayer.id) return true
      if (allyIdsRef.current?.has(a.owner_id)) return true
      if (a.projected) return true
      const vs = armyVisibleSetRef.current
      return !!vs && (vs.has(a.from_hex) || vs.has(a.to_hex))
    }

    function updateArmyPositions() {
      if (!map.current?.getSource('armies')) return
      const currentPlayer = playerRef.current
      const currentClaimed = claimedRef.current
      const activeIds = new Set()

      const features = armiesRef.current.filter(a => isArmyVisible(a, currentPlayer)).map(a => {
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
        const pathFeatures = armiesRef.current.filter(a => isArmyVisible(a, currentPlayer)).map(a => {
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
        const destFeatures = armiesRef.current.filter(a => isArmyVisible(a, currentPlayer)).map(a => {
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
      try { map.current.setPaintProperty('march-dest-ring', 'circle-stroke-opacity', opacity) } catch { /* layer mid-update */ }
    }, 50)

    return () => { clearInterval(interval); clearInterval(pulseInterval) }
  }, [armies])

  async function handleClaim(h3Index) {
    if (!player) return
    try {
      const result = await api.claimHex(h3Index)
      playSound('capture')
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

  async function handleSetCapital(h3Index) {
    if (!player) return
    try {
      await api.setCapital(h3Index)
      playSound('capture')
      onPlayerUpdate?.({ capital_hex: h3Index })
      toast('Capital founded here!', 'success')
      await loadClaimed()
      updateClaimed()
    } catch (err) {
      toast(err.message)
    }
  }

  // Spends available gold on a random handful of owned hexes instead of
  // requiring a manual per-hex trip to the Military tab - a QoL shortcut,
  // not a new training rule, so it just calls the same /military/train
  // endpoint the Military tab uses, repeatedly.
  async function handleAutoTrain() {
    if (!player) return
    const owned = Object.values(claimedRef.current).filter(h => h.owner_id === player.id)
    if (owned.length === 0) { toast('Claim a hex first.'); return }

    const goldPerTroop = decayConfigRef.current.troop_gold_cost || 10
    let budget = player.gold
    if (budget < goldPerTroop) { toast(`Need at least ${goldPerTroop}g to train.`); return }

    const shuffled = [...owned].sort(() => Math.random() - 0.5)
    const maxHexes = Math.max(1, Math.ceil(owned.length / 2))
    const targets = shuffled.slice(0, 1 + Math.floor(Math.random() * maxHexes))

    let trainedTotal = 0
    let hexesUsed = 0
    for (let i = 0; i < targets.length; i++) {
      const maxAffordable = Math.floor(budget / goldPerTroop)
      if (maxAffordable < 1) break
      const isLast = i === targets.length - 1
      const qty = isLast ? maxAffordable : Math.max(1, Math.floor(maxAffordable * (0.2 + Math.random() * 0.5)))
      try {
        const r = await api.trainTroops(targets[i].h3_index, 'troop', qty)
        budget = r.player.gold
        trainedTotal += qty
        hexesUsed++
      } catch (err) {
        toast(err.message)
        break
      }
    }

    if (trainedTotal > 0) {
      onPlayerUpdate?.({ gold: budget })
      toast(`Queued ${trainedTotal} troop${trainedTotal !== 1 ? 's' : ''} across ${hexesUsed} hex${hexesUsed !== 1 ? 'es' : ''}.`, 'success')
    } else {
      toast('Not enough gold to train anywhere.')
    }
  }

  const [searchQuery, setSearchQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)

  async function handleSearch(e) {
    e.preventDefault()
    const q = searchQuery.trim()
    if (!q) return
    // Direct H3 index (15 hex chars starting with 8) - a specific hex, so
    // zoom all the way in on it (same level as jumping to a hex from Armies).
    if (/^8[0-9a-f]{14}$/i.test(q)) {
      try {
        const [lat, lng] = cellToLatLng(q)
        map.current?.flyTo({ center: [lng, lat], zoom: 12 })
        setSearchOpen(false)
        setSearchQuery('')
      } catch { toast('Invalid hex index') }
      return
    }
    // Short hex tag (the #XXXXXX shown when you click a claimed hex) - only
    // ever shown for claimed hexes. Looked up server-side (not just among
    // locally-loaded hexes) since the client no longer has the whole world's
    // claim data cached - see /hexes/search. Falls through to geocoding
    // below if nothing matches, rather than erroring outright, since a short
    // hex-looking string could coincidentally also be a place.
    if (/^[0-9a-f]{3,9}$/i.test(q)) {
      try {
        const result = await api.searchHexCode(q)
        if (result?.h3Index) {
          const [lat, lng] = cellToLatLng(result.h3Index)
          map.current?.flyTo({ center: [lng, lat], zoom: 12 })
          setSearchOpen(false)
          setSearchQuery('')
          return
        }
      } catch { /* fall through to geocoding below */ }
    }
    // Geocode with Nominatim - a place name, not a specific hex, so a wider
    // zoom stays appropriate (zooming to hex-level on "France" would be wrong).
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
    <div style={{ position: 'relative', width: '100vw', height: '100dvh' }}>
      <div ref={mapContainer} style={{ position: 'absolute', inset: 0 }} />

      {activeBattles.length > 0 && (
        <BattleParticles battles={activeBattles} mapRef={map} />
      )}

      {/* ── Top bar ────────────────────────────────────────────── */}
      <div className="rw-topbar-scroll" style={{
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
              {stats && !isMobile && <GoldIncomeTooltip hexCount={stats.hex_count || 0} mines={stats.mines || 0} incomeByCountry={stats.income_by_country} wonderIncome={stats.wonder_income || 0} total={stats.income_per_harvest} />}
            </div>
            {stats?.next_tick_at && <HarvestCountdown nextTickAt={stats.next_tick_at} onExpire={loadStats} compact={isMobile} />}
            {!isMobile && <span style={{ fontSize: 13, color: '#7a6890' }}>⬢ {stats?.hex_count ?? ownedHexCount}</span>}
            {!isMobile && totalTroops > 0 && <span style={{ fontSize: 13, color: '#7a6890' }}><SwordsIcon size={12} color="#7a6890" /> {totalTroops}</span>}
            {!isMobile && import.meta.env.DEV && (
              <button
                onClick={async () => { try { const r = await api.devRefill(); onPlayerUpdate?.({ ...player, gold: r.gold }) } catch { /* dev-only convenience button */ } }}
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
          onAutoTrain={handleAutoTrain}
          onFlyTo={(h3) => {
            try {
              const [lat, lng] = cellToLatLng(h3)
              map.current?.flyTo({ center: [lng, lat], zoom: 12, speed: 1.5 })
              selectHexByIndex(h3)
            } catch { /* bad/foreign h3 index - just skip the fly-to */ }
          }}
        />
      )}

      {/* ── Leaderboard ─────────────────────────────────────────── */}
      <LeaderboardPanel
        player={player}
        onFlyTo={(lng, lat) => map.current?.flyTo({ center: [lng, lat], zoom: 9, speed: 1.5 })}
      />

      {/* ── City-zone legend - only while a zone is on screen, then fades ── */}
      {zoom >= 5 && (
        <div style={{
          // chat bubble (ChatPanel) occupies bottom-left 16px when enabled
          position: 'absolute', bottom: 16, left: player && CHAT_ON ? 74 : 16, pointerEvents: 'none',
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'rgba(20,15,40,0.82)', border: '1px solid rgba(224,184,74,0.35)',
          borderRadius: 6, padding: '6px 11px',
          fontFamily: 'Georgia, serif', fontSize: 12, color: '#cdb98a', letterSpacing: 0.5,
          opacity: zoneLegendVisible ? 1 : 0, transition: 'opacity 1.2s ease',
        }}>
          <span style={{ width: 13, height: 13, borderRadius: 3, background: 'rgba(224,184,74,0.35)', border: '1px solid rgba(224,184,74,0.7)' }} />
          City zone — <span style={{ color: '#e0b84a' }}>+{zoneBonus}g</span> per hex you hold
        </div>
      )}

      {/* ── Guest call-to-action - the map is the pitch, this is the close ── */}
      {!player && (
        <button
          onClick={() => onLoginRequired('register')}
          style={{
            position: 'absolute', bottom: isMobile ? 20 : 30, left: '50%', transform: 'translateX(-50%)',
            zIndex: 6, display: 'flex', alignItems: 'center', gap: 9,
            padding: isMobile ? '12px 20px' : '14px 28px',
            background: 'linear-gradient(180deg, #e8c55a, #c9902a)',
            border: '1px solid rgba(255,230,160,0.7)', borderRadius: 28,
            color: '#1a1028', cursor: 'pointer', whiteSpace: 'nowrap',
            fontFamily: 'Georgia, serif', fontSize: isMobile ? 13 : 15,
            letterSpacing: isMobile ? 1.5 : 2.5, fontWeight: 'bold',
            animation: 'cta-glow 2.6s ease-in-out infinite',
          }}>
          <SwordsIcon size={isMobile ? 14 : 16} color="#1a1028" /> CLAIM YOUR FIRST TERRITORY
        </button>
      )}

      {/* ── Home - floating, shown whenever your capital is off screen. Floats
          above the drawer/battle panel instead of hiding behind it, since
          most play happens with a hex selected - hiding it there meant it
          almost never showed when it was actually needed. ── */}
      {player?.capital_hex && !capitalInView && (
        <button
          title="Return to your capital"
          onClick={() => {
            const [lat, lng] = cellToLatLng(player.capital_hex)
            window.dispatchEvent(new CustomEvent('rw:flyto', { detail: { lat, lng, zoom: 8.8 } }))
          }}
          style={{
            position: 'absolute',
            bottom: (selectedHex || activeBattle) ? (isMobile ? 'calc(48dvh + 76px)' : 'calc(36vh + 76px)') : 24,
            right: 16, zIndex: 5,
            display: 'flex', alignItems: 'center', gap: 7, padding: '10px 16px',
            background: 'rgba(20,15,40,0.92)', border: '1px solid rgba(224,184,74,0.55)',
            borderRadius: 22, color: '#e0c070', cursor: 'pointer',
            fontFamily: 'Georgia, serif', fontSize: 13, letterSpacing: 2,
            boxShadow: '0 2px 14px rgba(0,0,0,0.5)',
            transition: 'bottom 0.2s ease',
          }}>
          <KeepIcon size={15} color="#e0c070" /> HOME
        </button>
      )}

      {/* ── Wonder chronicle - who holds it and every keeper before ── */}
      {wonderCard && (
        <div style={{
          position: 'absolute', top: 56, left: '50%', transform: 'translateX(-50%)',
          width: isMobile ? 'calc(100vw - 24px)' : 340, maxHeight: '55vh', overflowY: 'auto',
          background: 'rgba(15,10,28,0.96)', border: '1px solid rgba(224,184,74,0.5)',
          borderRadius: 8, padding: '14px 16px', zIndex: 25,
          fontFamily: 'Georgia, serif', color: '#c4b498',
          boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ fontSize: 15, color: '#e8c55a', letterSpacing: 1 }}>{wonderCard.name}</span>
            <button onClick={() => setWonderCard(null)} style={{ background: 'none', border: 'none', color: '#7a6890', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '0 2px' }}>×</button>
          </div>
          <div style={{ fontSize: 12, color: '#8a7a9c', marginTop: 2, fontStyle: 'italic' }}>{wonderCard.title}</div>
          {wonderCard.income > 0 && (
            <div style={{ fontSize: 12, color: '#c9902a', marginTop: 4 }}>
              Grants +{wonderCard.income}g each harvest to its keeper
            </div>
          )}

          <div style={{ marginTop: 10, fontSize: 13 }}>
            {wonderCard.holder ? (
              <span>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: wonderCard.holder.color || '#888', display: 'inline-block', marginRight: 6 }} />
                Held by <span style={{ color: '#e8c55a' }}>{wonderCard.holder.username}</span>
              </span>
            ) : (
              <span style={{ color: '#8a7a9c' }}>Unclaimed, no keeper this age</span>
            )}
          </div>

          <div style={{ marginTop: 12, fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: '#7a6890' }}>Chronicle</div>
          {wonderCard.history?.length > 0 ? (
            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 5 }}>
              {wonderCard.history.map((h, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: h.color || '#888', flexShrink: 0 }} />
                  <span style={{ color: '#c4b498', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.username}</span>
                  <span style={{ marginLeft: 'auto', color: '#7a6890', fontSize: 11, flexShrink: 0 }}>
                    {new Date(h.seized_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}{' '}
                    {new Date(h.seized_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ marginTop: 6, fontSize: 12, color: '#8a7a9c', fontStyle: 'italic' }}>No banner has ever flown here.</div>
          )}
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
          zIndex: 30,
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
      {CHAT_ON && (
        <ChatPanel player={player} alliance={alliance} />
      )}

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
          onClose={() => { dismissedBattleRef.current = activeBattle?.id ?? null; setActiveBattle(null) }}
        />
      )}

      {/* ── Bottom drawer - replaces all floating panels ────────── */}
      {selectedHex && !activeBattle && (
        <BottomDrawer
          hex={selectedHex}
          player={player}
          stats={stats}
          ownedHexCount={ownedHexCount}
          getFriendlyNeighborCount={getFriendlyNeighborCount}
          onStatsRefresh={loadStats}
          onClaim={handleClaim}
          onSetCapital={handleSetCapital}
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

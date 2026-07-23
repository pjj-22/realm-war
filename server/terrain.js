import { cellToLatLng, cellToBoundary } from 'h3-js'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const { feature } = require('topojson-client')
const topo = require('world-atlas/land-10m.json')
const landFC = feature(topo, topo.objects.land)
// feature() returns a FeatureCollection; the land file has one MultiPolygon feature
const landGeometry = landFC.features[0].geometry

// Hexes that are real, playable land but fall through the polygon test - tiny
// islands below the 1:10m dataset's cutoff. Center + all six vertices read as
// water, yet a player standing there is standing on ground.
const LAND_OVERRIDES = new Set([
  '872a1072bffffff', // Liberty Island, NY (Statue of Liberty)
])

// ─── Ray-casting point-in-polygon ─────────────────────────────────────────────

function pointInRing(pt, ring) {
  const [x, y] = pt
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1]
    const xj = ring[j][0], yj = ring[j][1]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

function pointInPolygonCoords(pt, coords) {
  // coords = [outerRing, ...holes]
  if (!pointInRing(pt, coords[0])) return false
  for (let i = 1; i < coords.length; i++) {
    if (pointInRing(pt, coords[i])) return false // inside a hole
  }
  return true
}

// ─── Pre-process land polygons with bounding boxes for fast rejection ─────────

const landPolygons = []

const polys = landGeometry.type === 'MultiPolygon'
  ? landGeometry.coordinates
  : [landGeometry.coordinates]

for (const poly of polys) {
  const outer = poly[0]
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity
  for (const [lng, lat] of outer) {
    if (lng < minLng) minLng = lng
    if (lng > maxLng) maxLng = lng
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
  }
  landPolygons.push({ coords: poly, minLng, maxLng, minLat, maxLat })
}

console.log(`[terrain] Loaded ${landPolygons.length} land polygons`)

function pointOnLand(lng, lat) {
  return landPolygons.some(({ coords, minLng, maxLng, minLat, maxLat }) => {
    if (lng < minLng || lng > maxLng || lat < minLat || lat > maxLat) return false
    return pointInPolygonCoords([lng, lat], coords)
  })
}

// ─── Public API ───────────────────────────────────────────────────────────────

const cache = new Map()

// A hex is land if ANY of its center + six vertices touches a land polygon.
// Center-only testing marked coastal cities (Venice, Copenhagen, Hong Kong)
// and narrow crossings as ocean because the hex center sat just offshore,
// cutting land routes the real world has. Any-point errs toward playable.
export function isOcean(h3Index) {
  if (cache.has(h3Index)) return cache.get(h3Index)

  let ocean
  if (LAND_OVERRIDES.has(h3Index)) {
    ocean = false
  } else {
    const [clat, clng] = cellToLatLng(h3Index)
    ocean = !pointOnLand(clng, clat) &&
      !cellToBoundary(h3Index).some(([lat, lng]) => pointOnLand(lng, lat))
  }

  cache.set(h3Index, ocean)
  return ocean
}

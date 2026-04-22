import { cellToLatLng } from 'h3-js'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const { feature } = require('topojson-client')
const topo = require('world-atlas/land-50m.json')
const landFC = feature(topo, topo.objects.land)
// feature() returns a FeatureCollection; land-50m has one MultiPolygon feature
const landGeometry = landFC.features[0].geometry

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

// ─── Public API ───────────────────────────────────────────────────────────────

const cache = new Map()

export function isOcean(h3Index) {
  if (cache.has(h3Index)) return cache.get(h3Index)

  const [lat, lng] = cellToLatLng(h3Index)

  const onLand = landPolygons.some(({ coords, minLng, maxLng, minLat, maxLat }) => {
    if (lng < minLng || lng > maxLng || lat < minLat || lat > maxLat) return false
    return pointInPolygonCoords([lng, lat], coords)
  })

  cache.set(h3Index, !onLand)
  return !onLand
}

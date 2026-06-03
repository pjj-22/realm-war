import { latLngToCell } from 'h3-js'
import { getCountry } from './countries.js'

const HEX_RES = 7

const DEFS = [
  // Europe
  { name: 'London',        primary: true,  lat:  51.507, lng:  -0.127 },
  { name: 'Paris',         primary: true,  lat:  48.857, lng:   2.352 },
  { name: 'Berlin',        primary: true,  lat:  52.520, lng:  13.405 },
  { name: 'Rome',          primary: true,  lat:  41.902, lng:  12.496 },
  { name: 'Madrid',        primary: true,  lat:  40.417, lng:  -3.703 },
  { name: 'Moscow',        primary: true,  lat:  55.751, lng:  37.618 },
  { name: 'Istanbul',      primary: true,  lat:  41.015, lng:  28.980 },
  { name: 'Warsaw',        primary: true,  lat:  52.230, lng:  21.012 },
  { name: 'Stockholm',     primary: true,  lat:  59.330, lng:  18.065 },
  // Americas
  { name: 'Washington DC', primary: true,  lat:  38.895, lng: -77.037 },
  { name: 'New York',      primary: false, lat:  40.713, lng: -74.006 },
  { name: 'Los Angeles',   primary: false, lat:  34.052, lng:-118.244 },
  { name: 'Chicago',       primary: false, lat:  41.878, lng: -87.630 },
  { name: 'Toronto',       primary: true,  lat:  43.651, lng: -79.383 },
  { name: 'Mexico City',   primary: true,  lat:  19.433, lng: -99.133 },
  { name: 'São Paulo',     primary: true,  lat: -23.549, lng: -46.633 },
  { name: 'Buenos Aires',  primary: true,  lat: -34.604, lng: -58.382 },
  { name: 'Havana',        primary: true,  lat:  23.136, lng: -82.359 },
  // Asia / Pacific
  { name: 'Beijing',       primary: true,  lat:  39.905, lng: 116.407 },
  { name: 'Shanghai',      primary: false, lat:  31.230, lng: 121.474 },
  { name: 'Tokyo',         primary: true,  lat:  35.690, lng: 139.692 },
  { name: 'Seoul',         primary: true,  lat:  37.566, lng: 126.978 },
  { name: 'New Delhi',     primary: true,  lat:  28.614, lng:  77.209 },
  { name: 'Mumbai',        primary: false, lat:  19.076, lng:  72.878 },
  { name: 'Karachi',       primary: true,  lat:  24.861, lng:  67.011 },
  { name: 'Jakarta',       primary: true,  lat:  -6.200, lng: 106.817 },
  { name: 'Bangkok',       primary: true,  lat:  13.756, lng: 100.502 },
  { name: 'Singapore',     primary: true,  lat:   1.290, lng: 103.850 },
  { name: 'Sydney',        primary: true,  lat: -33.869, lng: 151.209 },
  // Middle East / Africa
  { name: 'Cairo',         primary: true,  lat:  30.063, lng:  31.250 },
  { name: 'Lagos',         primary: true,  lat:   6.455, lng:   3.384 },
  { name: 'Nairobi',       primary: true,  lat:  -1.286, lng:  36.820 },
  { name: 'Johannesburg',  primary: true,  lat: -26.195, lng:  28.034 },
  { name: 'Riyadh',        primary: true,  lat:  24.688, lng:  46.722 },
  { name: 'Tehran',        primary: true,  lat:  35.700, lng:  51.415 },
  // Chokepoints — flat bonus only, no territory mechanic
  { name: 'Suez Canal',    primary: false, lat:  30.583, lng:  32.265 },
  { name: 'Panama Canal',  primary: false, lat:   9.107, lng: -79.681 },
  { name: 'Gibraltar',     primary: false, lat:  36.140, lng:  -5.354 },
]

export const STRATEGIC_BONUS_GOLD    = 5   // +5g per tick (all strategic hexes)
export const STRATEGIC_DEFENSE_BONUS = 0.2 // +20% defender strength

export const STRATEGIC_HEXES = new Map(
  DEFS.map(def => [
    latLngToCell(def.lat, def.lng, HEX_RES),
    { name: def.name, primary: def.primary },
  ])
)

// Map from primary capital h3_index → country name (derived at runtime)
export const CAPITAL_COUNTRY = new Map()
for (const [h3, def] of STRATEGIC_HEXES) {
  if (!def.primary) continue
  const info = getCountry(h3)
  if (info) CAPITAL_COUNTRY.set(h3, info.name)
}

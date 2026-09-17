// Display-only mirror of server/visibility.js's day/night rule (same
// DAY_START_HOUR/DAY_END_HOUR, same longitude -> rough UTC-offset
// approximation) - this never gates real data, it's just telling the viewer
// when a hex's daylight window falls in their own local clock.
import { cellToLatLng } from 'h3-js'

const DAY_START_HOUR = 6
const DAY_END_HOUR = 20

function offsetHoursForLng(lng) {
  return Math.round(lng / 15)
}

function hexLocalHourToViewerDate(lng, hexLocalHour) {
  const d = new Date()
  d.setUTCHours(hexLocalHour - offsetHoursForLng(lng), 0, 0, 0)
  return d
}

const timeFmt = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' })

// e.g. "6:00 AM - 8:00 PM" - rendered in the viewer's browser-local time via
// Intl, regardless of where the hex itself is.
export function daylightHoursLocal(h3Index) {
  const [, lng] = cellToLatLng(h3Index)
  const start = hexLocalHourToViewerDate(lng, DAY_START_HOUR)
  const end = hexLocalHourToViewerDate(lng, DAY_END_HOUR)
  return `${timeFmt.format(start)} - ${timeFmt.format(end)}`
}

// Works off raw longitude, not a hex - the map-center day/night indicator
// (GameMap.jsx topbar) has a lng/lat from the camera, not an h3 cell, and
// there's no reason to force one through latLngToCell just to unwrap it
// again a line later.
export function isDarkAtLng(lng, now = new Date()) {
  const localHour = (now.getUTCHours() + offsetHoursForLng(lng) + 24) % 24
  return localHour < DAY_START_HOUR || localHour >= DAY_END_HOUR
}

// Same rule as server/visibility.js's isDark - kept in sync by hand since
// this one drives the visual night treatment on the map (every hex, owned
// or not, so it can't come from the per-owned-hex API response) while the
// server's copy gates real data. Never used to hide/show data here, only to
// paint a hex dark, so a client/server rounding mismatch at most misdraws a
// hex near dawn/dusk by an hour - never leaks or wrongly hides anything.
export function isDark(h3Index, now = new Date()) {
  const [, lng] = cellToLatLng(h3Index)
  return isDarkAtLng(lng, now)
}

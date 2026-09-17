// Display-only mirror of server/visibility.js's day/night rule (same
// DAY_START_HOUR/DAY_END_HOUR, same longitude -> rough UTC-offset
// approximation) - this never gates real data, it's just telling the viewer
// when a hex's daylight window falls in their own local clock.
import { cellToLatLng } from 'h3-js'

const DAY_START_HOUR = 6
const DAY_END_HOUR = 20

function hexLocalHourToViewerDate(h3Index, hexLocalHour) {
  const [, lng] = cellToLatLng(h3Index)
  const offsetHours = Math.round(lng / 15)
  const d = new Date()
  d.setUTCHours(hexLocalHour - offsetHours, 0, 0, 0)
  return d
}

const timeFmt = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' })

// e.g. "6:00 AM - 8:00 PM" - rendered in the viewer's browser-local time via
// Intl, regardless of where the hex itself is.
export function daylightHoursLocal(h3Index) {
  const start = hexLocalHourToViewerDate(h3Index, DAY_START_HOUR)
  const end = hexLocalHourToViewerDate(h3Index, DAY_END_HOUR)
  return `${timeFmt.format(start)} - ${timeFmt.format(end)}`
}

// Same rule as server/visibility.js's isDark - kept in sync by hand since
// this one drives the visual night treatment on the map (every hex, owned
// or not, so it can't come from the per-owned-hex API response) while the
// server's copy gates real data. Never used to hide/show data here, only to
// paint a hex dark, so a client/server rounding mismatch at most misdraws a
// hex near dawn/dusk by an hour - never leaks or wrongly hides anything.
export function isDark(h3Index, now = new Date()) {
  const [, lng] = cellToLatLng(h3Index)
  const offsetHours = Math.round(lng / 15)
  const localHour = (now.getUTCHours() + offsetHours + 24) % 24
  return localHour < DAY_START_HOUR || localHour >= DAY_END_HOUR
}

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

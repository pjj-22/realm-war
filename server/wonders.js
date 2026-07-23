// World Wonders: unique landmark hexes players fight to hold. Whoever owns the
// hex holds the wonder - there is no separate claim flow. A 15s poll detects
// ownership changes (claims, conquests, decay, season wipes all funnel through
// hexes.owner_id) and announces seizures in the world feed.
//
// Dependencies are injected (announce, wonders) so this is testable against
// pg-mem without pulling in socket.io - same pattern as founding.js.
import { latLngToCell } from 'h3-js'

export const WONDER_RESOLUTION = 7

export const WONDERS = [
  { id: 'eiffel',      name: 'Eiffel Tower',           lat: 48.8584,  lng: 2.2945 },
  { id: 'giza',        name: 'Great Pyramids of Giza', lat: 29.9792,  lng: 31.1342 },
  { id: 'colosseum',   name: 'Colosseum',              lat: 41.8902,  lng: 12.4922 },
  { id: 'tower',       name: 'Tower of London',        lat: 51.5081,  lng: -0.0759 },
  { id: 'fuji',        name: 'Mount Fuji',             lat: 35.3606,  lng: 138.7274 },
  { id: 'taj',         name: 'Taj Mahal',              lat: 27.1751,  lng: 78.0421 },
  { id: 'redeemer',    name: 'Christ the Redeemer',    lat: -22.9519, lng: -43.2105 },
  { id: 'greatwall',   name: 'Great Wall of China',    lat: 40.3540,  lng: 116.0037 },
  { id: 'machupicchu', name: 'Machu Picchu',           lat: -13.1631, lng: -72.5450 },
  { id: 'redsquare',   name: 'Red Square',             lat: 55.7539,  lng: 37.6208 },
  { id: 'opera',       name: 'Sydney Opera House',     lat: -33.8568, lng: 151.2153 },
  { id: 'liberty',     name: 'Statue of Liberty',      lat: 40.6892,  lng: -74.0445 },
  { id: 'goldengate',  name: 'Golden Gate Bridge',     lat: 37.8199,  lng: -122.4783 },
].map(w => ({ ...w, h3: latLngToCell(w.lat, w.lng, WONDER_RESOLUTION), title: `Keeper of the ${w.name}` }))

// Poll current hex ownership against wonder_holders and announce transitions.
// Seizures get a world event; a wonder going unheld (season wipe, decay) is
// cleared silently so a reset doesn't spam a dozen "abandoned" headlines.
// Every seizure is also appended to wonder_history - the permanent record of
// past keepers that survives season wipes (username/color copied, no FK).
export async function processWonders(pool, { wonders = WONDERS, announce } = {}) {
  const hexList = wonders.map(w => w.h3)
  const placeholders = hexList.map((_, i) => `$${i + 1}`).join(',')
  const owned = await pool.query(
    `SELECT h.h3_index, h.owner_id, p.username, p.color
     FROM hexes h JOIN players p ON p.id = h.owner_id
     WHERE h.h3_index IN (${placeholders})`,
    hexList
  )
  const ownerByHex = new Map(owned.rows.map(r => [r.h3_index, r]))
  const held = await pool.query('SELECT h3_index, owner_id FROM wonder_holders')
  const prevByHex = new Map(held.rows.map(r => [r.h3_index, r.owner_id]))

  const seized = []
  for (const w of wonders) {
    const now = ownerByHex.get(w.h3) || null
    const hadRow = prevByHex.has(w.h3)
    const prevId = prevByHex.get(w.h3)

    if (!now) {
      if (hadRow) await pool.query('DELETE FROM wonder_holders WHERE h3_index=$1', [w.h3])
      continue
    }
    if (hadRow && String(prevId) === String(now.owner_id)) continue

    if (hadRow) {
      await pool.query(
        'UPDATE wonder_holders SET owner_id=$1, taken_at=NOW() WHERE h3_index=$2',
        [now.owner_id, w.h3]
      )
    } else {
      await pool.query(
        'INSERT INTO wonder_holders (h3_index, owner_id, taken_at) VALUES ($1,$2,NOW())',
        [w.h3, now.owner_id]
      )
    }
    await pool.query(
      'INSERT INTO wonder_history (h3_index, username, color) VALUES ($1,$2,$3)',
      [w.h3, now.username, now.color || null]
    )
    seized.push({ wonder: w, ownerId: now.owner_id, username: now.username })
    await announce?.('wonder', `${now.username} has seized the ${w.name}!`, w.h3, now.owner_id)
  }
  return seized
}

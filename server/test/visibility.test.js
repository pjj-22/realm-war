// Server-side fog-of-war enforcement (server/visibility.js). Before this
// existed, every hex/army/battle endpoint sent real numbers to anyone and
// the client just chose not to render them - a network tab away from
// useless. These tests cover the shared visibility set and the day/night
// gate that hexes.js/battles.js/military.js now redact against.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { newDb } from 'pg-mem'
import { latLngToCell, gridDisk } from 'h3-js'
import { buildVisibleSet, isDark, canSeeDetail } from '../visibility.js'

let pool

beforeEach(async () => {
  const db = newDb()
  pool = new (db.adapters.createPg().Pool)()
  await pool.query(`
    CREATE TABLE players (
      id          SERIAL PRIMARY KEY,
      username    TEXT NOT NULL,
      alliance_id INTEGER
    );
    CREATE TABLE hexes (
      h3_index TEXT PRIMARY KEY,
      owner_id INTEGER NOT NULL
    );
  `)
})

test('buildVisibleSet includes owned hexes and their ring-1 neighbors, not further', async () => {
  const owned = latLngToCell(40.7128, -74.006, 7) // New York
  const neighbor = gridDisk(owned, 1).find(c => c !== owned)
  const far = gridDisk(owned, 3).find(c => !gridDisk(owned, 1).includes(c))

  await pool.query("INSERT INTO players (id, username) VALUES (1, 'p1')")
  await pool.query('INSERT INTO hexes (h3_index, owner_id) VALUES ($1, 1)', [owned])

  const visible = await buildVisibleSet(1, 1, pool)
  assert.ok(visible.has(owned), 'own hex should be visible')
  assert.ok(visible.has(neighbor), 'ring-1 neighbor should be visible')
  assert.ok(!visible.has(far), 'a hex outside the ring should not be visible')
})

test("buildVisibleSet includes an ally's hexes, not an unrelated player's", async () => {
  const mine = latLngToCell(35.6762, 139.6503, 7)   // Tokyo
  const allyHex = latLngToCell(48.8566, 2.3522, 7)  // Paris - far from mine, only visible via alliance
  const strangerHex = latLngToCell(-33.8688, 151.2093, 7) // Sydney

  await pool.query(`
    INSERT INTO players (id, username, alliance_id) VALUES
      (1, 'me', 10), (2, 'ally', 10), (3, 'stranger', 20)
  `)
  await pool.query('INSERT INTO hexes (h3_index, owner_id) VALUES ($1, 1), ($2, 2), ($3, 3)', [mine, allyHex, strangerHex])

  const visible = await buildVisibleSet(1, 1, pool)
  assert.ok(visible.has(mine))
  assert.ok(visible.has(allyHex), 'ally hex should be visible')
  assert.ok(!visible.has(strangerHex), "unrelated player's hex should not be visible")
})

test('isDark: local midday is not dark, midnight is', () => {
  const greenwich = latLngToCell(51.5, 0, 7) // longitude ~0, local hour == UTC hour
  assert.equal(isDark(greenwich, new Date('2026-01-01T12:00:00Z')), false)
  assert.equal(isDark(greenwich, new Date('2026-01-01T00:00:00Z')), true)
})

test('canSeeDetail: darkness hides even an in-range hex; projection overrides range but not darkness', () => {
  const greenwich = latLngToCell(51.5, 0, 7)
  const noon = new Date('2026-01-01T12:00:00Z')
  const midnight = new Date('2026-01-01T00:00:00Z')

  const visibleSet = new Set([greenwich])
  assert.equal(canSeeDetail(greenwich, visibleSet, false, noon), true)
  assert.equal(canSeeDetail(greenwich, visibleSet, false, midnight), false, 'dark overrides in-range visibility')
  assert.equal(canSeeDetail(greenwich, new Set(), true, noon), true, 'projection overrides out-of-range')
  assert.equal(canSeeDetail(greenwich, new Set(), true, midnight), false, 'projection does not override darkness')
})

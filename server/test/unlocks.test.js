// Hex-count unlocks (unlocks.js) against pg-mem: gating uses the season peak
// (not the current count) and crossing a milestone posts one event.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { newDb } from 'pg-mem'

const db = newDb()
const pool = new (db.adapters.createPg().Pool)()
mock.module('../db.js', {
  namedExports: {
    pool, withTransaction: async fn => fn(pool),
    httpError: (status, message) => Object.assign(new Error(message), { status }),
  },
})
const { getUnlockState, requireUnlock, updatePeaks } = await import('../unlocks.js')
const { UNLOCKS } = await import('../config.js')

await pool.query(`
  CREATE TABLE players (id SERIAL PRIMARY KEY, username TEXT NOT NULL, peak_hexes INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE hexes (h3_index TEXT PRIMARY KEY, owner_id INTEGER);
`)

const tier = id => UNLOCKS.find(u => u.id === id).hexes
const events = []
const notify = (playerId, type, message) => events.push({ playerId, type, message })
async function giveHexes(playerId, n) {
  const have = Number((await pool.query('SELECT COUNT(*) AS c FROM hexes')).rows[0].c)
  for (let i = 0; i < n; i++) await pool.query('INSERT INTO hexes VALUES ($1, $2)', [`h${have + i}`, playerId])
}

beforeEach(async () => {
  events.length = 0
  await pool.query('DELETE FROM hexes')
  await pool.query('DELETE FROM players')
  await pool.query("INSERT INTO players (id, username) VALUES (1, 'alice'), (2, 'BOT_x')")
})

test('locked below the tier, unlocked at it', async () => {
  await giveHexes(1, tier('mass_march') - 1)
  await assert.rejects(requireUnlock(1, 'mass_march'), e => e.status === 403 && /unlocks at/.test(e.message))
  await giveHexes(1, 1)
  await requireUnlock(1, 'mass_march')
})

test('unlocks stay once earned even after losing hexes', async () => {
  await giveHexes(1, tier('fan_out'))
  await updatePeaks(notify)
  await pool.query('DELETE FROM hexes')
  await giveHexes(1, 3)
  const state = await getUnlockState(1)
  assert.equal(state.hexes, 3)
  assert.equal(state.effective, tier('fan_out'))
  await requireUnlock(1, 'fan_out')
})

test('crossing milestones posts one event listing what unlocked; a second harvest is quiet', async () => {
  await giveHexes(1, tier('mass_march'))
  await updatePeaks(notify)
  assert.equal(events.length, 1)
  assert.match(events[0].message, /Mass march/)
  await updatePeaks(notify)
  assert.equal(events.length, 1)
})

test('bots never get unlock events', async () => {
  await giveHexes(2, tier('empire'))
  await updatePeaks(notify)
  assert.equal(events.length, 0)
})

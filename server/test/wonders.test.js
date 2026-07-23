// World Wonders: the 15s poll must announce a seizure exactly once, stay quiet
// while ownership is stable, and clear holders silently when a wonder goes
// unheld (season wipe) so a reset doesn't spam the Herald.
//
// Runs against pg-mem. The wonder list is injected so tests don't depend on
// the real landmark table; WONDERS itself gets a data-sanity test at the end.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { newDb } from 'pg-mem'
import { getResolution } from 'h3-js'
import { processWonders, WONDERS, WONDER_RESOLUTION } from '../wonders.js'

const W1 = { id: 'w1', name: 'Test Spire', title: 'Keeper of the Test Spire', h3: '87aaaaaaaffffff' }
const W2 = { id: 'w2', name: 'Test Gate', title: 'Keeper of the Test Gate', h3: '87bbbbbbbffffff' }
const wonders = [W1, W2]

let pool
let events

// announce with the insertWorldEvent signature, captured for assertions
const announce = async (type, message, hexIndex, playerId) => {
  events.push({ type, message, hexIndex, playerId })
}

beforeEach(async () => {
  const db = newDb()
  pool = new (db.adapters.createPg().Pool)()
  events = []
  await pool.query(`
    CREATE TABLE players (
      id       SERIAL PRIMARY KEY,
      username TEXT NOT NULL,
      color    TEXT
    );
    CREATE TABLE hexes (
      h3_index TEXT PRIMARY KEY,
      owner_id INTEGER
    );
    CREATE TABLE wonder_holders (
      h3_index TEXT PRIMARY KEY,
      owner_id INTEGER NOT NULL,
      taken_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE wonder_history (
      id        SERIAL PRIMARY KEY,
      h3_index  TEXT NOT NULL,
      username  TEXT NOT NULL,
      color     TEXT,
      seized_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)
  await pool.query("INSERT INTO players (id, username) VALUES (1, 'alice'), (2, 'bob')")
})

async function holders() {
  const r = await pool.query('SELECT h3_index, owner_id FROM wonder_holders ORDER BY h3_index')
  return r.rows
}

async function history(h3) {
  const r = await pool.query(
    'SELECT username FROM wonder_history WHERE h3_index=$1 ORDER BY id', [h3]
  )
  return r.rows.map(x => x.username)
}

test('unheld wonders: no events, no holder rows', async () => {
  await processWonders(pool, { wonders, announce })
  assert.equal(events.length, 0)
  assert.equal((await holders()).length, 0)
})

test('first seizure announces and records the holder', async () => {
  await pool.query('INSERT INTO hexes (h3_index, owner_id) VALUES ($1, 1)', [W1.h3])
  const seized = await processWonders(pool, { wonders, announce })

  assert.equal(seized.length, 1)
  assert.equal(seized[0].username, 'alice')
  assert.equal(events.length, 1)
  assert.equal(events[0].type, 'wonder')
  assert.match(events[0].message, /alice has seized the Test Spire!/)
  assert.equal(events[0].hexIndex, W1.h3)
  assert.equal(events[0].playerId, 1)
  assert.deepEqual(await holders(), [{ h3_index: W1.h3, owner_id: 1 }])
  assert.deepEqual(await history(W1.h3), ['alice'])
})

test('stable ownership: polling again stays silent', async () => {
  await pool.query('INSERT INTO hexes (h3_index, owner_id) VALUES ($1, 1)', [W1.h3])
  await processWonders(pool, { wonders, announce })
  events = []

  await processWonders(pool, { wonders, announce })
  await processWonders(pool, { wonders, announce })
  assert.equal(events.length, 0)
  assert.equal((await holders()).length, 1)
  assert.deepEqual(await history(W1.h3), ['alice'], 'stable ownership must not pad the chronicle')
})

test('conquest: new owner is announced and replaces the holder', async () => {
  await pool.query('INSERT INTO hexes (h3_index, owner_id) VALUES ($1, 1)', [W1.h3])
  await processWonders(pool, { wonders, announce })
  events = []

  await pool.query('UPDATE hexes SET owner_id = 2 WHERE h3_index = $1', [W1.h3])
  await processWonders(pool, { wonders, announce })

  assert.equal(events.length, 1)
  assert.match(events[0].message, /bob has seized the Test Spire!/)
  assert.deepEqual(await holders(), [{ h3_index: W1.h3, owner_id: 2 }])
  assert.deepEqual(await history(W1.h3), ['alice', 'bob'])
})

test('season wipe: holder rows clear silently, next seizure announces again', async () => {
  await pool.query('INSERT INTO hexes (h3_index, owner_id) VALUES ($1, 1)', [W1.h3])
  await processWonders(pool, { wonders, announce })
  events = []

  await pool.query('DELETE FROM hexes')            // the great reset
  await processWonders(pool, { wonders, announce })
  assert.equal(events.length, 0, 'going unheld must not spam the Herald')
  assert.equal((await holders()).length, 0)

  await pool.query('INSERT INTO hexes (h3_index, owner_id) VALUES ($1, 2)', [W1.h3])
  await processWonders(pool, { wonders, announce })
  assert.equal(events.length, 1)
  assert.match(events[0].message, /bob has seized/)
  assert.deepEqual(await history(W1.h3), ['alice', 'bob'], 'the wipe must not erase the chronicle')
})

test('two wonders can change hands in one poll', async () => {
  await pool.query('INSERT INTO hexes (h3_index, owner_id) VALUES ($1, 1), ($2, 2)', [W1.h3, W2.h3])
  const seized = await processWonders(pool, { wonders, announce })
  assert.equal(seized.length, 2)
  assert.equal(events.length, 2)
})

// ── Landmark data sanity ─────────────────────────────────────────────────────

test('WONDERS: h3 indexes are unique and at the game resolution', () => {
  const seen = new Set(WONDERS.map(w => w.h3))
  assert.equal(seen.size, WONDERS.length, 'two landmarks resolve to the same hex')
  for (const w of WONDERS) {
    assert.equal(getResolution(w.h3), WONDER_RESOLUTION, `${w.name} is not res-${WONDER_RESOLUTION}`)
  }
})

test('WONDERS: every landmark sits on a claimable land hex', async () => {
  // isOcean loads the land topojson once (~1s); a wonder on an "ocean" hex
  // would be unclaimable and therefore unwinnable.
  const { isOcean } = await import('../terrain.js')
  for (const w of WONDERS) {
    assert.equal(isOcean(w.h3), false, `${w.name} (${w.h3}) is flagged ocean - players could never hold it`)
  }
})

// Champion's Monument: raised at the winner's capital when a season ends,
// exactly once per season, and only if there is a champion with a capital.
// The UNIQUE(season_number) guard makes a re-run of processSeason harmless.
//
// Runs against pg-mem.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { newDb } from 'pg-mem'
import { recordMonument } from '../monuments.js'

const CAP = '871fb4675ffffff'

let pool

beforeEach(async () => {
  const db = newDb()
  pool = new (db.adapters.createPg().Pool)()
  await pool.query(`
    CREATE TABLE players (
      id          SERIAL PRIMARY KEY,
      username    TEXT NOT NULL,
      color       TEXT,
      capital_hex TEXT
    );
    CREATE TABLE monuments (
      id            SERIAL PRIMARY KEY,
      season_number INTEGER NOT NULL UNIQUE,
      username      TEXT NOT NULL,
      color         TEXT,
      h3_index      TEXT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)
  await pool.query(
    "INSERT INTO players (id, username, color, capital_hex) VALUES (1, 'alice', '#d94f4f', $1), (2, 'nomad', '#4f9fd9', NULL)",
    [CAP]
  )
})

async function monuments() {
  const r = await pool.query('SELECT season_number, username, color, h3_index FROM monuments ORDER BY season_number')
  return r.rows
}

test('records the champion monument at their capital', async () => {
  const m = await recordMonument(pool, { seasonNumber: 7, winnerId: 1 })
  assert.equal(m.username, 'alice')
  assert.equal(m.h3_index, CAP)
  assert.equal(m.color, '#d94f4f')
  assert.deepEqual(await monuments(), [
    { season_number: 7, username: 'alice', color: '#d94f4f', h3_index: CAP },
  ])
})

test('no champion, no monument', async () => {
  assert.equal(await recordMonument(pool, { seasonNumber: 7, winnerId: null }), null)
  assert.equal((await monuments()).length, 0)
})

test('champion without a capital gets no monument', async () => {
  assert.equal(await recordMonument(pool, { seasonNumber: 7, winnerId: 2 }), null)
  assert.equal((await monuments()).length, 0)
})

test('re-running the same season is a no-op (idempotent)', async () => {
  await recordMonument(pool, { seasonNumber: 7, winnerId: 1 })
  const dup = await recordMonument(pool, { seasonNumber: 7, winnerId: 1 })
  assert.equal(dup, null)
  assert.equal((await monuments()).length, 1)
})

test('monuments accumulate across seasons', async () => {
  await recordMonument(pool, { seasonNumber: 7, winnerId: 1 })
  await recordMonument(pool, { seasonNumber: 8, winnerId: 1 })
  assert.equal((await monuments()).length, 2)
})

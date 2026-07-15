// Regression test for the atomic capital-founding fix (commit f89fc0a).
//
// The bug: a double-clicked first-hex claim fired two POST /claim requests, each of
// which re-ran the founding gifts, doubling a new player's starting troops, mine, and
// nearby camps. The fix guards the capital assignment with
//   UPDATE players SET capital_hex = $1 WHERE id = $2 AND capital_hex IS NULL
// so only the first request wins and gifts are handed out exactly once.
//
// Runs against an in-memory Postgres (pg-mem) - no live database required.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { newDb } from 'pg-mem'
import { foundCapital } from '../founding.js'

const STARTING_TROOPS = 50

let pool

beforeEach(async () => {
  const db = newDb()
  pool = new (db.adapters.createPg().Pool)()
  await pool.query(`
    CREATE TABLE players (
      id          SERIAL PRIMARY KEY,
      username    TEXT NOT NULL,
      capital_hex TEXT
    );
    CREATE TABLE troops (
      owner_id INTEGER NOT NULL,
      h3_index TEXT    NOT NULL,
      type     TEXT    NOT NULL DEFAULT 'troop',
      quantity INTEGER NOT NULL DEFAULT 0,
      UNIQUE (owner_id, h3_index, type)
    );
    CREATE TABLE buildings (
      id       SERIAL PRIMARY KEY,
      h3_index TEXT NOT NULL,
      type     TEXT NOT NULL
    );
  `)
  await pool.query("INSERT INTO players (id, username) VALUES (1, 'newbie')")
})

const CAP = '871f1d489ffffff' // an arbitrary h3 index

async function troopCount(playerId, h3Index) {
  const r = await pool.query(
    'SELECT COALESCE(SUM(quantity),0)::int AS q FROM troops WHERE owner_id=$1 AND h3_index=$2',
    [playerId, h3Index]
  )
  return r.rows[0].q
}
async function mineCount(h3Index) {
  const r = await pool.query(
    "SELECT COUNT(*)::int AS c FROM buildings WHERE h3_index=$1 AND type='mine'",
    [h3Index]
  )
  return r.rows[0].c
}

test('single founding grants the starter gifts exactly once', async () => {
  let camps = 0
  const won = await foundCapital(pool, 1, CAP, { startingTroops: STARTING_TROOPS, onWin: () => camps++ })

  assert.equal(won, true)
  assert.equal(await troopCount(1, CAP), STARTING_TROOPS)
  assert.equal(await mineCount(CAP), 1)
  assert.equal(camps, 1)
})

test('duplicate founding (double-click) does not double the gifts', async () => {
  let camps = 0
  const opts = { startingTroops: STARTING_TROOPS, onWin: () => camps++ }

  const first = await foundCapital(pool, 1, CAP, opts)
  const second = await foundCapital(pool, 1, CAP, opts) // the losing double-click

  assert.equal(first, true)
  assert.equal(second, false, 'second founding must lose the capital_hex guard')
  assert.equal(await troopCount(1, CAP), STARTING_TROOPS, 'troops must not be doubled')
  assert.equal(await mineCount(CAP), 1, 'must not build a second mine')
  assert.equal(camps, 1, 'camps must be seeded only once')
})

test('concurrent foundings resolve to exactly one winner and one set of gifts', async () => {
  let camps = 0
  const opts = { startingTroops: STARTING_TROOPS, onWin: () => camps++ }

  const results = await Promise.all([
    foundCapital(pool, 1, CAP, opts),
    foundCapital(pool, 1, CAP, opts),
    foundCapital(pool, 1, CAP, opts),
  ])

  assert.equal(results.filter(Boolean).length, 1, 'exactly one claim wins')
  assert.equal(await troopCount(1, CAP), STARTING_TROOPS)
  assert.equal(await mineCount(CAP), 1)
  assert.equal(camps, 1)
})

test('a different player still founds their own capital independently', async () => {
  await pool.query("INSERT INTO players (id, username) VALUES (2, 'other')")
  const OTHER = '871f1d480ffffff'

  await foundCapital(pool, 1, CAP, { startingTroops: STARTING_TROOPS })
  const won = await foundCapital(pool, 2, OTHER, { startingTroops: STARTING_TROOPS })

  assert.equal(won, true, 'the guard is per-player, not global')
  assert.equal(await troopCount(2, OTHER), STARTING_TROOPS)
  assert.equal(await mineCount(OTHER), 1)
})

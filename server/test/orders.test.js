// Standing orders (orders.js) against pg-mem: garrison top-up, gold limits,
// build orders, stale-order cleanup. The pool is mocked once and tables are
// cleared between tests, same approach as tick-combat.test.js.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { newDb } from 'pg-mem'

const db = newDb()
const pool = new (db.adapters.createPg().Pool)()
mock.module('../db.js', {
  namedExports: { pool, withTransaction: async fn => fn(pool), httpError: (s, m) => new Error(m) },
})
const { processStandingOrders } = await import('../orders.js')
const { TROOP_STATS, BUILDING_COSTS } = await import('../config.js')

await pool.query(`
  CREATE TABLE players (id SERIAL PRIMARY KEY, gold INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE hexes (h3_index TEXT PRIMARY KEY, owner_id INTEGER);
  CREATE TABLE troops (owner_id INTEGER NOT NULL, h3_index TEXT NOT NULL, type TEXT NOT NULL, quantity INTEGER NOT NULL, UNIQUE (owner_id, h3_index, type));
  CREATE TABLE buildings (id SERIAL PRIMARY KEY, h3_index TEXT NOT NULL, type TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE training_queue (id SERIAL PRIMARY KEY, owner_id INTEGER NOT NULL, h3_index TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'troop', quantity INTEGER NOT NULL, started_at TIMESTAMPTZ NOT NULL, completes_at TIMESTAMPTZ NOT NULL, delivered INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE hex_orders (h3_index TEXT PRIMARY KEY, owner_id INTEGER NOT NULL, min_troops INTEGER NOT NULL DEFAULT 0, build TEXT);
`)

const UNIT = TROOP_STATS.troop.gold
const events = []
const notify = (playerId, type, message) => events.push({ playerId, type, message })

const queued = async (h3) => Number((await pool.query('SELECT COALESCE(SUM(quantity),0) AS q FROM training_queue WHERE h3_index=$1', [h3])).rows[0].q)
const goldOf = async () => Number((await pool.query('SELECT gold FROM players WHERE id=1')).rows[0].gold)

beforeEach(async () => {
  events.length = 0
  for (const t of ['players', 'hexes', 'troops', 'buildings', 'training_queue', 'hex_orders']) await pool.query(`DELETE FROM ${t}`)
  await pool.query('INSERT INTO players (id, gold) VALUES (1, $1)', [UNIT * 100])
  await pool.query("INSERT INTO hexes VALUES ('a', 1), ('b', 1)")
})

test('trains the shortfall, counting troops already garrisoned and in training', async () => {
  await pool.query("INSERT INTO troops VALUES (1, 'a', 'troop', 3)")
  await pool.query("INSERT INTO training_queue (owner_id, h3_index, quantity, started_at, completes_at) VALUES (1, 'a', 2, NOW(), NOW())")
  await pool.query("INSERT INTO hex_orders VALUES ('a', 1, 10, NULL)")
  await processStandingOrders(notify)
  assert.equal(await queued('a'), 2 + 5)
  assert.equal(await goldOf(), UNIT * 95)
  assert.equal(events.length, 1)
  assert.equal(events[0].type, 'orders')
})

test('does nothing (and charges nothing) when the garrison is already met', async () => {
  await pool.query("INSERT INTO troops VALUES (1, 'a', 'troop', 10)")
  await pool.query("INSERT INTO hex_orders VALUES ('a', 1, 10, NULL)")
  await processStandingOrders(notify)
  assert.equal(await queued('a'), 0)
  assert.equal(await goldOf(), UNIT * 100)
  assert.equal(events.length, 0)
})

test('with limited gold, the emptiest hex is served first and the shortfall is reported', async () => {
  await pool.query('UPDATE players SET gold=$1 WHERE id=1', [UNIT * 6])
  await pool.query("INSERT INTO troops VALUES (1, 'b', 'troop', 8)")
  await pool.query("INSERT INTO hex_orders VALUES ('a', 1, 10, NULL), ('b', 1, 10, NULL)")
  await processStandingOrders(notify)
  assert.equal(await queued('a'), 6)
  assert.equal(await queued('b'), 0)
  assert.equal(await goldOf(), 0)
  assert.match(events[0].message, /short/)
})

test('build orders put up the building on an empty hex and skip built ones', async () => {
  const cost = BUILDING_COSTS.fort.gold
  await pool.query("INSERT INTO buildings (h3_index, type) VALUES ('b', 'mine')")
  await pool.query("INSERT INTO hex_orders VALUES ('a', 1, 0, 'fort'), ('b', 1, 0, 'fort')")
  await processStandingOrders(notify)
  const rows = (await pool.query('SELECT h3_index, type FROM buildings ORDER BY h3_index')).rows
  assert.deepEqual(rows, [{ h3_index: 'a', type: 'fort' }, { h3_index: 'b', type: 'mine' }])
  assert.equal(await goldOf(), UNIT * 100 - cost)
})

test('orders on hexes the player no longer owns are dropped and never charged', async () => {
  await pool.query("UPDATE hexes SET owner_id=2 WHERE h3_index='a'")
  await pool.query("INSERT INTO hex_orders VALUES ('a', 1, 10, NULL)")
  await processStandingOrders(notify)
  assert.equal(await queued('a'), 0)
  assert.equal((await pool.query('SELECT 1 FROM hex_orders')).rows.length, 0)
  assert.equal(await goldOf(), UNIT * 100)
})

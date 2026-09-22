// POST /military/train-batch (routes/military.js) against pg-mem: trains
// across hexes the player owns in one transaction, skipping the rest.
import { test, mock, before, beforeEach } from 'node:test'
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
const { default: militaryRoutes } = await import('../routes/military.js')
const { TROOP_STATS } = await import('../config.js')

await pool.query(`
  CREATE TABLE players (id SERIAL PRIMARY KEY, gold INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE hexes (h3_index TEXT PRIMARY KEY, owner_id INTEGER);
  CREATE TABLE buildings (id SERIAL PRIMARY KEY, h3_index TEXT NOT NULL, type TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE training_queue (id SERIAL PRIMARY KEY, owner_id INTEGER NOT NULL, h3_index TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'troop', quantity INTEGER NOT NULL, started_at TIMESTAMPTZ NOT NULL, completes_at TIMESTAMPTZ NOT NULL, delivered INTEGER NOT NULL DEFAULT 0);
`)

// Pull the handler straight off the router rather than standing up express -
// same trick as calling a route module's exported layer stack.
const layer = militaryRoutes.stack.find(l => l.route?.path === '/train-batch')
const handler = layer.route.stack[layer.route.stack.length - 1].handle

function call(body, playerId = 1) {
  const req = { body, player: { id: playerId } }
  return new Promise(resolve => {
    const res = { json: (v) => resolve({ status: 200, body: v }), status: (s) => ({ json: (v) => resolve({ status: s, body: v }) }) }
    handler(req, res).catch(err => resolve({ status: 500, body: { error: err.message } }))
  })
}

const UNIT = TROOP_STATS.troop.gold

beforeEach(async () => {
  for (const t of ['players', 'hexes', 'training_queue']) await pool.query(`DELETE FROM ${t}`)
  await pool.query('INSERT INTO players (id, gold) VALUES (1, $1)', [UNIT * 20])
  await pool.query("INSERT INTO hexes VALUES ('a', 1), ('b', 1), ('c', 2)")
})

test('trains across every owned hex in the order in one call', async () => {
  const r = await call({ orders: [{ h3Index: 'a', quantity: 5 }, { h3Index: 'b', quantity: 5 }] })
  assert.equal(r.status, 200)
  assert.equal(r.body.trained, 10)
  assert.equal(r.body.hexes, 2)
  assert.equal(r.body.player.gold, UNIT * 10)
})

test('hexes the player does not own are silently skipped', async () => {
  const r = await call({ orders: [{ h3Index: 'a', quantity: 5 }, { h3Index: 'c', quantity: 5 }] })
  assert.equal(r.body.hexes, 1)
  assert.equal(r.body.trained, 5)
})

test('stops affording once gold runs out, keeping what it already queued', async () => {
  const r = await call({ orders: [{ h3Index: 'a', quantity: 15 }, { h3Index: 'b', quantity: 15 }] })
  assert.equal(r.body.hexes, 1)
  assert.equal(r.body.trained, 15)
  assert.equal(r.body.player.gold, UNIT * 5)
})

test('rejects a malformed order', async () => {
  const r = await call({ orders: [{ h3Index: 'a', quantity: 0 }] })
  assert.equal(r.status, 400)
})

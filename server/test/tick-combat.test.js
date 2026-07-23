// Integration tests for the battle engine in tick.js (processCombat +
// processBattleRounds). Runs against pg-mem via mock.module, substituting
// db.js's real pool - no refactor of the combat engine itself, so what's
// under test is exactly the code that runs in production.
//
// These specifically guard the two live bugs found and fixed in one session:
// 1. A defender (or their ally) reinforcing a hex already under siege used to
//    be silently deposited into `troops` and erased when the battle ended -
//    only attackers could reinforce mid-battle.
// 2. Survivors were computed once at the end from an all-time participant
//    total x only the final round's strength ratio, ignoring losses from
//    every round but the last - increasingly wrong the longer/more-reinforced
//    a battle got. Troop counts now decay every round in lockstep with
//    strength (decayTroops), so this can't drift.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { newDb } from 'pg-mem'

// db.js's pool is mocked exactly once, before tick.js is ever imported. ESM
// caches module instances per specifier - re-importing tick.js in a later
// beforeEach would NOT re-bind its already-resolved `import { pool }`, so
// each test instead gets a clean schema on this SAME long-lived mocked pool
// rather than a new pool object per test.
const db = newDb()
const pool = new (db.adapters.createPg().Pool)()
mock.module('../db.js', {
  namedExports: { pool, withTransaction: async fn => fn(pool), httpError: (s, m) => new Error(m) },
})
const { processCombat, processBattleRounds } = await import('../tick.js')

// Schema created once - pg-mem's DROP TABLE doesn't fully clean up PK index
// bookkeeping, so recreating tables per test collides on the next CREATE.
// Each test instead gets a clean slate via DELETE FROM in beforeEach.
await pool.query(`
    CREATE TABLE players (
      id          SERIAL PRIMARY KEY,
      username    TEXT NOT NULL,
      color       TEXT,
      gold        INTEGER NOT NULL DEFAULT 0,
      alliance_id INTEGER,
      capital_hex TEXT
    );
    CREATE TABLE hexes (
      h3_index   TEXT PRIMARY KEY,
      owner_id   INTEGER,
      claimed_at TIMESTAMPTZ
    );
    CREATE TABLE troops (
      owner_id INTEGER NOT NULL,
      h3_index TEXT NOT NULL,
      type     TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      UNIQUE (owner_id, h3_index, type)
    );
    CREATE TABLE buildings (
      id         SERIAL PRIMARY KEY,
      h3_index   TEXT NOT NULL,
      type       TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE armies (
      id          SERIAL PRIMARY KEY,
      owner_id    INTEGER NOT NULL,
      from_hex    TEXT NOT NULL,
      to_hex      TEXT NOT NULL,
      type        TEXT NOT NULL,
      quantity    INTEGER NOT NULL,
      status      TEXT NOT NULL DEFAULT 'marching',
      departed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      arrives_at  TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE battles (
      id                SERIAL PRIMARY KEY,
      h3_index          TEXT NOT NULL,
      attacker_id       INTEGER NOT NULL,
      defender_id       INTEGER NOT NULL,
      attacker_strength NUMERIC NOT NULL DEFAULT 0,
      defender_strength NUMERIC NOT NULL DEFAULT 0,
      attacker_troops   NUMERIC NOT NULL DEFAULT 0,
      defender_troops   NUMERIC NOT NULL DEFAULT 0,
      def_multiplier    NUMERIC NOT NULL DEFAULT 1,
      attacker_losses   NUMERIC NOT NULL DEFAULT 0,
      defender_losses   NUMERIC NOT NULL DEFAULT 0,
      round_number      INTEGER NOT NULL DEFAULT 0,
      last_round_at     TIMESTAMPTZ,
      ended_at          TIMESTAMPTZ,
      status            TEXT NOT NULL DEFAULT 'active',
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE battle_participants (
      id         SERIAL PRIMARY KEY,
      battle_id  INTEGER NOT NULL,
      player_id  INTEGER NOT NULL,
      side       TEXT NOT NULL,
      troop_type TEXT NOT NULL DEFAULT 'troop',
      quantity   INTEGER NOT NULL,
      joined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE events (
      id         SERIAL PRIMARY KEY,
      player_id  INTEGER NOT NULL,
      type       TEXT NOT NULL,
      message    TEXT NOT NULL,
      hex_index  TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE world_events (
      id         SERIAL PRIMARY KEY,
      type       TEXT NOT NULL,
      message    TEXT NOT NULL,
      hex_index  TEXT,
      player_id  INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)

beforeEach(async () => {
  await pool.query(`
    DELETE FROM battle_participants;
    DELETE FROM battles;
    DELETE FROM armies;
    DELETE FROM buildings;
    DELETE FROM troops;
    DELETE FROM hexes;
    DELETE FROM players;
    DELETE FROM events;
    DELETE FROM world_events;
  `)
})

// Real land hexes (res 7, remote central Australia) - isOcean() needs genuine
// land for the unclaimed-hex auto-claim path, and these are deliberately far
// from every named city/chokepoint in strategic.js so no strategic-hex or
// city-zone bonus sneaks into the "bare hex" math the tests expect. pg-mem is
// a fresh isolated DB per test, so there's no collision with real game data.
const BATTLE_HEX = '87b8a9ca9ffffff'
const DEF_HOME2  = '87b8a9ca8ffffff' // adjacent to BATTLE_HEX, for the entrenchment test
const DEF_HOME   = '87b8a9cabffffff'
const ATK_HOME   = '87b8a9cf6ffffff'
const UNCLAIMED_LAND_HEX = '87b8a9cf4ffffff'

async function seedPlayers() {
  await pool.query(`
    INSERT INTO players (id, username, color) VALUES
      (1, 'attacker', '#ff0000'),
      (2, 'defender', '#0000ff')
  `)
}

async function march(ownerId, from, to, quantity, arrived = true) {
  await pool.query(
    `INSERT INTO armies (owner_id, from_hex, to_hex, type, quantity, arrives_at, departed_at, status)
     VALUES ($1,$2,$3,'troop',$4,NOW(),NOW(),'marching')`,
    [ownerId, from, to, quantity]
  )
}

async function getBattle(h3 = BATTLE_HEX) {
  const r = await pool.query("SELECT * FROM battles WHERE h3_index=$1 AND status='active'", [h3])
  return r.rows[0]
}

test('marching to a genuinely unclaimed land hex just claims it, no battle', async () => {
  await seedPlayers()
  await march(1, ATK_HOME, UNCLAIMED_LAND_HEX, 10)
  await processCombat()

  const hex = (await pool.query('SELECT owner_id FROM hexes WHERE h3_index=$1', [UNCLAIMED_LAND_HEX])).rows[0]
  assert.equal(hex.owner_id, 1)
  assert.equal(await getBattle(UNCLAIMED_LAND_HEX), undefined)
})

test('battle starts with attacker str = raw troops, defender str = troops x multiplier', async () => {
  await seedPlayers()
  await pool.query("INSERT INTO hexes (h3_index, owner_id) VALUES ($1, 2)", [BATTLE_HEX])
  await pool.query("INSERT INTO troops (owner_id, h3_index, type, quantity) VALUES (2, $1, 'troop', 10)", [BATTLE_HEX])
  await march(1, ATK_HOME, BATTLE_HEX, 12)
  await processCombat()

  const battle = await getBattle()
  assert.ok(battle, 'battle should have started')
  assert.equal(Number(battle.attacker_strength), 12)
  assert.equal(Number(battle.defender_strength), 10)   // no forts/entrenchment here -> multiplier 1
  assert.equal(Number(battle.def_multiplier), 1)
  assert.equal(Number(battle.attacker_troops), 12)
  assert.equal(Number(battle.defender_troops), 10)
})

test('BUG FIX: defender reinforcing their own besieged hex joins the battle, not silently deposited', async () => {
  await seedPlayers()
  await pool.query("INSERT INTO hexes (h3_index, owner_id) VALUES ($1, 2), ($2, 2)", [BATTLE_HEX, DEF_HOME2])
  await pool.query("INSERT INTO troops (owner_id, h3_index, type, quantity) VALUES (2, $1, 'troop', 10)", [BATTLE_HEX])
  await march(1, ATK_HOME, BATTLE_HEX, 15)
  await processCombat() // starts the battle

  // Defender rushes reinforcements from their other hex to the besieged one
  await march(2, DEF_HOME2, BATTLE_HEX, 20)
  await processCombat() // should join the active battle, not deposit into troops

  const battle = await getBattle()
  assert.equal(Number(battle.defender_strength), 30, 'reinforcement must add to defender_strength')
  assert.equal(Number(battle.defender_troops), 30, 'reinforcement must add to defender_troops')

  const army = (await pool.query(
    "SELECT status FROM armies WHERE owner_id=2 AND from_hex=$1", [DEF_HOME2]
  )).rows[0]
  assert.equal(army.status, 'in_battle', 'reinforcing army must be marked in_battle, not arrived')

  // The old bug: troops table would silently gain 20 troops that do nothing
  // and get wiped when the battle resolves. Confirm that did NOT happen.
  const garrisonRow = (await pool.query(
    "SELECT quantity FROM troops WHERE owner_id=2 AND h3_index=$1", [BATTLE_HEX]
  )).rows[0]
  assert.equal(garrisonRow.quantity, 10, 'troops table should be untouched by the reinforcement')
})

test('BUG FIX: ally reinforcing a besieged hex joins the defender side', async () => {
  await pool.query(`
    INSERT INTO players (id, username, color, alliance_id) VALUES
      (1, 'attacker', '#ff0000', NULL),
      (2, 'defender', '#0000ff', 5),
      (3, 'ally', '#00ff00', 5)
  `)
  await pool.query("INSERT INTO hexes (h3_index, owner_id) VALUES ($1, 2)", [BATTLE_HEX])
  await pool.query("INSERT INTO troops (owner_id, h3_index, type, quantity) VALUES (2, $1, 'troop', 10)", [BATTLE_HEX])
  await march(1, ATK_HOME, BATTLE_HEX, 15)
  await processCombat()

  await march(3, DEF_HOME, BATTLE_HEX, 8)
  await processCombat()

  const battle = await getBattle()
  assert.equal(Number(battle.defender_strength), 18)
  const participant = (await pool.query(
    "SELECT side FROM battle_participants WHERE player_id=3"
  )).rows[0]
  assert.equal(participant.side, 'defender')
})

test('defender reinforcement gets the same defense multiplier the original garrison had', async () => {
  await seedPlayers()
  // Two adjacent defender hexes -> entrenchment bonus applies to the multiplier
  await pool.query("INSERT INTO hexes (h3_index, owner_id) VALUES ($1, 2), ($2, 2)", [BATTLE_HEX, DEF_HOME2])
  await pool.query("INSERT INTO buildings (h3_index, type, created_at) VALUES ($1, 'fort', NOW() - interval '1 hour')", [BATTLE_HEX])
  await pool.query("INSERT INTO troops (owner_id, h3_index, type, quantity) VALUES (2, $1, 'troop', 10)", [BATTLE_HEX])
  await march(1, ATK_HOME, BATTLE_HEX, 15)
  await processCombat()

  const started = await getBattle()
  const multiplier = Number(started.def_multiplier)
  assert.ok(multiplier > 1, 'fort should have boosted the multiplier above 1x')

  await march(2, DEF_HOME2, BATTLE_HEX, 20)
  await processCombat()

  const after = await getBattle()
  const expectedStrength = Number(started.defender_strength) + 20 * multiplier
  assert.ok(Math.abs(Number(after.defender_strength) - expectedStrength) < 1e-9,
    'reinforcement strength must use the SAME multiplier as the original garrison')
  assert.equal(Number(after.defender_troops), Number(started.defender_troops) + 20,
    'reinforcement troop count must be added raw (no multiplier - troops are a headcount)')
})

test('BUG FIX: survivors reflect every round of losses, not just the final round applied to an inflated all-time total', async () => {
  await seedPlayers()
  await pool.query("INSERT INTO hexes (h3_index, owner_id) VALUES ($1, 2), ($2, 2)", [BATTLE_HEX, DEF_HOME2])
  await pool.query("INSERT INTO troops (owner_id, h3_index, type, quantity) VALUES (2, $1, 'troop', 10)", [BATTLE_HEX])
  await march(1, ATK_HOME, BATTLE_HEX, 12)
  await processCombat()
  await processBattleRounds() // round 1: defender already takes losses before reinforcement arrives

  const midBattle = await getBattle()
  assert.ok(Number(midBattle.round_number) >= 1)

  // Reinforce AFTER the original garrison has already lost strength
  await march(2, DEF_HOME2, BATTLE_HEX, 20)
  await processCombat()

  // Run the battle to completion
  let resolved = null
  for (let i = 0; i < 20 && !resolved; i++) {
    await processBattleRounds()
    const r = await pool.query("SELECT * FROM battles WHERE h3_index=$1 AND status!='active'", [BATTLE_HEX])
    resolved = r.rows[0]
  }
  assert.ok(resolved, 'battle should have resolved within 20 rounds')
  assert.equal(resolved.status, 'defender_won')

  const survivorTroops = (await pool.query(
    "SELECT quantity FROM troops WHERE owner_id=2 AND h3_index=$1", [BATTLE_HEX]
  )).rows[0]

  // Old (buggy) formula: totalQty ever committed (10 + 20 = 30) x final-round
  // ratio only, ignoring the original garrison's earlier losses - it could
  // credit MORE survivors than were ever on the field at once (~78 in the
  // manually-verified case during development). The fix must stay bounded by
  // what was actually ever committed, and can never invent troops from thin air.
  assert.ok(survivorTroops.quantity <= 30, `survivors (${survivorTroops.quantity}) exceed total ever committed (30) - old bug reintroduced`)
  assert.ok(survivorTroops.quantity > 0, 'defender won, so some survivors must remain')
})

test('attacker wins outright when defenseless (owned hex, zero troops): hex taken, no battle row created', async () => {
  await seedPlayers()
  await pool.query("INSERT INTO hexes (h3_index, owner_id) VALUES ($1, 2)", [BATTLE_HEX]) // owned, but no troops row at all
  await march(1, ATK_HOME, BATTLE_HEX, 5)
  await processCombat()

  const hex = (await pool.query('SELECT owner_id FROM hexes WHERE h3_index=$1', [BATTLE_HEX])).rows[0]
  assert.equal(hex.owner_id, 1)
  assert.equal(await getBattle(), undefined)
})

test('unaffiliated third party joins the attacker side against a two-way battle', async () => {
  await pool.query(`
    INSERT INTO players (id, username, color) VALUES
      (1, 'attacker', '#ff0000'),
      (2, 'defender', '#0000ff'),
      (3, 'opportunist', '#00ffff')
  `)
  await pool.query("INSERT INTO hexes (h3_index, owner_id) VALUES ($1, 2)", [BATTLE_HEX])
  await pool.query("INSERT INTO troops (owner_id, h3_index, type, quantity) VALUES (2, $1, 'troop', 10)", [BATTLE_HEX])
  await march(1, ATK_HOME, BATTLE_HEX, 12)
  await processCombat()

  await march(3, DEF_HOME, BATTLE_HEX, 6)
  await processCombat()

  const battle = await getBattle()
  assert.equal(Number(battle.attacker_strength), 18)
  const participant = (await pool.query("SELECT side FROM battle_participants WHERE player_id=3")).rows[0]
  assert.equal(participant.side, 'attacker')
})

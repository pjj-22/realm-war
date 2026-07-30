// Integration tests for the battle engine in tick.js (processCombat +
// processBattleRounds). Runs against pg-mem via mock.module, substituting
// db.js's real pool - no refactor of the combat engine itself, so what's
// under test is exactly the code that runs in production.
//
// Combat resolves via frontline/reserve dice clashes (combat.js), not a
// continuous strength pool - only FRONTLINE_CAP troops per side fight any one
// clash, refilled from reserve afterward. attacker_strength/defender_strength
// are kept as a display approximation (troops / troops*multiplier) recomputed
// every clash; the real state lives in the frontline/reserve columns.
//
// These specifically guard bugs found and fixed across the project's history:
// 1. A defender (or their ally) reinforcing a hex already under siege used to
//    be silently deposited into `troops` and erased when the battle ended -
//    only attackers could reinforce mid-battle.
// 2. Survivors used to be computed once at the end from an all-time
//    participant total x only the final round's strength ratio, ignoring
//    losses from every round but the last. The frontline/reserve model can't
//    have this bug structurally - survivors are just the literal remaining
//    frontline + reserve count, never reconstructed from a ratio.
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
      id                  SERIAL PRIMARY KEY,
      h3_index            TEXT NOT NULL,
      attacker_id         INTEGER NOT NULL,
      defender_id         INTEGER NOT NULL,
      attacker_strength   NUMERIC NOT NULL DEFAULT 0,
      defender_strength   NUMERIC NOT NULL DEFAULT 0,
      attacker_troops     NUMERIC NOT NULL DEFAULT 0,
      defender_troops     NUMERIC NOT NULL DEFAULT 0,
      attacker_frontline  NUMERIC NOT NULL DEFAULT 0,
      attacker_reserve    NUMERIC NOT NULL DEFAULT 0,
      defender_frontline  NUMERIC NOT NULL DEFAULT 0,
      defender_reserve    NUMERIC NOT NULL DEFAULT 0,
      defender_advantage_troops INTEGER NOT NULL DEFAULT 0,
      attacker_losses     NUMERIC NOT NULL DEFAULT 0,
      defender_losses     NUMERIC NOT NULL DEFAULT 0,
      round_number        INTEGER NOT NULL DEFAULT 0,
      last_round_at       TIMESTAMPTZ,
      ended_at            TIMESTAMPTZ,
      status              TEXT NOT NULL DEFAULT 'active',
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
    CREATE TABLE battle_rounds (
      id                    SERIAL PRIMARY KEY,
      battle_id             INTEGER NOT NULL,
      round_number          INTEGER NOT NULL,
      defender_advantage_troops INTEGER NOT NULL,
      atk_frontline_before  INTEGER NOT NULL,
      def_frontline_before  INTEGER NOT NULL,
      atk_dice              INTEGER[] NOT NULL,
      def_dice              INTEGER[] NOT NULL,
      atk_losses            INTEGER NOT NULL,
      def_losses            INTEGER NOT NULL,
      atk_troops_after      NUMERIC NOT NULL,
      def_troops_after      NUMERIC NOT NULL,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
    DELETE FROM battle_rounds;
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
  assert.equal(Number(battle.defender_strength), 10)   // strength is just the real troop count now
  assert.equal(Number(battle.defender_advantage_troops), 0)   // no fort/entrenchment/strategic here -> no advantage
  assert.equal(Number(battle.attacker_troops), 12)
  assert.equal(Number(battle.defender_troops), 10)
  // Both armies fit entirely within FRONTLINE_CAP (10) or just over it -
  // attacker has 2 in reserve, defender's 10 troops exactly fill the frontline
  assert.equal(Number(battle.attacker_frontline), 10)
  assert.equal(Number(battle.attacker_reserve), 2)
  assert.equal(Number(battle.defender_frontline), 10)
  assert.equal(Number(battle.defender_reserve), 0)
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
  // Reinforcements land in reserve, not a strength pool - strength is only
  // recomputed when a clash actually resolves (processBattleRounds), not on arrival.
  assert.equal(Number(battle.defender_troops), 30, 'reinforcement must add to defender_troops')
  assert.equal(Number(battle.defender_reserve), 20, 'reinforcement must land in reserve, ready to refill the frontline')
  assert.equal(Number(battle.defender_frontline), 10, 'frontline is untouched until the next clash')

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
  assert.equal(Number(battle.defender_troops), 18)
  assert.equal(Number(battle.defender_reserve), 8, 'ally reinforcement lands in the defender reserve')
  const participant = (await pool.query(
    "SELECT side FROM battle_participants WHERE player_id=3"
  )).rows[0]
  assert.equal(participant.side, 'defender')
})

test('reinforcement lands raw in reserve - advantaged defender count is fixed at battle start, not baked into arrival', async () => {
  await seedPlayers()
  // Two adjacent defender hexes -> entrenchment adds an advantaged defender
  await pool.query("INSERT INTO hexes (h3_index, owner_id) VALUES ($1, 2), ($2, 2)", [BATTLE_HEX, DEF_HOME2])
  await pool.query("INSERT INTO buildings (h3_index, type, created_at) VALUES ($1, 'fort', NOW() - interval '1 hour')", [BATTLE_HEX])
  await pool.query("INSERT INTO troops (owner_id, h3_index, type, quantity) VALUES (2, $1, 'troop', 10)", [BATTLE_HEX])
  await march(1, ATK_HOME, BATTLE_HEX, 15)
  await processCombat()

  const started = await getBattle()
  const advantaged = Number(started.defender_advantage_troops)
  assert.ok(advantaged > 0, 'fort + entrenchment should have given the defender some advantaged troops')

  await march(2, DEF_HOME2, BATTLE_HEX, 20)
  await processCombat()

  const after = await getBattle()
  // No scaling applied at arrival - a reinforcing troop is a real troop,
  // full stop. The advantaged-defender count only affects how a clash
  // resolves, not what lands in reserve.
  assert.equal(Number(after.defender_reserve) - Number(started.defender_reserve), 20,
    'reinforcement must add the raw troop count to reserve, unscaled')
  assert.equal(Number(after.defender_troops), Number(started.defender_troops) + 20)
  assert.equal(Number(after.defender_advantage_troops), advantaged, 'the advantaged-defender count itself is unchanged by reinforcement')
})

test('survivors are bounded by what was actually ever committed, and reinforcements are counted', async () => {
  await seedPlayers()
  await pool.query("INSERT INTO hexes (h3_index, owner_id) VALUES ($1, 2), ($2, 2)", [BATTLE_HEX, DEF_HOME2])
  await pool.query("INSERT INTO troops (owner_id, h3_index, type, quantity) VALUES (2, $1, 'troop', 10)", [BATTLE_HEX])
  await march(1, ATK_HOME, BATTLE_HEX, 12)
  await processCombat()
  await processBattleRounds() // clash 1: defender already takes losses before reinforcement arrives

  const midBattle = await getBattle()
  assert.ok(Number(midBattle.round_number) >= 1)

  // Reinforce AFTER the original garrison has already taken losses
  await march(2, DEF_HOME2, BATTLE_HEX, 20)
  await processCombat()

  // Run the battle to completion (real RNG - dice decide the winner, unlike
  // the old deterministic percentage formula, so this only asserts structural
  // invariants that must hold regardless of who wins).
  let resolved = null
  for (let i = 0; i < 100 && !resolved; i++) {
    await processBattleRounds()
    const r = await pool.query("SELECT * FROM battles WHERE h3_index=$1 AND status!='active'", [BATTLE_HEX])
    resolved = r.rows[0]
  }
  assert.ok(resolved, 'battle should have resolved within 100 clashes')

  const winnerId = resolved.status === 'attacker_won' ? 1 : 2
  const totalEverCommitted = winnerId === 1 ? 12 : 30 // attacker never reinforced; defender got +20
  const survivorRow = (await pool.query(
    "SELECT quantity FROM troops WHERE owner_id=$1 AND h3_index=$2", [winnerId, BATTLE_HEX]
  )).rows[0]

  assert.ok(survivorRow, 'winner must have surviving troops deposited on the hex')
  assert.ok(survivorRow.quantity > 0, 'winner must have at least one survivor')
  assert.ok(survivorRow.quantity <= totalEverCommitted,
    `survivors (${survivorRow.quantity}) exceed total ever committed (${totalEverCommitted})`)
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
  assert.equal(Number(battle.attacker_troops), 18)
  assert.equal(Number(battle.attacker_reserve), 8, 'the opportunist\'s troops land in the attacker reserve')
  const participant = (await pool.query("SELECT side FROM battle_participants WHERE player_id=3")).rows[0]
  assert.equal(participant.side, 'attacker')
})

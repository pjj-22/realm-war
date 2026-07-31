import { pool, withTransaction } from './db.js'
import {
  IS_DEV, SPEED_DIV,
  TICK_INTERVAL_MS, BATTLE_INTERVAL_MS, FORT_ADVANTAGE_TROOPS,
  GOLD_CAP_BASE, GOLD_CAP_PER_HEX, GOLD_CAP_PER_MINE, BUILDING_TIME_SECONDS,
  OCEAN_MARCH_MULTIPLIER, TROOP_STATS,
  ENTRENCH_ADVANTAGE_PER_NEIGHBOR, ENTRENCH_MAX_NEIGHBORS,
  CAMP_LOOT_GOLD, CROWN_MIN_HEXES,
  DECAY_HEX_THRESHOLD, DECAY_CHANCE, DECAY_MAX_PER_TICK, requiredGarrisonForHexCount,
  WONDER_INCOME_GOLD, MIN_TROOPS_TO_CLAIM,
} from './config.js'
import { getIO } from './socket.js'
import { ensureBots, processBots } from './bots.js'
import { ensureWildlands } from './wild.js'
import { ensureSeason, processSeason } from './season.js'
import { processWonders, WONDERS } from './wonders.js'
import { gridDistance, gridDisk } from 'h3-js'
import { isOcean } from './terrain.js'
import { sendPush } from './push.js'
import { STRATEGIC_HEXES, STRATEGIC_BONUS_GOLD, STRATEGIC_ADVANTAGE_TROOPS, CAPITAL_COUNTRY, CITY_ZONES, ZONE_BONUS_PER_HEX } from './strategic.js'
import { getCountry } from './countries.js'
import { advantagedDefenderCount, resolveBattleClash, FRONTLINE_CAP } from './combat.js'

// Per-tick/per-battle chatter is dev-only; errors always log via console.error
const log = IS_DEV ? console.log : () => {}

function isNPC(username) {
  return username?.startsWith('BOT_') || username?.startsWith('WILD_')
}

// Flat per-hex gold bonus for owning any hex in a given list (city zones,
// wonders). Single batched UPDATE: one round-trip regardless of player count.
async function applyPerHexBonus(hexList, bonusPerHex) {
  if (hexList.length === 0) return
  await pool.query(`
    UPDATE players p SET gold = gold + z.n * $2
    FROM (
      SELECT owner_id, COUNT(*)::int AS n FROM hexes
      WHERE owner_id IS NOT NULL AND h3_index = ANY($1) GROUP BY owner_id
    ) z
    WHERE p.id = z.owner_id
  `, [hexList, bonusPerHex])
}

function isWild(username) {
  return username?.startsWith('WILD_')
}

export async function insertEvent(playerId, type, message, hexIndex = null) {
  try {
    await pool.query(
      'INSERT INTO events (player_id, type, message, hex_index) VALUES ($1,$2,$3,$4)',
      [playerId, type, message, hexIndex]
    )
    // Targeted at just this player's room (see socket.js) - a global emit here
    // meant every connected client got pinged for every single battle's
    // events, bot-vs-bot included, which is by far the most frequent socket
    // traffic in the game once bots are numerous.
    getIO()?.to(`player-${playerId}`).emit('events:new')
  } catch (err) {
    console.error('[event] Failed to insert event:', err.message)
  }
}

// Public newspaper entry - everyone sees these
export async function insertWorldEvent(type, message, hexIndex = null, playerId = null) {
  try {
    await pool.query(
      'INSERT INTO world_events (type, message, hex_index, player_id) VALUES ($1,$2,$3,$4)',
      [type, message, hexIndex, playerId]
    )
    getIO()?.emit('world:new')
  } catch (err) {
    console.error('[world] Failed to insert world event:', err.message)
  }
}

async function sameAlliance(aId, bId, client = pool) {
  if (!aId || !bId || aId === bId) return false
  try {
    const r = await client.query('SELECT alliance_id FROM players WHERE id IN ($1, $2)', [aId, bId])
    if (r.rows.length < 2) return false
    return r.rows[0].alliance_id != null && r.rows[0].alliance_id === r.rows[1].alliance_id
  } catch (err) {
    console.error('[tick] sameAlliance check failed:', err.message)
    return false
  }
}

const COMBAT_INTERVAL_MS = IS_DEV ? (2 * 1000) / SPEED_DIV : 15 * 1000
const TRAINING_INTERVAL_MS = 15 * 1000
const BASE_RATE = { gold: 1 }

export async function runTick() {
  log('[tick] Running resource tick...')
  try {
    const result = await pool.query(`
      SELECT
        p.id,
        COUNT(DISTINCT h.h3_index) AS hex_count,
        COALESCE(SUM(CASE WHEN b.type = 'mine' AND EXTRACT(EPOCH FROM (NOW() - b.created_at)) >= $1 THEN 3 ELSE 0 END), 0) AS gold_from_buildings
      FROM players p
      LEFT JOIN hexes h ON h.owner_id = p.id
      LEFT JOIN buildings b ON b.h3_index = h.h3_index
      WHERE p.username NOT LIKE 'WILD_%'
      GROUP BY p.id
    `, [BUILDING_TIME_SECONDS])
    const strategicIndexes = Array.from(STRATEGIC_HEXES.keys())
    for (const row of result.rows) {
      let goldGain = (Number(row.hex_count) * BASE_RATE.gold) + Number(row.gold_from_buildings)
      if (goldGain === 0) continue
      // Strategic hex bonus - count how many strategic hexes this player owns
      const sRes = await pool.query(
        'SELECT COUNT(*) AS cnt FROM hexes WHERE owner_id=$1 AND h3_index = ANY($2)',
        [row.id, strategicIndexes]
      )
      goldGain += Number(sRes.rows[0].cnt) * STRATEGIC_BONUS_GOLD
      await pool.query('UPDATE players SET gold=gold+$1 WHERE id=$2', [goldGain, row.id])
    }
    log(`[tick] Resources updated for ${result.rows.length} players.`)

    // Record hex history - only when count changes, 30-day retention
    const lastSnaps = await pool.query(
      'SELECT DISTINCT ON (player_id) player_id, hex_count FROM hex_history ORDER BY player_id, recorded_at DESC'
    )
    const lastMap = new Map(lastSnaps.rows.map(r => [r.player_id, Number(r.hex_count)]))
    const toRecord = result.rows.filter(r => lastMap.get(r.id) !== Number(r.hex_count))
    if (toRecord.length > 0) {
      const vals = toRecord.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(',')
      const params = toRecord.flatMap(r => [r.id, Number(r.hex_count)])
      await pool.query(`INSERT INTO hex_history (player_id, hex_count) VALUES ${vals}`, params)
    }
    await pool.query("DELETE FROM hex_history WHERE recorded_at < NOW() - INTERVAL '30 days'")

    // City zone income - each owned hex inside a city's zone pays a flat bonus.
    // Legible and fair across uneven country sizes; replaces the old 1.1^N territory bonus.
    await applyPerHexBonus(Array.from(CITY_ZONES.keys()), ZONE_BONUS_PER_HEX)

    // World Wonder keeper income - flat per wonder held, wherever it stands.
    // Holding the hex IS holding the wonder, so this is just a hex-list bonus.
    await applyPerHexBonus(WONDERS.map(w => w.h3), WONDER_INCOME_GOLD)

    if (CAPITAL_COUNTRY.size > 0) {
      const allHexes = await pool.query('SELECT h3_index, owner_id FROM hexes')

      // Build: playerId → Map<countryName, count> (for country crowns)
      const playerCountry = new Map()
      for (const { h3_index, owner_id } of allHexes.rows) {
        const country = getCountry(h3_index)?.name
        if (!country) continue
        if (!playerCountry.has(owner_id)) playerCountry.set(owner_id, new Map())
        const m = playerCountry.get(owner_id)
        m.set(country, (m.get(country) || 0) + 1)
      }

      const capitalList = Array.from(CAPITAL_COUNTRY.keys())
      const ownedCapitals = await pool.query(
        'SELECT h3_index, owner_id FROM hexes WHERE h3_index = ANY($1)',
        [capitalList]
      )
      const capitalOwner = new Map(ownedCapitals.rows.map(r => [r.h3_index, r.owner_id]))

      // Country crowns - own a country's capital + enough of its hexes to be its Ruler
      const names = await pool.query('SELECT id, username FROM players')
      const nameOf = new Map(names.rows.map(r => [r.id, r.username]))
      const crowns = await pool.query('SELECT country, player_id FROM country_crowns')
      const crownOf = new Map(crowns.rows.map(r => [r.country, r.player_id]))
      for (const [capHex, country] of CAPITAL_COUNTRY) {
        const owner = capitalOwner.get(capHex) || null
        const count = owner ? (playerCountry.get(owner)?.get(country) || 0) : 0
        const qualified = owner && !isWild(nameOf.get(owner)) && count >= CROWN_MIN_HEXES
        const holder = crownOf.get(country) || null
        if (qualified && holder !== owner) {
          await pool.query(
            `INSERT INTO country_crowns (country, player_id, crowned_at) VALUES ($1,$2,NOW())
             ON CONFLICT (country) DO UPDATE SET player_id=$2, crowned_at=NOW()`,
            [country, owner]
          )
          insertWorldEvent('crown', `${nameOf.get(owner)} has been crowned Ruler of ${country}!`, capHex, owner)
          insertEvent(owner, 'crown', `You have been crowned Ruler of ${country}!`, capHex)
        } else if (!qualified && holder) {
          await pool.query('DELETE FROM country_crowns WHERE country=$1', [country])
          insertWorldEvent('crown_lost', `The throne of ${country} sits empty - ${nameOf.get(holder) || 'its ruler'} has been deposed.`, capHex, holder)
        }
      }
    }

    await pool.query(`
      UPDATE players p SET
        gold = LEAST(p.gold, $1 + COALESCE(s.hex_count, 0) * $2 + COALESCE(s.mine_count, 0) * $3)
      FROM (
        SELECT p2.id,
          COUNT(DISTINCT h.h3_index)::int AS hex_count,
          COUNT(DISTINCT CASE WHEN b.type='mine' THEN b.id END)::int AS mine_count
        FROM players p2
        LEFT JOIN hexes h ON h.owner_id = p2.id
        LEFT JOIN buildings b ON b.h3_index = h.h3_index
        GROUP BY p2.id
      ) s
      WHERE p.id = s.id
    `, [GOLD_CAP_BASE, GOLD_CAP_PER_HEX, GOLD_CAP_PER_MINE])
    getIO()?.emit('tick')
  } catch (err) {
    console.error('[tick] Resource error:', err.message)
  }
}

// Troops finishing training on a hex under active siege join the defense
// instead of sitting in the plain `troops` table, uninvolved, until the
// end-of-battle cleanup wipes them out regardless of who wins.
async function deliverTrainedTroops(ownerId, hexIndex, type, quantity) {
  const battle = await getActiveBattle(hexIndex)
  if (battle) {
    await reinforceBattle(battle, ownerId, 'defender', type, quantity)
    getIO()?.emit('battle:update')
  } else {
    await depositTroops(ownerId, hexIndex, type, quantity)
  }
}

export async function processTraining() {
  try {
    const jobs = await pool.query(
      'SELECT t.*, h.rally_hex FROM training_queue t LEFT JOIN hexes h ON h.h3_index = t.h3_index'
    )
    let deposited = false

    for (const job of jobs.rows) {
      const now = Date.now()
      const completesAt = new Date(job.completes_at).getTime()
      const hasRally = job.rally_hex && job.rally_hex !== job.h3_index

      if (now < completesAt) {
        // Incremental delivery: each soldier joins the garrison as it finishes
        // training. Rally batches are held back so they march together.
        if (hasRally) continue
        const start = new Date(job.started_at).getTime()
        const total = completesAt - start
        const progress = total > 0 ? Math.max(0, (now - start) / total) : 0
        const finished = Math.min(job.quantity, Math.floor(progress * job.quantity))
        const delta = finished - (job.delivered || 0)
        if (delta > 0) {
          await deliverTrainedTroops(job.owner_id, job.h3_index, job.type, delta)
          await pool.query('UPDATE training_queue SET delivered=$1 WHERE id=$2', [finished, job.id])
          deposited = true
        }
        continue
      }

      // Batch complete
      await pool.query('DELETE FROM training_queue WHERE id=$1', [job.id])

      if (hasRally) {
        // Auto-dispatch the whole batch to the rally point
        const stats = TROOP_STATS[job.type] || TROOP_STATS.troop
        const dist = Math.max(1, gridDistance(job.h3_index, job.rally_hex))
        const multiplier = isOcean(job.rally_hex) ? OCEAN_MARCH_MULTIPLIER : 1
        const arrivesAt = new Date(Date.now() + dist * stats.marchMinutesPerHex * multiplier * 60 * 1000)
        await pool.query(
          'INSERT INTO armies (owner_id, from_hex, to_hex, type, quantity, arrives_at, departed_at) VALUES ($1,$2,$3,$4,$5,$6,NOW())',
          [job.owner_id, job.h3_index, job.rally_hex, job.type, job.quantity, arrivesAt]
        )
        getIO()?.emit('armies:update')
        await insertEvent(job.owner_id, 'training_complete', `${job.quantity} troops marching to rally point`, job.h3_index)
        log(`[training] ${job.quantity} troops auto-marching to rally ${job.rally_hex}`)
      } else {
        const remaining = job.quantity - (job.delivered || 0)
        if (remaining > 0) {
          await deliverTrainedTroops(job.owner_id, job.h3_index, job.type, remaining)
          deposited = true
        }
        await insertEvent(job.owner_id, 'training_complete', `${job.quantity} troops finished training at ${job.h3_index}`, job.h3_index)
        log(`[training] ${job.quantity} troops ready at ${job.h3_index}`)
      }
    }

    // Tell clients the garrisons changed so counts update live
    if (deposited) {
      getIO()?.emit('hexes:update')
      getIO()?.emit('armies:update')
    }
  } catch (err) {
    console.error('[training] Error:', err.message)
  }
}

async function depositTroops(ownerId, hexIndex, type, quantity, client = pool) {
  await client.query(`
    INSERT INTO troops (owner_id, h3_index, type, quantity)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (owner_id, h3_index, type)
    DO UPDATE SET quantity = troops.quantity + EXCLUDED.quantity
  `, [ownerId, hexIndex, type, quantity])
}

// Reinforcements land in reserve, not the frontline directly - they'll cycle
// into the fight as clashes refill the frontline from reserve, same as
// everyone else already committed. The defender's bonus (forts/entrenchment/
// strategic) is applied fresh each clash from current frontline size, not
// baked into a cumulative number here, so it doesn't need special-casing on
// arrival the way the old strength-pool model did.
async function reinforceBattle(battle, ownerId, side, type, quantity, client = pool) {
  const col = side === 'attacker' ? 'attacker' : 'defender'
  await client.query(
    `UPDATE battles SET ${col}_reserve = ${col}_reserve + $1, ${col}_troops = ${col}_troops + $1 WHERE id=$2`,
    [quantity, battle.id]
  )
  await client.query(
    'INSERT INTO battle_participants (battle_id, player_id, side, troop_type, quantity) VALUES ($1,$2,$3,$4,$5)',
    [battle.id, ownerId, side, type, quantity]
  )
  return quantity
}

async function getActiveBattle(hexIndex, client = pool) {
  const res = await client.query("SELECT * FROM battles WHERE h3_index=$1 AND status='active'", [hexIndex])
  return res.rows[0] || null
}

export async function processCombat() {
  let arrived
  try {
    arrived = await pool.query(
      "SELECT id FROM armies WHERE arrives_at <= NOW() AND status='marching'"
    )
  } catch (err) {
    console.error('[combat] Error:', err.message)
    return
  }

  for (const row of arrived.rows) {
    // Deferred until the transaction below commits - a rollback (lock
    // contention, a query error) must not fire sockets/events/pushes for a
    // state change that never actually happened.
    const afterCommit = []
    try {
      await withTransaction(async (tx) => {
        // Locking (not skipping): if an overlapping processCombat run already
        // has this army locked, wait for it - once unblocked, the re-check on
        // status='marching' below correctly yields nothing if that other run
        // already finished processing this same arrival.
        const armyRes = await tx.query(
          "SELECT * FROM armies WHERE id=$1 AND status='marching' FOR UPDATE", [row.id]
        )
        const army = armyRes.rows[0]
        if (!army) return

        // Lock the hex row so two armies landing on it in the same pass (or
        // a concurrent processBattleRounds resolution) serialize instead of
        // both reading the same pre-update owner_id.
        const hexResult = await tx.query('SELECT owner_id FROM hexes WHERE h3_index=$1 FOR UPDATE', [army.to_hex])
        const targetHex = hexResult.rows[0]

        // A battle already raging at this hex takes priority over the normal
        // own/ally/unclaimed/enemy routing below - the owner or an ally
        // sending help is a reinforcement, not a deposit that gets silently
        // wiped out by the DELETE FROM troops when the battle resolves.
        // Blocking (not SKIP LOCKED) so that if processBattleRounds is mid-
        // resolution we wait for it and see the true post-resolution state.
        const existingBattle = await tx.query(
          "SELECT * FROM battles WHERE h3_index=$1 AND status='active' FOR UPDATE", [army.to_hex]
        )

        if (existingBattle.rows[0]) {
          const battle = existingBattle.rows[0]
          let side
          if (army.owner_id === battle.attacker_id) side = 'attacker'
          else if (army.owner_id === battle.defender_id) side = 'defender'
          else if (await sameAlliance(army.owner_id, battle.defender_id, tx)) side = 'defender'
          else side = 'attacker' // unaffiliated third party joins the attacker

          await reinforceBattle(battle, army.owner_id, side, army.type, army.quantity, tx)
          await tx.query("UPDATE armies SET status='in_battle' WHERE id=$1", [army.id])
          afterCommit.push(() => {
            getIO()?.emit('battle:update')
            getIO()?.emit('armies:update')
            log(`[battle] reinforcement joined battle ${battle.id} as ${side} (+${army.quantity} troops to reserve)`)
          })

        } else if (targetHex?.owner_id === army.owner_id) {
          // Own hex - deposit troops
          await depositTroops(army.owner_id, army.to_hex, army.type, army.quantity, tx)
          await tx.query("UPDATE armies SET status='arrived' WHERE id=$1", [army.id])
          afterCommit.push(() => {
            getIO()?.emit('armies:update')
            getIO()?.emit('hexes:update')
            log(`[combat] ${army.owner_id} reinforced own hex ${army.to_hex}`)
          })

        } else if (!targetHex || !targetHex.owner_id) {
          // Unclaimed hex - troops always deposit, but only auto-claim once
          // MIN_TROOPS_TO_CLAIM have actually accumulated here. This is the
          // same bar the manual "Claim Territory" button enforces - without
          // it, marching even a single troop onto empty land silently
          // auto-claimed it here, bypassing that check entirely.
          await depositTroops(army.owner_id, army.to_hex, army.type, army.quantity, tx)
          let claimed = false
          if (!isOcean(army.to_hex)) {
            const totalRes = await tx.query(
              'SELECT COALESCE(SUM(quantity), 0)::int AS qty FROM troops WHERE owner_id=$1 AND h3_index=$2',
              [army.owner_id, army.to_hex]
            )
            if (totalRes.rows[0].qty >= MIN_TROOPS_TO_CLAIM) {
              await tx.query(
                'INSERT INTO hexes (h3_index, owner_id, claimed_at) VALUES ($1,$2,NOW()) ON CONFLICT (h3_index) DO UPDATE SET owner_id=$2, claimed_at=NOW()',
                [army.to_hex, army.owner_id]
              )
              claimed = true
            }
          }
          await tx.query("UPDATE armies SET status='arrived' WHERE id=$1", [army.id])
          afterCommit.push(() => {
            if (claimed) {
              getIO()?.emit('hexes:update')
              log(`[combat] ${army.owner_id} auto-claimed ${army.to_hex}`)
            }
            getIO()?.emit('armies:update')
          })

        } else if (await sameAlliance(army.owner_id, targetHex.owner_id, tx)) {
          // Ally's hex - reinforce their defense instead of attacking
          await depositTroops(army.owner_id, army.to_hex, army.type, army.quantity, tx)
          await tx.query("UPDATE armies SET status='arrived' WHERE id=$1", [army.id])
          afterCommit.push(() => {
            getIO()?.emit('armies:update')
            getIO()?.emit('hexes:update')
            log(`[combat] ${army.owner_id} reinforced ally hex ${army.to_hex}`)
          })

        } else {
          // Enemy hex, no battle yet - attack strength is simply troop count
          const attackStr = army.quantity

          const defenders = await tx.query(
            'SELECT type, quantity FROM troops WHERE h3_index=$1', [army.to_hex]
          )
          const fortsRes = await tx.query(
            "SELECT COUNT(*) AS cnt FROM buildings WHERE h3_index=$1 AND type='fort' AND EXTRACT(EPOCH FROM NOW()) - EXTRACT(EPOCH FROM created_at) >= $2",
            [army.to_hex, BUILDING_TIME_SECONDS]
          )
          const forts = Number(fortsRes.rows[0]?.cnt || 0)
          const strategicAdvantage = STRATEGIC_HEXES.has(army.to_hex) ? STRATEGIC_ADVANTAGE_TROOPS : 0
          // Entrenchment - compact borders defend better
          const neighbors = gridDisk(army.to_hex, 1).filter(h => h !== army.to_hex)
          const friendly = await tx.query(
            'SELECT COUNT(*)::int AS cnt FROM hexes WHERE h3_index = ANY($1) AND owner_id=$2',
            [neighbors, targetHex.owner_id]
          )
          const advantagedDefenders = advantagedDefenderCount({
            forts,
            fortAdvantage: FORT_ADVANTAGE_TROOPS,
            strategicAdvantage,
            friendlyNeighbors: friendly.rows[0].cnt,
            entrenchAdvantagePerNeighbor: ENTRENCH_ADVANTAGE_PER_NEIGHBOR,
            entrenchMaxNeighbors: ENTRENCH_MAX_NEIGHBORS,
          })
          const defTroopCount = defenders.rows.reduce((s, t) => s + t.quantity, 0)

          if (defTroopCount === 0) {
            // No defenders - take hex directly
            const prevOwnerId = targetHex.owner_id
            await tx.query(
              'UPDATE hexes SET owner_id=$1, claimed_at=NOW() WHERE h3_index=$2',
              [army.owner_id, army.to_hex]
            )
            await depositTroops(army.owner_id, army.to_hex, army.type, army.quantity, tx)
            await tx.query("UPDATE armies SET status='arrived' WHERE id=$1", [army.id])
            afterCommit.push(() => {
              if (prevOwnerId) {
                insertEvent(prevOwnerId, 'hex_lost', `Your hex ${army.to_hex} was captured unopposed`, army.to_hex)
              }
              getIO()?.emit('hexes:update')
              getIO()?.emit('armies:update')
              log(`[combat] ${army.to_hex} taken unopposed`)
            })
          } else {
            const atkFrontline = Math.min(FRONTLINE_CAP, attackStr)
            const atkReserve = attackStr - atkFrontline
            const defFrontline = Math.min(FRONTLINE_CAP, defTroopCount)
            const defReserve = defTroopCount - defFrontline

            const battleRes = await tx.query(
              `INSERT INTO battles (
                 h3_index, attacker_id, defender_id, defender_advantage_troops,
                 attacker_troops, defender_troops,
                 attacker_frontline, attacker_reserve, defender_frontline, defender_reserve,
                 attacker_strength, defender_strength
               )
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
              [army.to_hex, army.owner_id, targetHex.owner_id, advantagedDefenders,
               attackStr, defTroopCount,
               atkFrontline, atkReserve, defFrontline, defReserve,
               // "strength" is just the real troop count on both sides - the
               // defender's edge is expressed as some of their frontline
               // fighting with advantage, not an inflated number.
               attackStr, defTroopCount]
            )
            const bid = battleRes.rows[0].id
            await tx.query(
              'INSERT INTO battle_participants (battle_id, player_id, side, troop_type, quantity) VALUES ($1,$2,$3,$4,$5)',
              [bid, army.owner_id, 'attacker', army.type, army.quantity]
            )
            for (const t of defenders.rows) {
              await tx.query(
                'INSERT INTO battle_participants (battle_id, player_id, side, troop_type, quantity) VALUES ($1,$2,$3,$4,$5)',
                [bid, targetHex.owner_id, 'defender', t.type, t.quantity]
              )
            }
            await tx.query("UPDATE armies SET status='in_battle' WHERE id=$1", [army.id])

            const defenderInfo = await tx.query('SELECT username FROM players WHERE id=$1', [targetHex.owner_id])
            const defName = defenderInfo.rows[0]?.username
            const defenderId = targetHex.owner_id

            // Warn the defender - reinforcements can still turn the battle
            afterCommit.push(() => {
              if (!isNPC(defName)) {
                insertEvent(defenderId, 'under_attack', `Battle started at your hex - ${attackStr} enemy troops attacking`, army.to_hex)
                sendPush(defenderId, 'You are under attack!', `${attackStr} enemy troops are assaulting your territory. Send reinforcements!`, { hex: army.to_hex })
              }
              getIO()?.emit('battle:update')
              getIO()?.emit('armies:update')
              log(`[battle] started at ${army.to_hex}: ${attackStr} atk vs ${defTroopCount} def (${advantagedDefenders} defenders rolling with advantage)`)
            })
          }
        }
      })
    } catch (err) {
      console.error('[combat] Error processing army', row.id, ':', err.message)
      continue
    }
    for (const fn of afterCommit) fn()
  }
}

// Battle rounds process on one shared interval for every active battle, not
// individually per battle - expose when that interval actually next fires so
// the client can show a real countdown instead of guessing from a single
// battle's own last_round_at (which drifts from the shared clock).
export let nextBattleRoundAt = Date.now() + BATTLE_INTERVAL_MS

export async function processBattleRounds() {
  nextBattleRoundAt = Date.now() + BATTLE_INTERVAL_MS
  let active
  try {
    active = await pool.query("SELECT id FROM battles WHERE status='active'")
  } catch (err) {
    console.error('[battle] Error:', err.message)
    return
  }

  for (const row of active.rows) {
    const afterCommit = []
    try {
      await withTransaction(async (tx) => {
        // Locking: an overlapping processBattleRounds run (interval fired again
        // before this one finished) must not resolve the same clash twice -
        // wait for the other run's lock, then the status='active' re-check
        // below yields nothing if it already resolved this battle.
        const battleRes = await tx.query(
          "SELECT * FROM battles WHERE id=$1 AND status='active' FOR UPDATE", [row.id]
        )
        const battle = battleRes.rows[0]
        if (!battle) return

        const advantagedDefenders = Number(battle.defender_advantage_troops)
        const result = resolveBattleClash({
          atkFrontline: Number(battle.attacker_frontline),
          atkReserve: Number(battle.attacker_reserve),
          defFrontline: Number(battle.defender_frontline),
          defReserve: Number(battle.defender_reserve),
        }, advantagedDefenders, Math.random)

        const atkTotal = result.atkFrontline + result.atkReserve
        const defTotal = result.defFrontline + result.defReserve

        // Debugging log: the actual dice rolled for this clash, independent of
        // the battle's own running totals - lets a disputed outcome ("why did
        // the defender never lose") be inspected exactly via the admin panel
        // instead of re-derived from aggregates. See routes/admin.js.
        await tx.query(
          `INSERT INTO battle_rounds
             (battle_id, round_number, defender_advantage_troops, atk_frontline_before, def_frontline_before,
              atk_dice, def_dice, atk_losses, def_losses, atk_troops_after, def_troops_after)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [battle.id, battle.round_number + 1, advantagedDefenders,
           Number(battle.attacker_frontline), Number(battle.defender_frontline),
           result.atkDice, result.defDice, result.atkLosses, result.defLosses,
           atkTotal, defTotal]
        )

        if (result.over) {
          // Battle over
          const attackerWon = result.attackerWon
          // Total real troop losses for the whole battle, not just this final
          // clash - battle.*_losses is the pre-update cumulative total, so add
          // this round's losses (not yet persisted until the UPDATE below).
          const totalAtkLosses = Number(battle.attacker_losses) + result.atkLosses
          const totalDefLosses = Number(battle.defender_losses) + result.defLosses

          const pNames = await tx.query('SELECT id, username FROM players WHERE id IN ($1, $2)', [battle.attacker_id, battle.defender_id])
          const nameOf = new Map(pNames.rows.map(r => [r.id, r.username]))
          const atkName = nameOf.get(battle.attacker_id)
          const defName = nameOf.get(battle.defender_id)
          const countryName = getCountry(battle.h3_index)?.name || 'the wilds'

          if (attackerWon) {
            await tx.query('DELETE FROM troops WHERE h3_index=$1', [battle.h3_index])
            await tx.query('DELETE FROM buildings WHERE h3_index=$1', [battle.h3_index])
            await tx.query('UPDATE hexes SET owner_id=$1, claimed_at=NOW() WHERE h3_index=$2',
              [battle.attacker_id, battle.h3_index])
            const atkSurvivors = Math.round(atkTotal)
            if (atkSurvivors > 0) await depositTroops(battle.attacker_id, battle.h3_index, 'troop', atkSurvivors, tx)
            afterCommit.push(() => {
              log(atkSurvivors > 0
                ? `[battle] ${battle.id} ATTACKER WINS at ${battle.h3_index} (${atkSurvivors} troops survive)`
                : `[battle] ${battle.id} ATTACKER WINS at ${battle.h3_index} (no survivors)`)
            })
          } else {
            // Defender wins - restore defender remnants
            await tx.query('DELETE FROM troops WHERE h3_index=$1', [battle.h3_index])
            const defSurvivors = Math.round(defTotal)
            if (defSurvivors > 0) await depositTroops(battle.defender_id, battle.h3_index, 'troop', defSurvivors, tx)
            afterCommit.push(() => {
              log(defSurvivors > 0
                ? `[battle] ${battle.id} DEFENDER WINS at ${battle.h3_index} (${defSurvivors} troops survive)`
                : `[battle] ${battle.id} DEFENDER WINS at ${battle.h3_index} (no survivors)`)
            })
          }

          if (attackerWon) {
            // Camp plunder - capturing a Wildlands camp pays out loot
            if (isWild(defName)) {
              await tx.query('UPDATE players SET gold=gold+$1 WHERE id=$2', [CAMP_LOOT_GOLD, battle.attacker_id])
              afterCommit.push(() => insertEvent(battle.attacker_id, 'plunder', `Camp plundered! +${CAMP_LOOT_GOLD} gold`, battle.h3_index))
            }

            const defenderData = await tx.query('SELECT capital_hex FROM players WHERE id=$1', [battle.defender_id])
            const isCapital = defenderData.rows[0]?.capital_hex === battle.h3_index
            if (isCapital) {
              await tx.query(
                'DELETE FROM training_queue WHERE owner_id=$1 AND h3_index=$2',
                [battle.defender_id, battle.h3_index]
              )
              await tx.query('UPDATE players SET capital_hex=NULL WHERE id=$1', [battle.defender_id])
              afterCommit.push(() => {
                insertEvent(battle.defender_id, 'capital_lost', `Your capital has fallen! All is not lost - claim any free hex to found a new capital and rebuild.`, battle.h3_index)
                insertWorldEvent('capital', `${defName}'s capital has fallen to ${atkName}!`, battle.h3_index, battle.attacker_id)
                sendPush(battle.defender_id, 'Your capital has fallen!', 'All is not lost - claim any free hex to found a new capital and rebuild.', { hex: battle.h3_index })
                log(`[battle] ${battle.defender_id} lost their capital at ${battle.h3_index}`)
              })
            } else if (!isWild(defName) && !(isNPC(atkName) && isNPC(defName))) {
              // Routine bot-vs-bot skirmishes are the overwhelming majority of
              // battles once bots are numerous - broadcasting every single one
              // as a world event (each triggering a socket push to every
              // connected client) flooded the Herald and hammered clients with
              // constant re-renders. Only announce when a real player is
              // involved on at least one side; capital falls/crowns/wonders
              // still always announce regardless, below/elsewhere.
              afterCommit.push(() => insertWorldEvent('battle', `${atkName} seized ${countryName} territory from ${defName}`, battle.h3_index, battle.attacker_id))
            }
            afterCommit.push(() => {
              insertEvent(battle.attacker_id, 'battle_won', `Battle won at ${battle.h3_index} (lost ${totalAtkLosses} troops)`, battle.h3_index)
              insertEvent(battle.defender_id, 'battle_lost', `Battle lost at ${battle.h3_index} (lost ${totalDefLosses} troops)`, battle.h3_index)
              insertEvent(battle.defender_id, 'hex_lost', `Your hex ${battle.h3_index} was captured in battle`, battle.h3_index)
            })
          } else {
            if (!isWild(defName) && !isWild(atkName) && !(isNPC(atkName) && isNPC(defName))) {
              afterCommit.push(() => insertWorldEvent('battle', `${defName} repelled ${atkName}'s assault in ${countryName}`, battle.h3_index, battle.defender_id))
            }
            afterCommit.push(() => {
              insertEvent(battle.defender_id, 'battle_won', `Defended ${battle.h3_index} successfully (lost ${totalDefLosses} troops)`, battle.h3_index)
              insertEvent(battle.attacker_id, 'battle_lost', `Attack on ${battle.h3_index} failed (lost ${totalAtkLosses} troops)`, battle.h3_index)
            })
          }

          await tx.query(
            `UPDATE battles SET
               status=$1, ended_at=NOW(),
               attacker_frontline=$2, attacker_reserve=$3, defender_frontline=$4, defender_reserve=$5,
               attacker_troops=$6, defender_troops=$7,
               attacker_strength=$6, defender_strength=$7,
               attacker_losses=attacker_losses+$8, defender_losses=defender_losses+$9
             WHERE id=$10`,
            [attackerWon ? 'attacker_won' : 'defender_won',
             result.atkFrontline, result.atkReserve, result.defFrontline, result.defReserve,
             atkTotal, defTotal,
             result.atkLosses, result.defLosses, battle.id]
          )
          await tx.query("UPDATE armies SET status='arrived' WHERE status='in_battle' AND to_hex=$1", [battle.h3_index])
          afterCommit.push(() => {
            getIO()?.emit('battle:update')
            getIO()?.emit('hexes:update')
            getIO()?.emit('armies:update')
          })

        } else {
          // Battle continues
          await tx.query(`
            UPDATE battles SET
              attacker_frontline=$1, attacker_reserve=$2, defender_frontline=$3, defender_reserve=$4,
              attacker_troops=$5, defender_troops=$6,
              attacker_strength=$5, defender_strength=$6,
              attacker_losses=attacker_losses+$7, defender_losses=defender_losses+$8,
              round_number=round_number+1, last_round_at=NOW()
            WHERE id=$9
          `, [result.atkFrontline, result.atkReserve, result.defFrontline, result.defReserve,
              atkTotal, defTotal,
              result.atkLosses, result.defLosses, battle.id])
          afterCommit.push(() => {
            getIO()?.emit('battle:update')
            log(`[battle] clash ${battle.round_number + 1} at ${battle.h3_index}: ${atkTotal.toFixed(0)} vs ${defTotal.toFixed(0)} (-${result.atkLosses} atk, -${result.defLosses} def)`)
          })
        }
      })
    } catch (err) {
      console.error('[battle] Error processing battle', row.id, ':', err.message)
      continue
    }
    for (const fn of afterCommit) fn()
  }
}

export async function processUpgrades() {
  try {
    const done = await pool.query('SELECT * FROM upgrade_queue WHERE completes_at <= NOW()')
    for (const job of done.rows) {
      await pool.query('UPDATE hexes SET upgrade_level=upgrade_level+1 WHERE h3_index=$1', [job.h3_index])
      await pool.query('DELETE FROM upgrade_queue WHERE id=$1', [job.id])
      const newLevel = await pool.query('SELECT upgrade_level FROM hexes WHERE h3_index=$1', [job.h3_index])
      log(`[upgrade] ${job.h3_index} upgraded to level ${newLevel.rows[0]?.upgrade_level ?? '?'}`)
    }
  } catch (err) {
    console.error('[upgrade] Error:', err.message)
  }
}

// Border decay - sprawling empires shed unguarded, undeveloped border hexes.
// Garrison troops, build something, or accept the frontier slipping away.
export async function processDecay() {
  try {
    const big = await pool.query(`
      SELECT p.id, p.username, p.capital_hex, COUNT(h.h3_index)::int AS hex_count
      FROM players p JOIN hexes h ON h.owner_id = p.id
      WHERE p.username NOT LIKE 'WILD_%'
      GROUP BY p.id
      HAVING COUNT(h.h3_index) > $1
    `, [DECAY_HEX_THRESHOLD])

    let anyLost = false
    for (const player of big.rows) {
      // Required garrison rises with empire size - a token 1-troop garrison
      // only stays decay-safe for a genuinely small empire (see config.js).
      const requiredGarrison = requiredGarrisonForHexCount(player.hex_count)

      // Candidates: garrison below the required bar, no buildings, not the
      // capital - random sample to bound work
      const cands = await pool.query(`
        SELECT h.h3_index, COALESCE(SUM(t.quantity), 0)::int AS garrison
        FROM hexes h
        LEFT JOIN troops t ON t.h3_index = h.h3_index
        WHERE h.owner_id = $1
          AND h.h3_index IS DISTINCT FROM $2
          AND NOT EXISTS (SELECT 1 FROM buildings b WHERE b.h3_index = h.h3_index)
        GROUP BY h.h3_index
        HAVING COALESCE(SUM(t.quantity), 0) < $3
        ORDER BY RANDOM() LIMIT 30
      `, [player.id, player.capital_hex, requiredGarrison])

      let lost = 0
      for (const { h3_index } of cands.rows) {
        if (lost >= DECAY_MAX_PER_TICK) break
        if (Math.random() > DECAY_CHANCE) continue
        // Only border hexes decay - interior is safe
        const neighbors = gridDisk(h3_index, 1).filter(h => h !== h3_index)
        const owned = await pool.query(
          'SELECT COUNT(*)::int AS cnt FROM hexes WHERE h3_index = ANY($1) AND owner_id=$2',
          [neighbors, player.id]
        )
        if (owned.rows[0].cnt >= neighbors.length) continue
        await pool.query('DELETE FROM hexes WHERE h3_index=$1 AND owner_id=$2', [h3_index, player.id])
        lost++
      }
      if (lost > 0) {
        anyLost = true
        insertEvent(player.id, 'decay', `${lost} border hex${lost > 1 ? 'es' : ''} slipped from your control - at your empire's size, a hex needs ${requiredGarrison}+ troops or a building to hold. Garrison or build to hold the frontier.`)
        log(`[decay] ${player.username} lost ${lost} border hexes (required garrison was ${requiredGarrison})`)
      }
    }
    if (anyLost) getIO()?.emit('hexes:update')
  } catch (err) {
    console.error('[decay] Error:', err.message)
  }
}

export let nextTickAt = Date.now() + TICK_INTERVAL_MS

export async function startTick() {
  console.log(`[tick] Starting resource tick every ${TICK_INTERVAL_MS / 60000} minutes`)

  async function wrappedTick() {
    await runTick()
    await processDecay()
    await processBots()
    nextTickAt = Date.now() + TICK_INTERVAL_MS
  }

  const season = await ensureSeason()
  await ensureWildlands()
  await ensureBots(season?.number)
  wrappedTick()
  setInterval(wrappedTick, TICK_INTERVAL_MS)
  setInterval(processTraining, TRAINING_INTERVAL_MS)
  setInterval(processCombat, COMBAT_INTERVAL_MS)
  setInterval(processBattleRounds, BATTLE_INTERVAL_MS)
  setInterval(processUpgrades, TRAINING_INTERVAL_MS)
  setInterval(processSeason, TRAINING_INTERVAL_MS)
  setInterval(() => processWonders(pool, { announce: insertWorldEvent })
    .then(seized => { if (seized.length > 0) getIO()?.emit('wonder:update') })
    .catch(err => console.error('[wonder] poll failed:', err.message)), COMBAT_INTERVAL_MS)
}

import { pool } from './db.js'
import {
  TICK_INTERVAL_MS, BATTLE_ROUND_DAMAGE_RATE, FORT_DEFENSE_BONUS,
  GOLD_CAP_BASE, GOLD_CAP_PER_HEX, GOLD_CAP_PER_MINE, BUILDING_TIME_SECONDS,
  OCEAN_MARCH_MULTIPLIER, TROOP_STATS,
  ENTRENCH_BONUS_PER_NEIGHBOR, ENTRENCH_MAX_NEIGHBORS,
  CAMP_LOOT_GOLD, CROWN_MIN_HEXES,
  DECAY_HEX_THRESHOLD, DECAY_CHANCE, DECAY_MAX_PER_TICK,
} from './config.js'
import { getIO } from './socket.js'
import { ensureBots, processBots } from './bots.js'
import { ensureWildlands } from './wild.js'
import { ensureSeason, processSeason } from './season.js'
import { gridDistance, gridDisk } from 'h3-js'
import { isOcean } from './terrain.js'
import { sendPush } from './push.js'
import { STRATEGIC_HEXES, STRATEGIC_BONUS_GOLD, STRATEGIC_DEFENSE_BONUS, CAPITAL_COUNTRY } from './strategic.js'
import { getCountry } from './countries.js'

function isNPC(username) {
  return username?.startsWith('BOT_') || username?.startsWith('WILD_')
}

function isWild(username) {
  return username?.startsWith('WILD_')
}

async function insertEvent(playerId, type, message, hexIndex = null) {
  try {
    await pool.query(
      'INSERT INTO events (player_id, type, message, hex_index) VALUES ($1,$2,$3,$4)',
      [playerId, type, message, hexIndex]
    )
    getIO()?.emit('events:new')
  } catch (err) {
    console.error('[event] Failed to insert event:', err.message)
  }
}

// Public newspaper entry - everyone sees these
async function insertWorldEvent(type, message, hexIndex = null, playerId = null) {
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

// Do two players share a (non-null) alliance?
async function sameAlliance(aId, bId) {
  if (!aId || !bId || aId === bId) return false
  try {
    const r = await pool.query('SELECT alliance_id FROM players WHERE id = ANY($1)', [[aId, bId]])
    if (r.rows.length < 2) return false
    return r.rows[0].alliance_id != null && r.rows[0].alliance_id === r.rows[1].alliance_id
  } catch {
    return false
  }
}

const COMBAT_INTERVAL_MS = 15 * 1000
const TRAINING_INTERVAL_MS = 15 * 1000
const BATTLE_INTERVAL_MS = 15 * 1000
const BASE_RATE = { gold: 1 }

export async function runTick() {
  console.log('[tick] Running resource tick...')
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
    console.log(`[tick] Resources updated for ${result.rows.length} players.`)

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
    // Prune rows older than 30 days
    await pool.query("DELETE FROM hex_history WHERE recorded_at < NOW() - INTERVAL '30 days'")

    // Territory income - primary capitals pay 1.1^N bonus where N = owner's hex count in that country
    if (CAPITAL_COUNTRY.size > 0) {
      const allHexes = await pool.query('SELECT h3_index, owner_id FROM hexes')

      // Build: playerId → Map<countryName, count>
      const playerCountry = new Map()
      for (const { h3_index, owner_id } of allHexes.rows) {
        const country = getCountry(h3_index)?.name
        if (!country) continue
        if (!playerCountry.has(owner_id)) playerCountry.set(owner_id, new Map())
        const m = playerCountry.get(owner_id)
        m.set(country, (m.get(country) || 0) + 1)
      }

      // For each owned primary capital, award territory bonus
      const capitalList = Array.from(CAPITAL_COUNTRY.keys())
      const ownedCapitals = await pool.query(
        'SELECT h3_index, owner_id FROM hexes WHERE h3_index = ANY($1)',
        [capitalList]
      )
      const capitalOwner = new Map(ownedCapitals.rows.map(r => [r.h3_index, r.owner_id]))
      for (const { h3_index, owner_id } of ownedCapitals.rows) {
        const country = CAPITAL_COUNTRY.get(h3_index)
        const total = playerCountry.get(owner_id)?.get(country) || 0
        const N = Math.min(Math.max(0, total - 1), 60) // exclude capital, cap at 60 (1.1^60 = 304g)
        const bonus = Math.floor(Math.pow(1.1, N))
        await pool.query('UPDATE players SET gold = gold + $1 WHERE id = $2', [bonus, owner_id])
        if (N > 0) console.log(`[tick] territory: +${bonus}g for ${h3_index} (${country}, N=${N})`)
      }

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
          insertWorldEvent('crown', `👑 ${nameOf.get(owner)} has been crowned Ruler of ${country}!`, capHex, owner)
          insertEvent(owner, 'crown', `👑 You have been crowned Ruler of ${country}!`, capHex)
        } else if (!qualified && holder) {
          await pool.query('DELETE FROM country_crowns WHERE country=$1', [country])
          insertWorldEvent('crown_lost', `🥀 The throne of ${country} sits empty - ${nameOf.get(holder) || 'its ruler'} has been deposed.`, capHex, holder)
        }
      }
    }

    // Enforce gold cap
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

export async function processTraining() {
  try {
    const done = await pool.query('SELECT * FROM training_queue WHERE completes_at <= NOW()')
    for (const job of done.rows) {
      await pool.query('DELETE FROM training_queue WHERE id=$1', [job.id])

      const hexInfo = await pool.query('SELECT rally_hex FROM hexes WHERE h3_index=$1', [job.h3_index])
      const rallyHex = hexInfo.rows[0]?.rally_hex

      if (rallyHex && rallyHex !== job.h3_index) {
        // Auto-dispatch to rally point
        const stats = TROOP_STATS[job.type] || TROOP_STATS.troop
        const dist = Math.max(1, gridDistance(job.h3_index, rallyHex))
        const multiplier = isOcean(rallyHex) ? OCEAN_MARCH_MULTIPLIER : 1
        const arrivesAt = new Date(Date.now() + dist * stats.marchMinutesPerHex * multiplier * 60 * 1000)
        await pool.query(
          'INSERT INTO armies (owner_id, from_hex, to_hex, type, quantity, arrives_at, departed_at) VALUES ($1,$2,$3,$4,$5,$6,NOW())',
          [job.owner_id, job.h3_index, rallyHex, job.type, job.quantity, arrivesAt]
        )
        getIO()?.emit('armies:update')
        await insertEvent(job.owner_id, 'training_complete', `✅ ${job.quantity} troops marching to rally point`, job.h3_index)
        console.log(`[training] ${job.quantity} troops auto-marching to rally ${rallyHex}`)
      } else {
        await pool.query(`
          INSERT INTO troops (owner_id, h3_index, type, quantity)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (owner_id, h3_index, type)
          DO UPDATE SET quantity = troops.quantity + EXCLUDED.quantity
        `, [job.owner_id, job.h3_index, job.type, job.quantity])
        await insertEvent(job.owner_id, 'training_complete', `✅ ${job.quantity} troops finished training at ${job.h3_index}`, job.h3_index)
        console.log(`[training] ${job.quantity} troops ready at ${job.h3_index}`)
      }
    }
  } catch (err) {
    console.error('[training] Error:', err.message)
  }
}

async function depositTroops(ownerId, hexIndex, type, quantity) {
  await pool.query(`
    INSERT INTO troops (owner_id, h3_index, type, quantity)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (owner_id, h3_index, type)
    DO UPDATE SET quantity = troops.quantity + EXCLUDED.quantity
  `, [ownerId, hexIndex, type, quantity])
}

export async function processCombat() {
  try {
    const arrived = await pool.query(
      "SELECT * FROM armies WHERE arrives_at <= NOW() AND status='marching'"
    )

    for (const army of arrived.rows) {
      const hexResult = await pool.query('SELECT owner_id FROM hexes WHERE h3_index=$1', [army.to_hex])
      const targetHex = hexResult.rows[0]

      if (targetHex?.owner_id === army.owner_id) {
        // Own hex - deposit troops
        await depositTroops(army.owner_id, army.to_hex, army.type, army.quantity)
        await pool.query("UPDATE armies SET status='arrived' WHERE id=$1", [army.id])
        console.log(`[combat] ${army.owner_id} reinforced own hex ${army.to_hex}`)

      } else if (!targetHex || !targetHex.owner_id) {
        // Unclaimed hex - deposit troops and auto-claim if it's land
        await depositTroops(army.owner_id, army.to_hex, army.type, army.quantity)
        if (!isOcean(army.to_hex)) {
          await pool.query(
            'INSERT INTO hexes (h3_index, owner_id, claimed_at) VALUES ($1,$2,NOW()) ON CONFLICT (h3_index) DO UPDATE SET owner_id=$2, claimed_at=NOW()',
            [army.to_hex, army.owner_id]
          )
          getIO()?.emit('hexes:update')
          console.log(`[combat] ${army.owner_id} auto-claimed ${army.to_hex}`)
        }
        await pool.query("UPDATE armies SET status='arrived' WHERE id=$1", [army.id])

      } else if (await sameAlliance(army.owner_id, targetHex.owner_id)) {
        // Ally's hex - reinforce their defense instead of attacking
        await depositTroops(army.owner_id, army.to_hex, army.type, army.quantity)
        await pool.query("UPDATE armies SET status='arrived' WHERE id=$1", [army.id])
        getIO()?.emit('armies:update')
        console.log(`[combat] ${army.owner_id} reinforced ally hex ${army.to_hex}`)

      } else {
        // Enemy hex - attack strength is simply troop count
        const attackStr = army.quantity

        const existingBattle = await pool.query(
          "SELECT * FROM battles WHERE h3_index=$1 AND status='active'", [army.to_hex]
        )

        if (existingBattle.rows[0]) {
          // Join existing battle as reinforcement
          const battle = existingBattle.rows[0]
          let side
          if (army.owner_id === battle.attacker_id) side = 'attacker'
          else if (army.owner_id === battle.defender_id) side = 'defender'
          else if (await sameAlliance(army.owner_id, battle.defender_id)) side = 'defender'
          else side = 'attacker' // unaffiliated third party joins the attacker

          const col = side === 'attacker' ? 'attacker_strength' : 'defender_strength'
          await pool.query(`UPDATE battles SET ${col}=${col}+$1 WHERE id=$2`, [army.quantity, battle.id])
          await pool.query(
            'INSERT INTO battle_participants (battle_id, player_id, side, troop_type, quantity) VALUES ($1,$2,$3,$4,$5)',
            [battle.id, army.owner_id, side, army.type, army.quantity]
          )
          await pool.query("UPDATE armies SET status='in_battle' WHERE id=$1", [army.id])
          getIO()?.emit('battle:update')
          getIO()?.emit('armies:update')
          console.log(`[battle] reinforcement joined battle ${battle.id} as ${side} (+${army.quantity} str)`)

        } else {
          // Start new battle
          const defenders = await pool.query(
            'SELECT type, quantity FROM troops WHERE h3_index=$1', [army.to_hex]
          )
          const fortsRes = await pool.query(
            "SELECT COUNT(*) AS cnt FROM buildings WHERE h3_index=$1 AND type='fort' AND EXTRACT(EPOCH FROM (NOW() - created_at)) >= $2",
            [army.to_hex, BUILDING_TIME_SECONDS]
          )
          const forts = Number(fortsRes.rows[0]?.cnt || 0)
          const strategicBonus = STRATEGIC_HEXES.has(army.to_hex) ? STRATEGIC_DEFENSE_BONUS : 0
          // Entrenchment - compact borders defend better
          const neighbors = gridDisk(army.to_hex, 1).filter(h => h !== army.to_hex)
          const friendly = await pool.query(
            'SELECT COUNT(*)::int AS cnt FROM hexes WHERE h3_index = ANY($1) AND owner_id=$2',
            [neighbors, targetHex.owner_id]
          )
          const entrench = Math.min(friendly.rows[0].cnt, ENTRENCH_MAX_NEIGHBORS) * ENTRENCH_BONUS_PER_NEIGHBOR
          const defMultiplier = 1 + forts * FORT_DEFENSE_BONUS + strategicBonus + entrench
          const defStr = defenders.rows.reduce((s, t) => s + t.quantity, 0) * defMultiplier

          if (defStr === 0) {
            // No defenders - take hex directly
            const prevOwner = await pool.query('SELECT owner_id FROM hexes WHERE h3_index=$1', [army.to_hex])
            await pool.query(
              'UPDATE hexes SET owner_id=$1, claimed_at=NOW() WHERE h3_index=$2',
              [army.owner_id, army.to_hex]
            )
            await depositTroops(army.owner_id, army.to_hex, army.type, army.quantity)
            await pool.query("UPDATE armies SET status='arrived' WHERE id=$1", [army.id])
            if (prevOwner.rows[0]?.owner_id) {
              await insertEvent(prevOwner.rows[0].owner_id, 'hex_lost', `💀 Your hex ${army.to_hex} was captured unopposed`, army.to_hex)
            }
            getIO()?.emit('hexes:update')
            getIO()?.emit('armies:update')
            console.log(`[combat] ${army.to_hex} taken unopposed`)
          } else {
            const battle = await pool.query(
              `INSERT INTO battles (h3_index, attacker_id, defender_id, attacker_strength, defender_strength)
               VALUES ($1,$2,$3,$4,$5) RETURNING *`,
              [army.to_hex, army.owner_id, targetHex.owner_id, attackStr, defStr]
            )
            const bid = battle.rows[0].id
            await pool.query(
              'INSERT INTO battle_participants (battle_id, player_id, side, troop_type, quantity) VALUES ($1,$2,$3,$4,$5)',
              [bid, army.owner_id, 'attacker', army.type, army.quantity]
            )
            for (const t of defenders.rows) {
              await pool.query(
                'INSERT INTO battle_participants (battle_id, player_id, side, troop_type, quantity) VALUES ($1,$2,$3,$4,$5)',
                [bid, targetHex.owner_id, 'defender', t.type, t.quantity]
              )
            }
            await pool.query("UPDATE armies SET status='in_battle' WHERE id=$1", [army.id])

            // Warn the defender - reinforcements can still turn the battle
            const defenderInfo = await pool.query('SELECT username FROM players WHERE id=$1', [targetHex.owner_id])
            const defName = defenderInfo.rows[0]?.username
            if (!isNPC(defName)) {
              insertEvent(targetHex.owner_id, 'under_attack', `🔥 Battle started at your hex - ${attackStr} enemy troops attacking`, army.to_hex)
              sendPush(targetHex.owner_id, '🔥 You are under attack!', `${attackStr} enemy troops are assaulting your territory. Send reinforcements!`, { hex: army.to_hex })
            }

            getIO()?.emit('battle:update')
            getIO()?.emit('armies:update')
            console.log(`[battle] started at ${army.to_hex}: ${attackStr} atk vs ${defStr.toFixed(1)} def`)
          }
        }
      }
    }
  } catch (err) {
    console.error('[combat] Error:', err.message)
  }
}

export async function processBattleRounds() {
  try {
    const active = await pool.query("SELECT * FROM battles WHERE status='active'")

    for (const battle of active.rows) {
      const atkStr = Number(battle.attacker_strength)
      const defStr = Number(battle.defender_strength)

      const atkDmg = atkStr * BATTLE_ROUND_DAMAGE_RATE
      const defDmg = defStr * BATTLE_ROUND_DAMAGE_RATE

      const newAtkStr = Math.max(0, atkStr - defDmg)
      const newDefStr = Math.max(0, defStr - atkDmg)

      if (newAtkStr <= 0 || newDefStr <= 0) {
        // Battle over
        const attackerWon = newAtkStr > newDefStr

        const pNames = await pool.query('SELECT id, username FROM players WHERE id = ANY($1)', [[battle.attacker_id, battle.defender_id]])
        const nameOf = new Map(pNames.rows.map(r => [r.id, r.username]))
        const atkName = nameOf.get(battle.attacker_id)
        const defName = nameOf.get(battle.defender_id)
        const countryName = getCountry(battle.h3_index)?.name || 'the wilds'

        if (attackerWon) {
          await pool.query('DELETE FROM troops WHERE h3_index=$1', [battle.h3_index])
          await pool.query('DELETE FROM buildings WHERE h3_index=$1', [battle.h3_index])
          await pool.query('UPDATE hexes SET owner_id=$1, claimed_at=NOW() WHERE h3_index=$2',
            [battle.attacker_id, battle.h3_index])
          if (newAtkStr > 0) {
            const atk = await pool.query(
              "SELECT SUM(quantity) AS qty FROM battle_participants WHERE battle_id=$1 AND side='attacker'",
              [battle.id]
            )
            const totalAtkQty = Number(atk.rows[0]?.qty || 0)
            const survivalRate = totalAtkQty > 0 ? newAtkStr / atkStr : 0
            const survivors = Math.round(totalAtkQty * survivalRate)
            if (survivors > 0) {
              await depositTroops(battle.attacker_id, battle.h3_index, 'troop', survivors)
              console.log(`[battle] ${battle.id} ATTACKER WINS at ${battle.h3_index} (${survivors} troops survive)`)
            }
          } else {
            console.log(`[battle] ${battle.id} ATTACKER WINS at ${battle.h3_index} (no survivors)`)
          }
        } else {
          // Defender wins - restore defender remnants
          await pool.query('DELETE FROM troops WHERE h3_index=$1', [battle.h3_index])
          if (newDefStr > 0) {
            const def = await pool.query(
              "SELECT SUM(quantity) AS qty FROM battle_participants WHERE battle_id=$1 AND side='defender'",
              [battle.id]
            )
            const totalDefQty = Number(def.rows[0]?.qty || 0)
            const survivalRate = totalDefQty > 0 ? newDefStr / defStr : 0
            const survivors = Math.round(totalDefQty * survivalRate)
            if (survivors > 0) {
              await depositTroops(battle.defender_id, battle.h3_index, 'troop', survivors)
              console.log(`[battle] ${battle.id} DEFENDER WINS at ${battle.h3_index} (${survivors} troops survive)`)
            }
          } else {
            console.log(`[battle] ${battle.id} DEFENDER WINS at ${battle.h3_index} (no survivors)`)
          }
        }

        if (attackerWon) {
          // Camp plunder - capturing a Wildlands camp pays out loot
          if (isWild(defName)) {
            await pool.query('UPDATE players SET gold=gold+$1 WHERE id=$2', [CAMP_LOOT_GOLD, battle.attacker_id])
            await insertEvent(battle.attacker_id, 'plunder', `💰 Camp plundered! +${CAMP_LOOT_GOLD} gold`, battle.h3_index)
          }

          const defenderData = await pool.query('SELECT capital_hex FROM players WHERE id=$1', [battle.defender_id])
          const isCapital = defenderData.rows[0]?.capital_hex === battle.h3_index
          if (isCapital) {
            await pool.query(
              'DELETE FROM training_queue WHERE owner_id=$1 AND h3_index=$2',
              [battle.defender_id, battle.h3_index]
            )
            await pool.query('UPDATE players SET capital_hex=NULL WHERE id=$1', [battle.defender_id])
            await insertEvent(battle.defender_id, 'capital_lost', `👑 Your capital has fallen! All is not lost - claim any free hex to found a new capital and rebuild.`, battle.h3_index)
            insertWorldEvent('capital', `🔥 ${defName}'s capital has fallen to ${atkName}!`, battle.h3_index, battle.attacker_id)
            sendPush(battle.defender_id, '👑 Your capital has fallen!', 'All is not lost - claim any free hex to found a new capital and rebuild.', { hex: battle.h3_index })
            console.log(`[battle] ${battle.defender_id} lost their capital at ${battle.h3_index}`)
          } else if (!isWild(defName)) {
            insertWorldEvent('battle', `⚔️ ${atkName} seized ${countryName} territory from ${defName}`, battle.h3_index, battle.attacker_id)
          }
          await insertEvent(battle.attacker_id, 'battle_won', `🏆 Battle won at ${battle.h3_index}`, battle.h3_index)
          await insertEvent(battle.defender_id, 'battle_lost', `☠ Battle lost at ${battle.h3_index}`, battle.h3_index)
          await insertEvent(battle.defender_id, 'hex_lost', `💀 Your hex ${battle.h3_index} was captured in battle`, battle.h3_index)
        } else {
          if (!isWild(defName) && !isWild(atkName)) {
            insertWorldEvent('battle', `🛡 ${defName} repelled ${atkName}'s assault in ${countryName}`, battle.h3_index, battle.defender_id)
          }
          await insertEvent(battle.defender_id, 'battle_won', `🏆 Defended ${battle.h3_index} successfully`, battle.h3_index)
          await insertEvent(battle.attacker_id, 'battle_lost', `☠ Attack on ${battle.h3_index} failed`, battle.h3_index)
        }

        await pool.query(
          "UPDATE battles SET status=$1, ended_at=NOW(), attacker_strength=$2, defender_strength=$3 WHERE id=$4",
          [attackerWon ? 'attacker_won' : 'defender_won', newAtkStr, newDefStr, battle.id]
        )
        await pool.query("UPDATE armies SET status='arrived' WHERE status='in_battle' AND to_hex=$1", [battle.h3_index])
        getIO()?.emit('battle:update')
        getIO()?.emit('hexes:update')
        getIO()?.emit('armies:update')

      } else {
        // Battle continues
        await pool.query(`
          UPDATE battles SET
            attacker_strength=$1, defender_strength=$2,
            attacker_losses=attacker_losses+$3, defender_losses=defender_losses+$4,
            round_number=round_number+1, last_round_at=NOW()
          WHERE id=$5
        `, [newAtkStr, newDefStr, defDmg, atkDmg, battle.id])
        console.log(`[battle] round ${battle.round_number + 1} at ${battle.h3_index}: ${newAtkStr.toFixed(1)} vs ${newDefStr.toFixed(1)}`)
      }
    }
  } catch (err) {
    console.error('[battle] Error:', err.message)
  }
}

export async function processUpgrades() {
  try {
    const done = await pool.query('SELECT * FROM upgrade_queue WHERE completes_at <= NOW()')
    for (const job of done.rows) {
      await pool.query('UPDATE hexes SET upgrade_level=upgrade_level+1 WHERE h3_index=$1', [job.h3_index])
      await pool.query('DELETE FROM upgrade_queue WHERE id=$1', [job.id])
      const newLevel = await pool.query('SELECT upgrade_level FROM hexes WHERE h3_index=$1', [job.h3_index])
      console.log(`[upgrade] ${job.h3_index} upgraded to level ${newLevel.rows[0]?.upgrade_level ?? '?'}`)
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
      // Candidates: no garrison, no buildings, not the capital - random sample to bound work
      const cands = await pool.query(`
        SELECT h.h3_index FROM hexes h
        WHERE h.owner_id = $1
          AND h.h3_index IS DISTINCT FROM $2
          AND NOT EXISTS (SELECT 1 FROM troops t WHERE t.h3_index = h.h3_index AND t.quantity > 0)
          AND NOT EXISTS (SELECT 1 FROM buildings b WHERE b.h3_index = h.h3_index)
        ORDER BY RANDOM() LIMIT 30
      `, [player.id, player.capital_hex])

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
        insertEvent(player.id, 'decay', `🍂 ${lost} unguarded border hex${lost > 1 ? 'es' : ''} slipped from your control. Garrison or build to hold the frontier.`)
        console.log(`[decay] ${player.username} lost ${lost} border hexes`)
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

  await ensureWildlands()
  await ensureBots()
  await ensureSeason()
  wrappedTick()
  setInterval(wrappedTick, TICK_INTERVAL_MS)
  setInterval(processTraining, TRAINING_INTERVAL_MS)
  setInterval(processCombat, COMBAT_INTERVAL_MS)
  setInterval(processBattleRounds, BATTLE_INTERVAL_MS)
  setInterval(processUpgrades, TRAINING_INTERVAL_MS)
  setInterval(processSeason, TRAINING_INTERVAL_MS)
}

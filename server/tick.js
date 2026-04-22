import { pool } from './db.js'
import { TICK_INTERVAL_MS, BATTLE_ROUND_DAMAGE_RATE, FORT_DEFENSE_BONUS, GOLD_CAP_BASE, GOLD_CAP_PER_HEX, GOLD_CAP_PER_MINE } from './config.js'
import { getIO } from './socket.js'
import { ensureBots, processBots } from './bots.js'

async function insertEvent(playerId, type, message, hexIndex = null) {
  try {
    await pool.query(
      'INSERT INTO events (player_id, type, message, hex_index) VALUES ($1,$2,$3,$4)',
      [playerId, type, message, hexIndex]
    )
  } catch (err) {
    console.error('[event] Failed to insert event:', err.message)
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
        COALESCE(SUM(CASE WHEN b.type = 'mine' THEN 3 ELSE 0 END), 0) AS gold_from_buildings
      FROM players p
      LEFT JOIN hexes h ON h.owner_id = p.id
      LEFT JOIN buildings b ON b.h3_index = h.h3_index
      GROUP BY p.id
    `)
    for (const row of result.rows) {
      const goldGain = (Number(row.hex_count) * BASE_RATE.gold) + Number(row.gold_from_buildings)
      if (goldGain === 0) continue
      await pool.query('UPDATE players SET gold=gold+$1 WHERE id=$2', [goldGain, row.id])
    }
    console.log(`[tick] Resources updated for ${result.rows.length} players.`)

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
      await pool.query(`
        INSERT INTO troops (owner_id, h3_index, type, quantity)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (owner_id, h3_index, type)
        DO UPDATE SET quantity = troops.quantity + EXCLUDED.quantity
      `, [job.owner_id, job.h3_index, job.type, job.quantity])
      await pool.query('DELETE FROM training_queue WHERE id=$1', [job.id])
      await insertEvent(job.owner_id, 'training_complete', `✅ ${job.quantity} troops finished training at ${job.h3_index}`, job.h3_index)
      console.log(`[training] ${job.quantity} troops ready at ${job.h3_index}`)
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
        // Own hex — deposit troops
        await depositTroops(army.owner_id, army.to_hex, army.type, army.quantity)
        await pool.query("UPDATE armies SET status='arrived' WHERE id=$1", [army.id])
        console.log(`[combat] ${army.owner_id} reinforced own hex ${army.to_hex}`)

      } else if (!targetHex || !targetHex.owner_id) {
        // Unclaimed hex — deposit troops, player must manually claim
        await depositTroops(army.owner_id, army.to_hex, army.type, army.quantity)
        await pool.query("UPDATE armies SET status='arrived' WHERE id=$1", [army.id])
        console.log(`[combat] troops stationed at unclaimed ${army.to_hex} — awaiting claim`)

      } else {
        // Enemy hex — attack strength is simply troop count
        const attackStr = army.quantity

        const existingBattle = await pool.query(
          "SELECT * FROM battles WHERE h3_index=$1 AND status='active'", [army.to_hex]
        )

        if (existingBattle.rows[0]) {
          // Join existing battle as reinforcement
          const battle = existingBattle.rows[0]
          const side = army.owner_id === battle.attacker_id ? 'attacker'
                     : army.owner_id === battle.defender_id ? 'defender'
                     : 'attacker' // third party joins attacker side

          const col = side === 'attacker' ? 'attacker_strength' : 'defender_strength'
          await pool.query(`UPDATE battles SET ${col}=${col}+$1 WHERE id=$2`, [army.quantity, battle.id])
          await pool.query(
            'INSERT INTO battle_participants (battle_id, player_id, side, troop_type, quantity) VALUES ($1,$2,$3,$4,$5)',
            [battle.id, army.owner_id, side, army.type, army.quantity]
          )
          await pool.query("UPDATE armies SET status='in_battle' WHERE id=$1", [army.id])
          console.log(`[battle] reinforcement joined battle ${battle.id} as ${side} (+${army.quantity} str)`)

        } else {
          // Start new battle
          const defenders = await pool.query(
            'SELECT type, quantity FROM troops WHERE h3_index=$1', [army.to_hex]
          )
          const fortsRes = await pool.query(
            "SELECT COUNT(*) AS cnt FROM buildings WHERE h3_index=$1 AND type='fort'", [army.to_hex]
          )
          const forts = Number(fortsRes.rows[0]?.cnt || 0)
          const defMultiplier = 1 + forts * FORT_DEFENSE_BONUS
          const defStr = defenders.rows.reduce((s, t) => s + t.quantity, 0) * defMultiplier

          if (defStr === 0) {
            // No defenders — take hex directly
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
          // Defender wins — restore defender remnants
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
          const defenderData = await pool.query('SELECT capital_hex FROM players WHERE id=$1', [battle.defender_id])
          const isCapital = defenderData.rows[0]?.capital_hex === battle.h3_index
          if (isCapital) {
            await pool.query(
              'DELETE FROM training_queue WHERE owner_id=$1 AND h3_index=$2',
              [battle.defender_id, battle.h3_index]
            )
            await pool.query('UPDATE players SET capital_hex=NULL WHERE id=$1', [battle.defender_id])
            await insertEvent(battle.defender_id, 'capital_lost', `👑 Your capital ${battle.h3_index} has fallen!`, battle.h3_index)
            console.log(`[battle] ${battle.defender_id} lost their capital at ${battle.h3_index}`)
          }
          await insertEvent(battle.attacker_id, 'battle_won', `🏆 Battle won at ${battle.h3_index}`, battle.h3_index)
          await insertEvent(battle.defender_id, 'battle_lost', `☠ Battle lost at ${battle.h3_index}`, battle.h3_index)
          await insertEvent(battle.defender_id, 'hex_lost', `💀 Your hex ${battle.h3_index} was captured in battle`, battle.h3_index)
        } else {
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

export let nextTickAt = Date.now() + TICK_INTERVAL_MS

export async function startTick() {
  console.log(`[tick] Starting resource tick every ${TICK_INTERVAL_MS / 60000} minutes`)

  async function wrappedTick() {
    await runTick()
    await processBots()
    nextTickAt = Date.now() + TICK_INTERVAL_MS
  }

  await ensureBots()
  wrappedTick()
  setInterval(wrappedTick, TICK_INTERVAL_MS)
  setInterval(processTraining, TRAINING_INTERVAL_MS)
  setInterval(processCombat, COMBAT_INTERVAL_MS)
  setInterval(processBattleRounds, BATTLE_INTERVAL_MS)
  setInterval(processUpgrades, TRAINING_INTERVAL_MS)
}

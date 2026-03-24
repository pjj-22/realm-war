import { pool } from './db.js'
import { TICK_INTERVAL_MS, COMBAT_STRENGTH, BATTLE_ROUND_DAMAGE_RATE } from './config.js'

const COMBAT_INTERVAL_MS = 15 * 1000
const TRAINING_INTERVAL_MS = 15 * 1000
const BATTLE_INTERVAL_MS = 15 * 1000
const BASE_RATE = { gold: 1, mana: 0 }

export async function runTick() {
  console.log('[tick] Running resource tick...')
  try {
    const result = await pool.query(`
      SELECT
        p.id,
        COUNT(DISTINCT h.h3_index) AS hex_count,
        COALESCE(SUM(CASE WHEN b.type = 'mine'      THEN 3 ELSE 0 END), 0) AS gold_from_buildings,
        COALESCE(SUM(CASE WHEN b.type = 'mana_well' THEN 3 ELSE 0 END), 0) AS mana_from_buildings
      FROM players p
      LEFT JOIN hexes h ON h.owner_id = p.id
      LEFT JOIN buildings b ON b.h3_index = h.h3_index
      GROUP BY p.id
    `)
    for (const row of result.rows) {
      const goldGain = (Number(row.hex_count) * BASE_RATE.gold) + Number(row.gold_from_buildings)
      const manaGain = Number(row.mana_from_buildings)
      if (goldGain === 0 && manaGain === 0) continue
      await pool.query('UPDATE players SET gold=gold+$1, mana=mana+$2 WHERE id=$3', [goldGain, manaGain, row.id])
    }
    console.log(`[tick] Resources updated for ${result.rows.length} players.`)
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
      console.log(`[training] ${job.quantity} ${job.type}s ready at ${job.h3_index}`)
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
        // Enemy hex — start or join a battle
        const attackStr = army.quantity * (COMBAT_STRENGTH[army.type] || 1)

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
          await pool.query(`UPDATE battles SET ${col}=${col}+$1 WHERE id=$2`, [attackStr, battle.id])
          await pool.query(
            'INSERT INTO battle_participants (battle_id, player_id, side, troop_type, quantity) VALUES ($1,$2,$3,$4,$5)',
            [battle.id, army.owner_id, side, army.type, army.quantity]
          )
          await pool.query("UPDATE armies SET status='in_battle' WHERE id=$1", [army.id])
          console.log(`[battle] reinforcement joined battle ${battle.id} as ${side} (+${attackStr.toFixed(1)} str)`)

        } else {
          // Start new battle
          const defenders = await pool.query(
            'SELECT type, quantity FROM troops WHERE h3_index=$1', [army.to_hex]
          )
          const defStr = defenders.rows.reduce((s, t) => s + t.quantity * (COMBAT_STRENGTH[t.type] || 1), 0)

          if (defStr === 0) {
            // No defenders — take hex directly
            await pool.query(
              'UPDATE hexes SET owner_id=$1, claimed_at=NOW() WHERE h3_index=$2',
              [army.owner_id, army.to_hex]
            )
            await depositTroops(army.owner_id, army.to_hex, army.type, army.quantity)
            await pool.query("UPDATE armies SET status='arrived' WHERE id=$1", [army.id])
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
            console.log(`[battle] started at ${army.to_hex}: ${attackStr.toFixed(1)} atk vs ${defStr.toFixed(1)} def`)
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
          const survivors = Math.round(newAtkStr)
          if (survivors > 0) {
            // Deposit survivors of most-represented attacker troop type
            const atk = await pool.query(
              "SELECT troop_type, SUM(quantity) AS qty FROM battle_participants WHERE battle_id=$1 AND side='attacker' GROUP BY troop_type ORDER BY qty DESC LIMIT 1",
              [battle.id]
            )
            if (atk.rows[0]) {
              await depositTroops(battle.attacker_id, battle.h3_index, atk.rows[0].troop_type, survivors)
            }
          }
          console.log(`[battle] ${battle.id} ATTACKER WINS at ${battle.h3_index} (${survivors} survivors)`)
        } else {
          // Defender wins — attacker troops already deducted at march time; restore defender remnants
          const defSurvivors = Math.round(newDefStr)
          await pool.query('DELETE FROM troops WHERE h3_index=$1', [battle.h3_index])
          if (defSurvivors > 0) {
            const def = await pool.query(
              "SELECT troop_type, SUM(quantity) AS qty FROM battle_participants WHERE battle_id=$1 AND side='defender' GROUP BY troop_type ORDER BY qty DESC LIMIT 1",
              [battle.id]
            )
            if (def.rows[0]) {
              await depositTroops(battle.defender_id, battle.h3_index, def.rows[0].troop_type, defSurvivors)
            }
          }
          console.log(`[battle] ${battle.id} DEFENDER WINS at ${battle.h3_index} (${defSurvivors} survivors)`)
        }

        await pool.query(
          "UPDATE battles SET status=$1, ended_at=NOW(), attacker_strength=$2, defender_strength=$3 WHERE id=$4",
          [attackerWon ? 'attacker_won' : 'defender_won', newAtkStr, newDefStr, battle.id]
        )
        await pool.query("UPDATE armies SET status='arrived' WHERE status='in_battle' AND to_hex=$1", [battle.h3_index])

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

export function startTick() {
  console.log(`[tick] Starting resource tick every ${TICK_INTERVAL_MS / 60000} minutes`)
  runTick()
  setInterval(runTick, TICK_INTERVAL_MS)
  setInterval(processTraining, TRAINING_INTERVAL_MS)
  setInterval(processCombat, COMBAT_INTERVAL_MS)
  setInterval(processBattleRounds, BATTLE_INTERVAL_MS)
}

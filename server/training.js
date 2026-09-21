import { TROOP_STATS, BUILDING_TIME_SECONDS, NO_BARRACKS_TRAIN_MULT } from './config.js'

// Queue a training job on a hex - no gold handling, callers charge for it
// inside the same transaction. A finished barracks halves train time; without
// one it runs at NO_BARRACKS_TRAIN_MULT x base. Jobs chain after the last one
// queued on the hex so they never overlap.
export async function queueTraining(tx, ownerId, h3Index, type, quantity) {
  const stats = TROOP_STATS[type]
  const building = await tx.query('SELECT type, created_at FROM buildings WHERE h3_index=$1', [h3Index])
  const hasBarracks = building.rows.some(b =>
    b.type === 'barracks' && (Date.now() - new Date(b.created_at).getTime() >= BUILDING_TIME_SECONDS * 1000)
  )
  const trainMinutes = hasBarracks ? stats.trainMinutes / 2 : stats.trainMinutes * NO_BARRACKS_TRAIN_MULT

  const lastJob = await tx.query(
    'SELECT MAX(completes_at) AS last FROM training_queue WHERE owner_id=$1 AND h3_index=$2',
    [ownerId, h3Index]
  )
  const startedAt = lastJob.rows[0]?.last ? new Date(lastJob.rows[0].last) : new Date()
  const completesAt = new Date(startedAt.getTime() + trainMinutes * 60 * 1000 * quantity)
  const result = await tx.query(
    'INSERT INTO training_queue (owner_id, h3_index, type, quantity, started_at, completes_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [ownerId, h3Index, type, quantity, startedAt, completesAt]
  )
  return result.rows[0]
}

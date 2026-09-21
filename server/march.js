import { withTransaction, httpError } from './db.js'

// Takes `quantity` troops off a hex's garrison and sends them as an army along
// an already-computed route. Locks the garrison row so concurrent marches
// can't send the same troops twice. Throws a 400 if the garrison is short.
export async function launchArmy(playerId, { fromHex, toHex, type, quantity, path, arrivesAt, oceanMult }) {
  return withTransaction(async (tx) => {
    const troopsRow = await tx.query(
      'SELECT quantity FROM troops WHERE owner_id=$1 AND h3_index=$2 AND type=$3 FOR UPDATE',
      [playerId, fromHex, type]
    )
    const available = troopsRow.rows[0]?.quantity || 0
    if (available < quantity) throw httpError(400, `Only ${available} troops available`)

    await tx.query(
      'UPDATE troops SET quantity=quantity-$1 WHERE owner_id=$2 AND h3_index=$3 AND type=$4',
      [quantity, playerId, fromHex, type]
    )
    const result = await tx.query(
      'INSERT INTO armies (owner_id, from_hex, to_hex, type, quantity, arrives_at, departed_at, path, ocean_mult) VALUES ($1,$2,$3,$4,$5,$6,NOW(),$7,$8) RETURNING *',
      [playerId, fromHex, toHex, type, quantity, arrivesAt, path, oceanMult]
    )
    return result.rows[0]
  })
}

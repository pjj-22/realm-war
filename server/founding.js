// Founding a capital: atomically claim it and hand out the one-time starter gifts.
//
// The UPDATE ... WHERE capital_hex IS NULL guard is load-bearing: of any concurrent
// or duplicated first-hex claims (e.g. a double-click firing two POST /claim requests),
// exactly one flips capital_hex and thus wins the RETURNING row. Every other request
// updates 0 rows and returns early, so the troops / mine / camps gifts can't be doubled.
//
// Dependencies are injected (startingTroops, onWin) so this stays testable without
// pulling in config or the wildlands camp seeder.
export async function foundCapital(pool, playerId, h3Index, { startingTroops, onWin } = {}) {
  const won = await pool.query(
    'UPDATE players SET capital_hex = $1 WHERE id = $2 AND capital_hex IS NULL RETURNING id',
    [h3Index, playerId]
  )
  if (won.rows.length === 0) return false

  await pool.query(
    `INSERT INTO troops (owner_id, h3_index, type, quantity)
     VALUES ($1, $2, 'troop', $3)
     ON CONFLICT (owner_id, h3_index, type) DO UPDATE SET quantity = troops.quantity + EXCLUDED.quantity`,
    [playerId, h3Index, startingTroops]
  )
  // Starter mine - guarded insert (buildings has no unique index on h3_index);
  // ::text keeps the param type unambiguous on varchar-h3 databases
  await pool.query(
    `INSERT INTO buildings (h3_index, type) SELECT $1::text, 'mine'
     WHERE NOT EXISTS (SELECT 1 FROM buildings WHERE h3_index = $1::text AND type = 'mine')`,
    [h3Index]
  )
  // PvE on-ramp: garrisoned neutral camps nearby to fight (and plunder)
  onWin?.(h3Index)
  return true
}

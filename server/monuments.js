// Champion's Monument: when a season ends, a permanent monument is raised at
// the champion's capital. Monuments live outside the season-reset tables, so
// they accumulate across ages - the one thing a wipe can never take.
//
// DI (pool passed in) so it runs against pg-mem in tests - see founding.js.

// Record the champion's monument. Must run BEFORE the reset nulls capitals.
// Returns the created row, or null if there was no champion / no capital /
// this season is already recorded (UNIQUE season_number makes re-runs safe).
export async function recordMonument(pool, { seasonNumber, winnerId }) {
  if (winnerId == null || seasonNumber == null) return null
  const winner = await pool.query(
    'SELECT username, color, capital_hex FROM players WHERE id=$1', [winnerId]
  )
  const w = winner.rows[0]
  if (!w?.capital_hex) return null
  // Explicit duplicate check (not ON CONFLICT ... RETURNING) so the "null on
  // re-run" contract holds identically on Postgres and pg-mem; the UNIQUE
  // constraint remains as the backstop.
  const existing = await pool.query('SELECT 1 FROM monuments WHERE season_number=$1', [seasonNumber])
  if (existing.rows.length > 0) return null
  const inserted = await pool.query(
    `INSERT INTO monuments (season_number, username, color, h3_index)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [seasonNumber, w.username, w.color, w.capital_hex]
  )
  return inserted.rows[0] || null
}

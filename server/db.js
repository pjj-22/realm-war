import pg from 'pg'
import dotenv from 'dotenv'
dotenv.config()

const { Pool } = pg

export const pool = new Pool({ connectionString: process.env.DATABASE_URL })

// Run fn inside a transaction; rolls back on throw. Use tx.query inside fn,
// and SELECT ... FOR UPDATE to lock rows that get checked-then-modified.
export async function withTransaction(fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// Throwable that carries an HTTP status for route handlers
export function httpError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

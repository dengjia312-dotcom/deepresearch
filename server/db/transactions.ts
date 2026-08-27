import type { Pool, PoolClient } from 'pg'
import { getDatabasePool } from './pool'

export async function withTransaction<T>(
  work: (client: PoolClient) => Promise<T>,
  pool: Pool = getDatabasePool(),
) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Pool } from 'pg'
import { getDatabasePool } from './pool'
import { withTransaction } from './transactions'

const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), 'migrations')

export async function runDatabaseMigrations(pool: Pool = getDatabasePool()) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `)
  const files = (await readdir(migrationsDirectory))
    .filter((file) => /^\d+.*\.sql$/.test(file))
    .sort()

  for (const file of files) {
    const sql = await readFile(join(migrationsDirectory, file), 'utf8')
    const checksum = createHash('sha256').update(sql).digest('hex')
    await withTransaction(async (client) => {
      const existing = await client.query<{ checksum: string }>(
        'SELECT checksum FROM schema_migrations WHERE name = $1 FOR UPDATE',
        [file],
      )
      if (existing.rowCount) {
        if (existing.rows[0].checksum !== checksum) {
          throw new Error(`Applied migration checksum changed: ${file}`)
        }
        return
      }
      await client.query(sql)
      await client.query(
        'INSERT INTO schema_migrations(name, checksum) VALUES ($1, $2)',
        [file, checksum],
      )
    }, pool)
  }
}

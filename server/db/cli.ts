import 'dotenv/config'
import { closeDatabasePool } from './pool'
import { runDatabaseMigrations } from './migrate'

try {
  await runDatabaseMigrations()
  console.log('[database] Migrations completed.')
} finally {
  await closeDatabasePool()
}

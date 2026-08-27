import pg from 'pg'

const { Pool } = pg
let sharedPool: pg.Pool | null = null

export class DatabaseConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DatabaseConfigurationError'
  }
}

export function getDatabasePool() {
  if (sharedPool) return sharedPool
  const connectionString = process.env.DATABASE_URL?.trim()
  if (!connectionString) {
    throw new DatabaseConfigurationError('DATABASE_URL is required.')
  }
  sharedPool = new Pool({
    connectionString,
    max: getPositiveInteger('DATABASE_POOL_MAX', 10),
    idleTimeoutMillis: getPositiveInteger('DATABASE_IDLE_TIMEOUT_MS', 30_000),
    connectionTimeoutMillis: getPositiveInteger('DATABASE_CONNECT_TIMEOUT_MS', 10_000),
    ssl: process.env.DATABASE_SSL?.trim().toLowerCase() === 'true'
      ? { rejectUnauthorized: false }
      : undefined,
  })
  return sharedPool
}

function getPositiveInteger(name: string, fallback: number) {
  const value = Number(process.env[name]?.trim())
  return Number.isInteger(value) && value > 0 ? value : fallback
}

export function setDatabasePoolForTests(pool: pg.Pool | null) {
  sharedPool = pool
}

export async function closeDatabasePool() {
  if (!sharedPool) return
  const pool = sharedPool
  sharedPool = null
  await pool.end()
}

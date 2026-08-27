import { createHmac, randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { getDatabasePool } from '../pool'

function getSessionHashSecret() {
  const secret = process.env.SESSION_HASH_SECRET?.trim() ?? ''
  if (secret.length < 32) {
    throw new Error('SESSION_HASH_SECRET must contain at least 32 characters.')
  }
  return secret
}

export function hashClientSessionId(sessionId: string) {
  return createHmac('sha256', getSessionHashSecret()).update(sessionId).digest('hex')
}

export async function getOrCreateAnonymousSession(
  sessionId: string,
  pool: Pool = getDatabasePool(),
) {
  const sessionHash = hashClientSessionId(sessionId)
  const result = await pool.query<{ id: string }>(`
    INSERT INTO anonymous_sessions(id, session_key_hash, created_at, last_seen_at)
    VALUES ($1, $2, now(), now())
    ON CONFLICT (session_key_hash)
    DO UPDATE SET last_seen_at = now()
    RETURNING id
  `, [randomUUID(), sessionHash])
  return result.rows[0].id
}

import type { Pool, PoolClient, QueryResultRow } from 'pg'
import type { LiveResearchResult } from '../../../src/types'
import type { ResearchRequest, ResearchResponse } from '../../types/research'
import {
  emptyResearchJobProgress,
  type ResearchJobDto,
  type ResearchJobFailurePoint,
  type ResearchJobPhase,
  type ResearchJobProgress,
  type ResearchJobStatus,
} from '../../types/researchJob'
import { StaleTaskWriteError, TaskNotFoundError } from '../errors'
import { getDatabasePool } from '../pool'
import { withTransaction } from '../transactions'
import {
  assertOwnedResearchExecutionAllowedWithClient,
  completeOwnedResearchWithClient,
  failOwnedStageWithClient,
  startOwnedStageWithClient,
} from './taskRepository'

interface ResearchJobRow extends QueryResultRow {
  id: string
  task_id: string
  owner_session_id: string
  request_id: string
  status: ResearchJobStatus
  phase: ResearchJobPhase
  progress: ResearchJobProgress
  result: ResearchResponse | null
  error_code: string | null
  error_message: string | null
  error_status: number | null
  created_at: Date | string
  updated_at: Date | string
  completed_at: Date | string | null
}

function toIso(value: Date | string | null) {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function normalizeProgress(value: Partial<ResearchJobProgress> | null): ResearchJobProgress {
  const empty = emptyResearchJobProgress()
  return Object.fromEntries(
    Object.keys(empty).map((key) => {
      const name = key as keyof ResearchJobProgress
      const count = value?.[name]
      return [name, Number.isSafeInteger(count) && (count ?? -1) >= 0 ? count : 0]
    }),
  ) as unknown as ResearchJobProgress
}

function toDto(row: ResearchJobRow): ResearchJobDto {
  return {
    jobId: row.id,
    taskId: row.task_id,
    requestId: row.request_id,
    status: row.status,
    phase: row.phase,
    progress: normalizeProgress(row.progress),
    result: row.result,
    error: row.error_code || row.error_message
      ? {
          code: row.error_code ?? 'INTERNAL_ERROR',
          message: row.error_message ?? '研究任务执行失败，请重新发起研究。',
          status: row.error_status,
        }
      : null,
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
    completedAt: toIso(row.completed_at),
  }
}

async function selectJobForUpdate(client: PoolClient, jobId: string) {
  const result = await client.query<ResearchJobRow>(
    'SELECT * FROM research_jobs WHERE id = $1 FOR UPDATE',
    [jobId],
  )
  if (!result.rows[0]) throw new TaskNotFoundError()
  return result.rows[0]
}

export async function createOrReuseOwnedResearchJob(
  ownerSessionId: string,
  jobId: string,
  request: ResearchRequest,
  pool: Pool = getDatabasePool(),
) {
  return withTransaction(async (client) => {
    const task = await client.query<{ task_id: string }>(`
      SELECT task_id FROM research_tasks
      WHERE task_id = $1 AND owner_session_id = $2
      FOR UPDATE
    `, [request.taskId, ownerSessionId])
    if (!task.rows[0]) throw new TaskNotFoundError()

    const researchStrategy = await assertOwnedResearchExecutionAllowedWithClient(
      client,
      ownerSessionId,
      request.taskId,
    )

    const existing = await client.query<ResearchJobRow>(`
      SELECT * FROM research_jobs
      WHERE owner_session_id = $1 AND task_id = $2 AND request_id = $3
        AND status IN ('queued', 'running')
      ORDER BY created_at DESC
      LIMIT 1
    `, [ownerSessionId, request.taskId, request.requestId])
    if (existing.rows[0]) {
      return { job: toDto(existing.rows[0]), created: false as const, executionRequest: null }
    }

    await startOwnedStageWithClient(
      client,
      ownerSessionId,
      request.taskId,
      'research',
      request.requestId,
      new Date().toISOString(),
    )
    const inserted = await client.query<ResearchJobRow>(`
      INSERT INTO research_jobs(
        id, task_id, owner_session_id, request_id, status, phase, progress
      ) VALUES ($1, $2, $3, $4, 'queued', 'queued', $5)
      RETURNING *
    `, [jobId, request.taskId, ownerSessionId, request.requestId, emptyResearchJobProgress()])
    return {
      job: toDto(inserted.rows[0]!),
      created: true as const,
      executionRequest: { ...request, researchStrategy },
    }
  }, pool)
}

export async function getOwnedResearchJob(
  ownerSessionId: string,
  jobId: string,
  pool: Pool = getDatabasePool(),
) {
  const result = await pool.query<ResearchJobRow>(`
    SELECT * FROM research_jobs WHERE id = $1 AND owner_session_id = $2
  `, [jobId, ownerSessionId])
  if (!result.rows[0]) throw new TaskNotFoundError()
  return toDto(result.rows[0])
}

export async function markResearchJobRunning(
  jobId: string,
  pool: Pool = getDatabasePool(),
) {
  const result = await pool.query<ResearchJobRow>(`
    UPDATE research_jobs
    SET status = 'running', phase = 'searching', updated_at = now()
    WHERE id = $1 AND status = 'queued'
    RETURNING *
  `, [jobId])
  if (!result.rows[0]) throw new StaleTaskWriteError()
  return toDto(result.rows[0])
}

export async function setResearchJobPhase(
  jobId: string,
  phase: Extract<ResearchJobPhase, 'searching' | 'reading' | 'synthesizing'>,
  progressPatch: Partial<ResearchJobProgress> = {},
  pool: Pool = getDatabasePool(),
) {
  return withTransaction(async (client) => {
    const row = await selectJobForUpdate(client, jobId)
    if (row.status !== 'running') throw new StaleTaskWriteError()
    const progress = { ...normalizeProgress(row.progress), ...progressPatch }
    const result = await client.query<ResearchJobRow>(`
      UPDATE research_jobs SET phase = $2, progress = $3, updated_at = now()
      WHERE id = $1 AND status = 'running'
      RETURNING *
    `, [jobId, phase, progress])
    return toDto(result.rows[0]!)
  }, pool)
}

export async function incrementResearchJobReaderProgress(
  jobId: string,
  readerStatus: 'full_text' | 'partial' | 'insufficient' | 'unavailable',
  pool: Pool = getDatabasePool(),
) {
  return withTransaction(async (client) => {
    const row = await selectJobForUpdate(client, jobId)
    if (row.status !== 'running' || row.phase !== 'reading') throw new StaleTaskWriteError()
    const progress = normalizeProgress(row.progress)
    progress.readerCompletedCount += 1
    if (readerStatus === 'full_text') progress.fullTextCount += 1
    else if (readerStatus === 'partial') progress.partialCount += 1
    else if (readerStatus === 'insufficient') progress.insufficientCount += 1
    else progress.readerFailedCount += 1
    const result = await client.query<ResearchJobRow>(`
      UPDATE research_jobs SET progress = $2, updated_at = now()
      WHERE id = $1 AND status = 'running' AND phase = 'reading'
      RETURNING *
    `, [jobId, progress])
    return toDto(result.rows[0]!)
  }, pool)
}

export async function completeResearchJob(
  ownerSessionId: string,
  jobId: string,
  persistedResult: LiveResearchResult,
  response: ResearchResponse,
  pool: Pool = getDatabasePool(),
) {
  return withTransaction(async (client) => {
    console.info('[persistence] task-result started', { jobId })
    let row: ResearchJobRow
    try {
      row = await selectJobForUpdate(client, jobId)
      if (row.owner_session_id !== ownerSessionId || row.status !== 'running') {
        throw new StaleTaskWriteError()
      }
      await completeOwnedResearchWithClient(
        client,
        ownerSessionId,
        row.task_id,
        row.request_id,
        persistedResult,
      )
      console.info('[persistence] task-result completed', { jobId })
    } catch (error) {
      logPersistenceFailure('task-result', error)
      throw attachFailurePoint(error, 'persist_task')
    }

    console.info('[persistence] job-complete started', { jobId })
    try {
      const result = await client.query<ResearchJobRow>(`
        UPDATE research_jobs
        SET status = 'completed', phase = 'completed', result = $2,
            error_code = NULL, error_message = NULL, error_status = NULL,
            completed_at = now(), updated_at = now()
        WHERE id = $1 AND status = 'running'
        RETURNING *
      `, [jobId, response])
      if (!result.rows[0]) throw new StaleTaskWriteError()
      console.info('[persistence] job-complete completed', { jobId })
      return toDto(result.rows[0])
    } catch (error) {
      logPersistenceFailure('job-complete', error)
      throw attachFailurePoint(error, 'persist_job_complete')
    }
  }, pool)
}

function attachFailurePoint(error: unknown, failurePoint: ResearchJobFailurePoint) {
  if (error && typeof error === 'object') {
    Reflect.set(error, 'researchJobFailurePoint', failurePoint)
  }
  return error
}

function safeDatabaseErrorCode(error: unknown) {
  if (!error || typeof error !== 'object') return null
  const value = Reflect.get(error, 'code')
  return typeof value === 'string' && /^[0-9A-Z]{5}$/.test(value) ? value : null
}

function logPersistenceFailure(operation: string, error: unknown) {
  console.error('[persistence] failed', {
    operation,
    errorName: error instanceof Error ? error.name : 'UnknownError',
    databaseErrorCode: safeDatabaseErrorCode(error),
  })
}

export async function failResearchJob(
  ownerSessionId: string,
  jobId: string,
  failure: { code: string; message: string; status: number | null },
  pool: Pool = getDatabasePool(),
) {
  return withTransaction(async (client) => {
    const row = await selectJobForUpdate(client, jobId)
    if (row.owner_session_id !== ownerSessionId) throw new TaskNotFoundError()
    if (row.status === 'completed' || row.status === 'failed') return toDto(row)
    try {
      await failOwnedStageWithClient(
        client,
        ownerSessionId,
        row.task_id,
        'research',
        row.request_id,
        {
          errorCode: failure.code,
          errorStatus: failure.status,
          errorMessage: failure.message,
          failedAt: new Date().toISOString(),
        },
      )
    } catch (error) {
      if (!(error instanceof StaleTaskWriteError)) throw error
    }
    const result = await client.query<ResearchJobRow>(`
      UPDATE research_jobs
      SET status = 'failed', phase = 'failed', result = NULL,
          error_code = $2, error_message = $3, error_status = $4,
          completed_at = now(), updated_at = now()
      WHERE id = $1 AND status IN ('queued', 'running')
      RETURNING *
    `, [jobId, failure.code, failure.message, failure.status])
    return toDto(result.rows[0] ?? row)
  }, pool)
}

export async function recoverInterruptedResearchJobs(pool: Pool = getDatabasePool()) {
  return withTransaction(async (client) => {
    const interrupted = await client.query<ResearchJobRow>(`
      SELECT * FROM research_jobs WHERE status IN ('queued', 'running') FOR UPDATE
    `)
    for (const job of interrupted.rows) {
      await client.query(`
        UPDATE research_task_stages
        SET status = 'error', last_error_message = $4,
            last_error_code = 'RESEARCH_JOB_INTERRUPTED', last_error_status = NULL,
            failed_at = now(), updated_at = now()
        WHERE task_id = $1 AND stage = 'research' AND request_id = $2 AND status = 'loading'
          AND EXISTS (
            SELECT 1 FROM research_tasks
            WHERE task_id = $1 AND owner_session_id = $3
          )
      `, [
        job.task_id,
        job.request_id,
        job.owner_session_id,
        '研究任务因服务中断未完成，请重新发起研究。',
      ])
    }
    const result = await client.query(`
      UPDATE research_jobs
      SET status = 'failed', phase = 'failed',
          error_code = 'RESEARCH_JOB_INTERRUPTED',
          error_message = '研究任务因服务中断未完成，请重新发起研究。',
          error_status = NULL, completed_at = now(), updated_at = now()
      WHERE status IN ('queued', 'running')
    `)
    return result.rowCount ?? 0
  }, pool)
}

import type { ResearchRequest, ResearchResponse } from '../types/research'
import { ResearchServiceError } from './serviceError'
import { StaleTaskWriteError } from '../db/errors'
import type { ResearchJobFailurePoint } from '../types/researchJob'
import { toPersistedResearchResult } from './persistenceTransform'
import { researchWithProviders, type ResearchExecutionHooks } from './researchService'
import {
  completeResearchJob,
  assertResearchJobStillCurrent,
  failResearchJob,
  incrementResearchJobReaderProgress,
  markResearchJobRunning,
  setResearchJobPhase,
  updateResearchJobAgentCheckpoint,
} from '../db/repositories/researchJobRepository'

interface ScheduledResearchJob {
  jobId: string
  ownerSessionId: string
  request: ResearchRequest
}

export interface ResearchJobExecutionDependencies {
  research?: (
    request: ResearchRequest,
    hooks: ResearchExecutionHooks,
  ) => Promise<ResearchResponse>
  markRunning?: typeof markResearchJobRunning
  setPhase?: typeof setResearchJobPhase
  incrementReader?: typeof incrementResearchJobReaderProgress
  assertCurrent?: typeof assertResearchJobStillCurrent
  updateAgentCheckpoint?: typeof updateResearchJobAgentCheckpoint
  complete?: typeof completeResearchJob
  fail?: typeof failResearchJob
}

function getPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value?.trim())
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export async function executeResearchJob(
  job: ScheduledResearchJob,
  dependencies: ResearchJobExecutionDependencies = {},
) {
  const startedAt = Date.now()
  let failurePoint: ResearchJobFailurePoint = 'job_start'
  const research = dependencies.research ?? researchWithProviders
  const markRunning = dependencies.markRunning ?? markResearchJobRunning
  const setPhase = dependencies.setPhase ?? setResearchJobPhase
  const incrementReader = dependencies.incrementReader ?? incrementResearchJobReaderProgress
  const assertCurrent = dependencies.assertCurrent ?? assertResearchJobStillCurrent
  const updateAgentCheckpoint = dependencies.updateAgentCheckpoint
    ?? updateResearchJobAgentCheckpoint
  const complete = dependencies.complete ?? completeResearchJob
  const fail = dependencies.fail ?? failResearchJob
  try {
    await markRunning(job.jobId)
    const identity = {
      jobId: job.jobId,
      ownerSessionId: job.ownerSessionId,
      taskId: job.request.taskId,
      requestId: job.request.requestId,
    }
    failurePoint = 'research_execute'
    console.info('[research-job] phase', { jobId: job.jobId, phase: 'searching' })
    const response = await research(job.request, {
      onSearchCompleted: async (validSourceCount) => {
        await setPhase(job.jobId, 'searching', { validSourceCount })
      },
      onReaderStarted: async (readerTargetCount) => {
        await setPhase(job.jobId, 'reading', { readerTargetCount })
        console.info('[research-job] phase', { jobId: job.jobId, phase: 'reading' })
      },
      onReaderCompleted: async (status) => {
        await incrementReader(job.jobId, status)
      },
      assertCurrent: async () => {
        await assertCurrent(identity)
      },
      onAgentCheckpoint: async (checkpoint) => {
        if (checkpoint.phase === 'evaluating') failurePoint = 'evidence_evaluate'
        if (checkpoint.phase === 'replanning') failurePoint = 'replan_generate'
        await updateAgentCheckpoint(identity, checkpoint)
      },
      onSynthesisStarted: async () => {
        await setPhase(job.jobId, 'synthesizing')
        failurePoint = 'synthesis_parse'
        console.info('[research-job] phase', { jobId: job.jobId, phase: 'synthesizing' })
      },
      onSynthesisParsed: () => {
        failurePoint = 'response_build'
      },
      onResponseBuilt: () => {
        failurePoint = 'persist_task'
      },
    })
    failurePoint = 'persist_task'
    await complete(
      job.ownerSessionId,
      job.jobId,
      toPersistedResearchResult(response, job.request.topic),
      response,
    )
    console.info('[research-job] completed', {
      jobId: job.jobId,
      durationMs: Date.now() - startedAt,
      sourceCount: response.sources.length,
    })
  } catch (error) {
    const persistenceFailurePoint = getPersistenceFailurePoint(error)
    if (persistenceFailurePoint) failurePoint = persistenceFailurePoint
    const failure = error instanceof StaleTaskWriteError
      ? {
          code: 'STALE_TASK_WRITE',
          message: '该研究任务已被更新的请求替代，结果未写入当前任务。',
          status: 409,
        }
      : error instanceof ResearchServiceError
      ? { code: error.code, message: error.publicMessage, status: error.statusCode }
      : {
          code: 'INTERNAL_ERROR',
          message: '研究任务执行或保存失败，请重新发起研究。',
          status: 500,
        }
    const originalFailurePoint = failurePoint
    try {
      failurePoint = 'persist_job_failed'
      await fail(job.ownerSessionId, job.jobId, failure)
    } catch (persistenceError) {
      console.error('[research-job] failure persistence failed', {
        jobId: job.jobId,
        taskId: job.request.taskId,
        requestId: job.request.requestId,
        failurePoint,
        errorName: persistenceError instanceof Error ? persistenceError.name : 'UnknownError',
        databaseErrorCode: getSafeDatabaseErrorCode(persistenceError),
      })
    }
    console.error('[research-job] failed', {
      jobId: job.jobId,
      taskId: job.request.taskId,
      requestId: job.request.requestId,
      failurePoint: originalFailurePoint,
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorCode: failure.code,
      durationMs: Date.now() - startedAt,
    })
  }
}

function getPersistenceFailurePoint(error: unknown): ResearchJobFailurePoint | null {
  if (!error || typeof error !== 'object') return null
  const value = Reflect.get(error, 'researchJobFailurePoint')
  return value === 'persist_task' || value === 'persist_job_complete' ? value : null
}

function getSafeDatabaseErrorCode(error: unknown) {
  if (!error || typeof error !== 'object') return null
  const value = Reflect.get(error, 'code')
  return typeof value === 'string' && /^[0-9A-Z]{5}$/.test(value) ? value : null
}

export class ResearchJobScheduler {
  private activeCount = 0
  private readonly pending: ScheduledResearchJob[] = []

  constructor(
    private readonly concurrency: number,
    private readonly execute: (job: ScheduledResearchJob) => Promise<void> = executeResearchJob,
  ) {}

  schedule(job: ScheduledResearchJob) {
    this.pending.push(job)
    queueMicrotask(() => this.drain())
  }

  getSnapshot() {
    return { activeCount: this.activeCount, pendingCount: this.pending.length }
  }

  private drain() {
    while (this.activeCount < this.concurrency && this.pending.length > 0) {
      const job = this.pending.shift()!
      this.activeCount += 1
      void this.execute(job)
        .catch((error) => {
          console.error('[research-job] unexpected execution rejection', {
            jobId: job.jobId,
            name: error instanceof Error ? error.name : 'UnknownError',
          })
        })
        .finally(() => {
          this.activeCount -= 1
          this.drain()
        })
    }
  }
}

const researchJobScheduler = new ResearchJobScheduler(
  getPositiveInteger(process.env.API_RESEARCH_GLOBAL_CONCURRENCY, 4),
)

export function scheduleResearchJob(job: ScheduledResearchJob) {
  researchJobScheduler.schedule(job)
}

export const researchJobServiceTestApi = {
  getSchedulerSnapshot: () => researchJobScheduler.getSnapshot(),
}

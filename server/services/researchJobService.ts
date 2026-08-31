import type { ResearchRequest, ResearchResponse } from '../types/research'
import { ResearchServiceError } from './serviceError'
import { toPersistedResearchResult } from './persistenceTransform'
import { researchWithProviders, type ResearchExecutionHooks } from './researchService'
import {
  completeResearchJob,
  failResearchJob,
  incrementResearchJobReaderProgress,
  markResearchJobRunning,
  setResearchJobPhase,
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
  const research = dependencies.research ?? researchWithProviders
  const markRunning = dependencies.markRunning ?? markResearchJobRunning
  const setPhase = dependencies.setPhase ?? setResearchJobPhase
  const incrementReader = dependencies.incrementReader ?? incrementResearchJobReaderProgress
  const complete = dependencies.complete ?? completeResearchJob
  const fail = dependencies.fail ?? failResearchJob
  try {
    await markRunning(job.jobId)
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
      onSynthesisStarted: async () => {
        await setPhase(job.jobId, 'synthesizing')
        console.info('[research-job] phase', { jobId: job.jobId, phase: 'synthesizing' })
      },
    })
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
    const failure = error instanceof ResearchServiceError
      ? { code: error.code, message: error.publicMessage, status: error.statusCode }
      : {
          code: 'INTERNAL_ERROR',
          message: '研究任务执行或保存失败，请重新发起研究。',
          status: 500,
        }
    try {
      await fail(job.ownerSessionId, job.jobId, failure)
    } catch (persistenceError) {
      console.error('[research-job] failure persistence failed', {
        jobId: job.jobId,
        name: persistenceError instanceof Error ? persistenceError.name : 'UnknownError',
      })
    }
    console.error('[research-job] failed', {
      jobId: job.jobId,
      errorCode: failure.code,
      durationMs: Date.now() - startedAt,
    })
  }
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

import type { ResearchResponse } from './research'

export type ResearchJobStatus = 'queued' | 'running' | 'completed' | 'failed'
export type ResearchJobPhase =
  | 'queued'
  | 'searching'
  | 'reading'
  | 'synthesizing'
  | 'completed'
  | 'failed'

export interface ResearchJobProgress {
  validSourceCount: number
  readerTargetCount: number
  readerCompletedCount: number
  fullTextCount: number
  partialCount: number
  insufficientCount: number
  readerFailedCount: number
}

export interface ResearchJobDto {
  jobId: string
  taskId: string
  requestId: string
  status: ResearchJobStatus
  phase: ResearchJobPhase
  progress: ResearchJobProgress
  result: ResearchResponse | null
  error: {
    code: string
    message: string
    status: number | null
  } | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export const emptyResearchJobProgress = (): ResearchJobProgress => ({
  validSourceCount: 0,
  readerTargetCount: 0,
  readerCompletedCount: 0,
  fullTextCount: 0,
  partialCount: 0,
  insufficientCount: 0,
  readerFailedCount: 0,
})

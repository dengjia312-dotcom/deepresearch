import type {
  ResearchAgentCheckpoint,
  ResearchAgentPhase,
  ResearchResponse,
  ResearchToolName,
} from './research'

export type ResearchJobStatus = 'queued' | 'running' | 'completed' | 'failed'
export type ResearchJobPhase =
  | 'queued'
  | 'searching'
  | 'reading'
  | 'synthesizing'
  | 'completed'
  | 'failed'

export type ResearchJobFailurePoint =
  | 'job_start'
  | 'research_execute'
  | 'evidence_evaluate'
  | 'replan_generate'
  | 'synthesis_parse'
  | 'response_build'
  | 'persist_task'
  | 'persist_job_complete'
  | 'persist_job_failed'

export interface ResearchJobCounterProgress {
  validSourceCount: number
  readerTargetCount: number
  readerCompletedCount: number
  fullTextCount: number
  partialCount: number
  insufficientCount: number
  readerFailedCount: number
}

export interface PublicResearchAgentProgress {
  currentRound: 1 | 2
  maxRounds: 2
  replanCount: 0 | 1
  phase: ResearchAgentPhase
  evaluationStatus: ResearchAgentCheckpoint['evaluationStatus']
  evidenceNeedCount: number
  satisfiedEvidenceNeedCount: number
  followUpQueryCount: number
  evidenceCount: number
  currentTool: ResearchToolName | null
  toolCallCount: number
}

export interface ResearchJobProgress extends ResearchJobCounterProgress {
  agent?: PublicResearchAgentProgress
}

export interface StoredResearchJobProgress extends ResearchJobCounterProgress {
  agentState?: ResearchAgentCheckpoint
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

export const emptyResearchJobProgress = (): ResearchJobCounterProgress => ({
  validSourceCount: 0,
  readerTargetCount: 0,
  readerCompletedCount: 0,
  fullTextCount: 0,
  partialCount: 0,
  insufficientCount: 0,
  readerFailedCount: 0,
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeCounters(value: unknown): ResearchJobCounterProgress {
  const empty = emptyResearchJobProgress()
  if (!isRecord(value)) return empty
  return Object.fromEntries(Object.keys(empty).map((key) => {
    const name = key as keyof ResearchJobCounterProgress
    const count = value[name]
    return [name, Number.isSafeInteger(count) && Number(count) >= 0 ? count : 0]
  })) as unknown as ResearchJobCounterProgress
}

function parseAgentCheckpoint(value: unknown): ResearchAgentCheckpoint | null {
  if (!isRecord(value)) return null
  const validPhase = [
    'initializing', 'round_search', 'round_read', 'evaluating',
    'replanning', 'completed', 'failed',
  ].includes(String(value.phase))
  const validEvaluation = [
    'not_started', 'evaluating', 'sufficient', 'insufficient',
  ].includes(String(value.evaluationStatus))
  const validCurrentTool = value.currentTool === undefined
    || value.currentTool === null
    || value.currentTool === 'web_search'
    || value.currentTool === 'read_webpage'
    || value.currentTool === 'http_fetch'
  const validToolCallCount = value.toolCallCount === undefined
    || (Number.isSafeInteger(value.toolCallCount) && Number(value.toolCallCount) >= 0)
  const validToolCallCounts = value.toolCallCounts === undefined || (
    isRecord(value.toolCallCounts)
    && ['web_search', 'read_webpage', 'http_fetch'].every((tool) => {
      const count = value.toolCallCounts && Reflect.get(value.toolCallCounts, tool)
      return count === undefined || (Number.isSafeInteger(count) && Number(count) >= 0)
    })
  )
  if (
    value.version !== 1
    || (value.currentRound !== 1 && value.currentRound !== 2)
    || value.maxRounds !== 2
    || (value.replanCount !== 0 && value.replanCount !== 1)
    || value.maxReplans !== 1
    || !validPhase
    || !validEvaluation
    || !validCurrentTool
    || !validToolCallCount
    || !validToolCallCounts
    || !Array.isArray(value.evidenceNeeds)
    || !Array.isArray(value.followUpQueries)
    || !Number.isSafeInteger(value.evidenceCount)
    || Number(value.evidenceCount) < 0
    || typeof value.updatedAt !== 'string'
  ) return null
  return value as unknown as ResearchAgentCheckpoint
}

export function normalizeStoredResearchJobProgress(value: unknown): StoredResearchJobProgress {
  const counters = normalizeCounters(value)
  const checkpoint = isRecord(value) ? parseAgentCheckpoint(value.agentState) : null
  return { ...counters, ...(checkpoint ? { agentState: checkpoint } : {}) }
}

export function toPublicResearchJobProgress(value: unknown): ResearchJobProgress {
  const stored = normalizeStoredResearchJobProgress(value)
  const { agentState: checkpoint, ...counters } = stored
  if (!checkpoint) return counters
  return {
    ...counters,
    agent: {
      currentRound: checkpoint.currentRound,
      maxRounds: checkpoint.maxRounds,
      replanCount: checkpoint.replanCount,
      phase: checkpoint.phase,
      evaluationStatus: checkpoint.evaluationStatus,
      evidenceNeedCount: checkpoint.evidenceNeeds.length,
      satisfiedEvidenceNeedCount: checkpoint.evidenceNeeds.filter(
        (need) => need.status === 'satisfied',
      ).length,
      followUpQueryCount: checkpoint.followUpQueries.length,
      evidenceCount: checkpoint.evidenceCount,
      currentTool: checkpoint.currentTool ?? null,
      toolCallCount: checkpoint.toolCallCount ?? 0,
    },
  }
}

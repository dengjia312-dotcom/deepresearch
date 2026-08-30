import type {
  AsyncRequestState,
  AsyncRequestStates,
  ResearchState,
} from '../../src/context/ResearchContext'
import type {
  DataSource,
  GenerationMode,
  GenerationStatus,
  LiveOutlineResult,
  LiveReportResult,
  LiveResearchResult,
  ResearchPlan,
  ResearchPoolItem,
  ResearchTask,
} from '../../src/types'
import type {
  ResearchJobPhase,
  ResearchJobProgress,
  ResearchJobStatus,
} from '../types/researchJob'

export type ResearchStage = 'plan' | 'research' | 'outline' | 'report'

export interface PersistedResearchStateDto {
  version: 3
  task: ResearchTask
  researchPlan: ResearchPlan | null
  planMode: GenerationMode
  planStatus: GenerationStatus
  planError: string | null
  searchMode: GenerationMode
  searchStatus: GenerationStatus
  liveResearchResult: LiveResearchResult | null
  searchError: string | null
  searchedAt: string | null
  outlineMode: GenerationMode
  outlineStatus: GenerationStatus
  outlineError: string | null
  liveOutline: LiveOutlineResult | null
  reportMode: GenerationMode
  reportStatus: GenerationStatus
  reportError: string | null
  liveReport: LiveReportResult | null
  poolItems: ResearchPoolItem[]
  outlineGenerated: boolean
  reportGenerated: boolean
  requests: AsyncRequestStates
  poolVersion: number
  outlineVersion: number
  reportConfigVersion: number
  revision: number
  researchJobId: string | null
  researchJobStatus: ResearchJobStatus | null
  researchJobPhase: ResearchJobPhase | null
  researchJobProgress: ResearchJobProgress | null
}

export interface TaskDetailDto {
  state: PersistedResearchStateDto
  citations: Array<{
    sectionId: string
    paragraphId: string
    sourceId: string
    citationOrder: number
  }>
}

export interface TaskSummaryDto {
  task: ResearchTask
  planStatus: GenerationStatus
  searchStatus: GenerationStatus
  outlineStatus: GenerationStatus
  reportStatus: GenerationStatus
  updatedAt: string
}

export interface CreateTaskInput {
  task: ResearchTask
}

export interface StageStartVersions {
  poolVersion?: number
  outlineVersion?: number
  reportConfigVersion?: number
}

export interface StageFailureInput {
  errorCode: string
  errorStatus: number | null
  errorMessage: string
  failedAt: string
}

export type PersistableTaskState = Omit<ResearchState, 'notice'> & { revision?: number }

export interface PoolItemMutation {
  sourceSnapshot?: ResearchPoolItem['sourceSnapshot']
  reviewStatus?: ResearchPoolItem['reviewStatus']
  note?: string
  credibility?: string
  dataSource?: DataSource
  addedAt?: string
}

export interface ImportWorkspaceInput {
  version: 4
  taskOrder: string[]
  tasksById: Record<string, PersistedResearchStateDto>
}

export interface StageRowData {
  mode: GenerationMode
  status: GenerationStatus
  requestId: string | null
  lastErrorMessage: string | null
  lastErrorCode: string | null
  lastErrorStatus: number | null
  failedAt: string | null
  startedAt: string | null
  completedAt: string | null
}

export function toAsyncRequestState(stage: StageRowData): AsyncRequestState {
  return {
    requestId: stage.requestId,
    status: stage.status,
    startedAt: stage.startedAt,
    lastErrorCode: stage.lastErrorCode,
    lastErrorStatus: stage.lastErrorStatus,
    failedAt: stage.failedAt,
  }
}

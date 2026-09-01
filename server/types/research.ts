export interface ResearchRequest {
  taskId: string
  requestId: string
  topic: string
  goal: string
  sourcePreferences: string[]
  targetSourceCount: number
  /** Server-owned metadata. Public routes ignore any client-provided value. */
  researchStrategy?: ResearchStrategy
  /** Server-owned Plan snapshot. Public routes ignore any client-provided value. */
  researchPlanContext?: ResearchPlanContext
}

export interface ResearchPlanContext {
  objective: string
  scope: string
  questions: Array<{ id: string; text: string }>
  sourcePreferences: string[]
}

export interface ResearchIntent {
  normalizedTopic: string
  researchObject: string
  userIntent: string
  scope: string[]
  excludedMeanings: string[]
  keyConcepts: string[]
  ambiguityDetected: boolean
}

export interface SearchQuery {
  id: string
  query: string
  purpose: string
  priority: number
}

export interface SearchQueryPlan {
  queries: SearchQuery[]
}

export interface IntentCandidate {
  id: string
  label: string
  description: string
  researchObject: string
  scope: string[]
  keyConcepts: string[]
  excludedMeanings: string[]
}

export interface ConfirmedIntent {
  source: 'candidate' | 'custom'
  candidateId?: string
  label: string
  normalizedTopic: string
  researchObject: string
  userIntent: string
  scope: string[]
  keyConcepts: string[]
  excludedMeanings: string[]
}

export interface IntentConfirmation {
  status: 'not_required' | 'pending' | 'confirmed'
  candidates: IntentCandidate[]
  confirmedIntent?: ConfirmedIntent
}

export interface ResearchStrategy {
  version: 1 | 2
  intent: ResearchIntent
  queryPlan: SearchQueryPlan
  intentConfirmation: IntentConfirmation
  queryPlanStatus: 'ready' | 'stale' | 'pending_confirmation'
}

export interface PublicIntentConfirmation {
  status: IntentConfirmation['status']
  candidates?: Array<Pick<IntentCandidate, 'id' | 'label' | 'description' | 'scope'>>
  confirmed?: Pick<ConfirmedIntent, 'source' | 'label'>
}

export type ResearchDepth = 'quick' | 'deep' | 'professional'
export type DataSource = 'real' | 'mock'
export type ReportDepth = 'brief' | 'standard' | 'deep'

export interface PlanRequest {
  taskId: string
  requestId: string
  topic: string
  depth: ResearchDepth
}

export interface PlanResponse {
  taskId: string
  requestId: string
  mode: 'live'
  dataSource: 'real'
  plan: {
    objective: string
    scope: string
    questions: Array<{
      id: string
      text: string
    }>
    sourcePreferences: string[]
    estimatedSourceCount: number
    estimatedDurationMinutes: number
  }
  intentConfirmation?: PublicIntentConfirmation
  generatedAt: string
}

export interface ResearchInsight {
  id: string
  title: string
  content: string
  sourceIds: string[]
}

export interface ResearchSource {
  id: string
  title: string
  url: string
  publisher: string
  publishedAt: string
  type: string
  credibility: '待评估'
  summary: string
  keyInsight: string
}

export interface ResearchResponse {
  taskId: string
  requestId: string
  mode: 'live'
  dataSource: 'real'
  topic: string
  summary: string
  insights: ResearchInsight[]
  sources: ResearchSource[]
  warnings: string[]
  targetSourceCount: number
  actualSourceCount: number
  deduplicatedSourceCount: number
  validSourceCount: number
  searchedAt: string
}

export type ResearchErrorCode =
  | 'INVALID_REQUEST'
  | 'API_RATE_LIMITED'
  | 'API_CONCURRENCY_LIMITED'
  | 'DATABASE_UNAVAILABLE'
  | 'TASK_NOT_FOUND'
  | 'TASK_CONFLICT'
  | 'STALE_TASK_WRITE'
  | 'REPORT_NOT_READY'
  | 'REPORT_DATA_INVALID'
  | 'REPORT_EXPORT_FAILED'
  | 'AI_GENERATION_NOT_CONFIGURED'
  | 'AI_GENERATION_TIMEOUT'
  | 'AI_GENERATION_RATE_LIMITED'
  | 'AI_GENERATION_RESPONSE_INVALID'
  | 'AI_GENERATION_FAILED'
  | 'MIMO_NOT_CONFIGURED'
  | 'MIMO_AUTH_FAILED'
  | 'MIMO_ACCESS_DENIED'
  | 'MIMO_QUOTA_EXCEEDED'
  | 'MIMO_RATE_LIMITED'
  | 'MIMO_TIMEOUT'
  | 'MIMO_NETWORK_ERROR'
  | 'MIMO_RESPONSE_INVALID'
  | 'RESEARCH_SEARCH_FAILED'
  | 'RESEARCH_PLAN_CONFIRMATION_REQUIRED'
  | 'RESEARCH_INTENT_CONFIRMATION_REQUIRED'
  | 'INVALID_RESEARCH_INTENT'
  | 'NO_RELEVANT_SOURCES'
  | 'RESEARCH_JOB_INTERRUPTED'
  | 'NO_REAL_SOURCES'
  | 'MIMO_UPSTREAM_ERROR'
  | 'INTERNAL_ERROR'

export interface ResearchErrorResponse {
  error: {
    code: ResearchErrorCode
    message: string
  }
}

export interface MimoChatMessage {
  content?: unknown
  role?: string
  [key: string]: unknown
}

export interface MimoChatCompletionResponse {
  choices?: Array<{
    message?: MimoChatMessage
    [key: string]: unknown
  }>
  model?: string
  usage?: unknown
  [key: string]: unknown
}

export interface VerifiedSearchMetadata {
  url: string
  title: string
  publisher: string
  publishedAt: string
  snippet: string
}

export type ResearchEvidenceType = 'full_text' | 'partial' | 'search_summary'

export interface ResearchSynthesisEvidence extends VerifiedSearchMetadata {
  sourceId: string
  evidenceType: ResearchEvidenceType
  content: string
}

export type ResearchAgentPhase =
  | 'initializing'
  | 'round_search'
  | 'round_read'
  | 'evaluating'
  | 'replanning'
  | 'completed'
  | 'failed'

export type ResearchAgentEvaluationStatus =
  | 'not_started'
  | 'evaluating'
  | 'sufficient'
  | 'insufficient'

export type ResearchAgentSourceType =
  | 'official'
  | 'academic'
  | 'professional'
  | 'news'
  | 'company'
  | 'recruitment'
  | 'community'
  | 'general_web'

export type ResearchAgentAcquisitionTool = 'web_search' | 'read_webpage'

export interface ResearchEvidenceNeed {
  id: string
  label: string
  description: string
  relatedQuestionIds: string[]
  status: 'open' | 'satisfied' | 'unresolved'
  supportingEvidenceIds: string[]
}

export interface ResearchFollowUpQuery extends SearchQuery {
  round: 2
  evidenceNeedIds: string[]
}

export interface ResearchEvidenceBinding {
  evidenceNeedId?: string
  queryId: string
  agentRound: 1 | 2
  acquisitionTool: ResearchAgentAcquisitionTool
}

export interface ResearchAgentEvidenceRecord {
  evidenceId: string
  normalizedUrl: string
  metadata: VerifiedSearchMetadata
  evidenceType: ResearchEvidenceType
  content: string
  sourceType: ResearchAgentSourceType
  bindings: ResearchEvidenceBinding[]
}

export interface ResearchEvidenceEvaluation {
  status: 'sufficient' | 'insufficient'
  evidenceNeeds: ResearchEvidenceNeed[]
  followUpQueries: ResearchFollowUpQuery[]
}

export interface ResearchAgentCheckpoint {
  version: 1
  currentRound: 1 | 2
  maxRounds: 2
  replanCount: 0 | 1
  maxReplans: 1
  phase: ResearchAgentPhase
  evaluationStatus: ResearchAgentEvaluationStatus
  evidenceNeeds: ResearchEvidenceNeed[]
  followUpQueries: ResearchFollowUpQuery[]
  evidenceCount: number
  updatedAt: string
}

export type EvidenceStatus = 'sufficient' | 'limited' | 'insufficient'
export type ClaimType = 'source_supported' | 'synthesis' | 'uncertain'
export type SourceReviewLabel = '可信' | '存疑' | '待评估'

export interface SelectedResearchSource {
  id: string
  title: string
  url: string
  publisher: string
  type?: string
  summary: string
  keyInsight: string
  credibility: SourceReviewLabel
  origin: 'real'
}

export interface OutlineRequest {
  taskId: string
  requestId: string
  topic: string
  goal: string
  sources: SelectedResearchSource[]
}

export interface LiveOutlineSection {
  id: string
  title: string
  description: string
  sourceIds: string[]
  evidenceStatus: EvidenceStatus
}

export interface LiveOutline {
  title: string
  sections: LiveOutlineSection[]
}

export interface OutlineResponse {
  taskId: string
  requestId: string
  mode: 'live'
  dataSource: 'real'
  outline: LiveOutline
  warnings: string[]
  generatedAt: string
}

export interface ReportOutlineSection {
  id: string
  title: string
  description: string
  sourceIds: string[]
}

export interface ReportRequest {
  taskId: string
  requestId: string
  topic: string
  goal: string
  outline: {
    title: string
    sections: ReportOutlineSection[]
  }
  sources: SelectedResearchSource[]
  reportDepth: ReportDepth
  targetMinWords: number
  targetMaxWords: number
}

export interface LiveReportParagraph {
  id: string
  content: string
  sourceIds: string[]
  claimType: ClaimType
}

export interface LiveReportSection {
  id: string
  title: string
  paragraphs: LiveReportParagraph[]
}

export interface LiveReport {
  title: string
  executiveSummary: string
  sections: LiveReportSection[]
  conclusion: string
  limitations: string[]
}

export interface ReportResponse {
  taskId: string
  requestId: string
  mode: 'live'
  dataSource: 'real'
  report: LiveReport
  warnings: string[]
  reportDepth: ReportDepth
  targetMinWords: number
  targetMaxWords: number
  actualWordCount: number
  generatedAt: string
}

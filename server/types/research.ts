export interface ResearchRequest {
  taskId: string
  requestId: string
  topic: string
  goal: string
  sourcePreferences: string[]
  targetSourceCount: number
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
  | 'MIMO_NOT_CONFIGURED'
  | 'MIMO_AUTH_FAILED'
  | 'MIMO_ACCESS_DENIED'
  | 'MIMO_QUOTA_EXCEEDED'
  | 'MIMO_RATE_LIMITED'
  | 'MIMO_TIMEOUT'
  | 'MIMO_NETWORK_ERROR'
  | 'MIMO_RESPONSE_INVALID'
  | 'RESEARCH_SEARCH_FAILED'
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

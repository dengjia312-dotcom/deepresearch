import type {
  ResearchAgentSourceType,
  ResearchRequest,
  ResearchStrategy,
  ResearchSynthesisEvidence,
  ResearchToolName,
  SearchQuery,
  VerifiedSearchMetadata,
} from './research'

export type ResearchToolCapability =
  | 'discover_sources'
  | 'extract_web_content'
  | 'fetch_static_content'
export type ResearchToolCostLevel = 'low' | 'medium' | 'high'
export type ResearchToolLatencyLevel = 'low' | 'medium' | 'high'
export type ResearchToolResultStatus = 'success' | 'partial'
export type ResearchReaderStatus = 'full_text' | 'partial' | 'insufficient' | 'unavailable'
export type ResearchReaderFailureCategory =
  | 'HTTP_4XX'
  | 'HTTP_5XX'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'INVALID_RESPONSE'
  | 'EMPTY_CONTENT'
  | 'UNKNOWN'

export interface ResearchReaderStats {
  attemptedCount: number
  fullTextCount: number
  partialCount: number
  insufficientCount: number
  failedCount: number
  searchSummaryCount: number
  averageContentLength: number
  failureCategories: Record<ResearchReaderFailureCategory, number>
  httpStatusCounts: Record<string, number>
}

export type ResearchSearchRelevance = 'high' | 'medium' | 'low' | 'uncertain'

export interface ResearchSearchSource extends VerifiedSearchMetadata {
  candidateId: string
  matchedQueryIds: string[]
  sourceCategory: ResearchAgentSourceType
  relevance: ResearchSearchRelevance
}

interface ResearchToolCallBase {
  executionId: string
  tool: ResearchToolName
  round: 1 | 2
  evidenceNeedIds: string[]
}

export interface WebSearchToolCall extends ResearchToolCallBase {
  tool: 'web_search'
  queries: SearchQuery[]
}

export interface ReadWebpageToolCall extends ResearchToolCallBase {
  tool: 'read_webpage'
  sources: VerifiedSearchMetadata[]
}

export interface HttpFetchToolCall extends ResearchToolCallBase {
  tool: 'http_fetch'
  sources: ResearchSearchSource[]
}

export type ResearchToolCall = WebSearchToolCall | ReadWebpageToolCall | HttpFetchToolCall

interface ResearchToolResultBase {
  executionId: string
  tool: ResearchToolName
  status: ResearchToolResultStatus
  warnings: string[]
}

export interface WebSearchToolResult extends ResearchToolResultBase {
  tool: 'web_search'
  actualSourceCount: number
  deduplicatedSourceCount: number
  sources: ResearchSearchSource[]
}

export interface ReadWebpageToolResult extends ResearchToolResultBase {
  tool: 'read_webpage'
  evidenceSources: ResearchSynthesisEvidence[]
  readerStats: ResearchReaderStats
}

export type HttpFetchFailureCode =
  | 'UNSAFE_URL'
  | 'UNSUPPORTED_PROTOCOL'
  | 'SOURCE_NOT_AUTHORIZED'
  | 'DNS_RESOLUTION_FAILED'
  | 'PRIVATE_ADDRESS_BLOCKED'
  | 'REDIRECT_BLOCKED'
  | 'TOO_MANY_REDIRECTS'
  | 'REDIRECT_LOOP'
  | 'TIMEOUT'
  | 'RESPONSE_TOO_LARGE'
  | 'UNSUPPORTED_CONTENT_TYPE'
  | 'UNSUPPORTED_CONTENT_ENCODING'
  | 'HTTP_ERROR'
  | 'EMPTY_CONTENT'
  | 'UNSUPPORTED_CHARSET'
  | 'PARSE_FAILED'
  | 'NETWORK_ERROR'

export interface HttpFetchExtractionMetrics {
  paragraphCount: number
  linkDensity: number
  confidence: number
}

export interface HttpFetchItemResult {
  candidateId: string
  status: 'full_text' | 'partial' | 'failed'
  finalUrl?: string
  title?: string
  content: string
  contentLength: number
  contentType?: string
  failureCode?: HttpFetchFailureCode
  extraction?: HttpFetchExtractionMetrics
  fetchMetadata: {
    httpStatus?: number
    redirectCount: number
    durationMs: number
  }
}

export interface HttpFetchToolResult extends ResearchToolResultBase {
  tool: 'http_fetch'
  items: HttpFetchItemResult[]
  successfulCount: number
  failedCount: number
}

export type ResearchToolResult =
  | WebSearchToolResult
  | ReadWebpageToolResult
  | HttpFetchToolResult

export interface ResearchToolExecutionContext {
  request: Readonly<ResearchRequest>
  strategy: Readonly<ResearchStrategy>
  assertCurrent?: () => Promise<void> | void
  onReaderCompleted?: (status: ResearchReaderStatus) => Promise<void> | void
  /** Server-owned sources returned by web_search in the current Research round. */
  authorizedSearchSources?: readonly ResearchSearchSource[]
}

export type ResearchToolAdapter = (
  call: ResearchToolCall,
  context: ResearchToolExecutionContext,
) => Promise<ResearchToolResult>

export interface ResearchToolDefinition {
  readonly name: ResearchToolName
  readonly description: string
  readonly capabilities: readonly ResearchToolCapability[]
  readonly supportedSourceTypes: readonly ResearchAgentSourceType[]
  readonly costLevel: ResearchToolCostLevel
  readonly latencyLevel: ResearchToolLatencyLevel
  readonly maxCallsPerRun: number
  readonly enabled: boolean
  readonly validateArguments: (call: unknown) => boolean
  readonly adapter: ResearchToolAdapter
}

export interface ResearchToolBudget {
  readonly maxTotalCalls: number
  readonly maxCallsByTool: Readonly<Record<ResearchToolName, number>>
}

export interface ResearchToolProgress {
  currentTool: ResearchToolName | null
  toolCallCount: number
  toolCallCounts: Record<ResearchToolName, number>
}

export type ResearchToolRuntimeErrorCode =
  | 'RESEARCH_TOOL_UNAVAILABLE'
  | 'RESEARCH_TOOL_ARGUMENTS_INVALID'
  | 'RESEARCH_TOOL_BUDGET_EXCEEDED'
  | 'RESEARCH_TOOL_PROVENANCE_INVALID'

export class ResearchToolRuntimeError extends Error {
  constructor(
    public readonly code: ResearchToolRuntimeErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ResearchToolRuntimeError'
  }
}

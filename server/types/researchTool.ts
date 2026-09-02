import type {
  ResearchAgentSourceType,
  ResearchRequest,
  ResearchStrategy,
  ResearchSynthesisEvidence,
  ResearchToolName,
  SearchQuery,
  VerifiedSearchMetadata,
} from './research'

export type ResearchToolCapability = 'discover_sources' | 'extract_web_content'
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

export type ResearchToolCall = WebSearchToolCall | ReadWebpageToolCall

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

export type ResearchToolResult = WebSearchToolResult | ReadWebpageToolResult

export interface ResearchToolExecutionContext {
  request: Readonly<ResearchRequest>
  strategy: Readonly<ResearchStrategy>
  assertCurrent?: () => Promise<void> | void
  onReaderCompleted?: (status: ResearchReaderStatus) => Promise<void> | void
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

export class ResearchToolRuntimeError extends Error {
  constructor(
    public readonly code: ResearchToolRuntimeErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ResearchToolRuntimeError'
  }
}

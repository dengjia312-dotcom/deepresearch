import {
  enrichResearchSourcesWithGlm,
  searchResearchSourcesWithGlm,
} from './glmResearchRetrievalService'
import {
  ResearchToolRuntimeError,
  type ReadWebpageToolResult,
  type HttpFetchToolResult,
  type ResearchToolAdapter,
  type WebSearchToolResult,
} from '../types/researchTool'
import {
  fetchStaticResearchSources,
  type HttpFetchDependencies,
} from './httpFetchService'

export const webSearchToolAdapter: ResearchToolAdapter = async (call, context) => {
  if (call.tool !== 'web_search') {
    throw new ResearchToolRuntimeError(
      'RESEARCH_TOOL_ARGUMENTS_INVALID',
      'web_search Tool Call 参数无效。',
    )
  }
  const result = await searchResearchSourcesWithGlm(
    context.request,
    context.strategy,
    call.queries,
  )
  const toolResult: WebSearchToolResult = {
    executionId: call.executionId,
    tool: 'web_search',
    status: result.warnings.length > 0 ? 'partial' : 'success',
    actualSourceCount: result.actualSourceCount,
    deduplicatedSourceCount: result.deduplicatedSourceCount,
    sources: result.metadata,
    warnings: result.warnings,
  }
  return toolResult
}

export const readWebpageToolAdapter: ResearchToolAdapter = async (call, context) => {
  if (call.tool !== 'read_webpage') {
    throw new ResearchToolRuntimeError(
      'RESEARCH_TOOL_ARGUMENTS_INVALID',
      'read_webpage Tool Call 参数无效。',
    )
  }
  const result = await enrichResearchSourcesWithGlm(call.sources, {
    onReaderCompleted: context.onReaderCompleted,
  })
  const toolResult: ReadWebpageToolResult = {
    executionId: call.executionId,
    tool: 'read_webpage',
    status: result.warnings.length > 0 ? 'partial' : 'success',
    evidenceSources: result.evidenceSources,
    readerStats: result.readerStats,
    warnings: result.warnings,
  }
  return toolResult
}

function normalizedUrl(value: string) {
  const url = new URL(value)
  url.hash = ''
  return url.toString()
}

function isAuthorizedSource(
  source: Extract<Parameters<ResearchToolAdapter>[0], { tool: 'http_fetch' }>['sources'][number],
  authorized: NonNullable<Parameters<ResearchToolAdapter>[1]['authorizedSearchSources']>[number],
) {
  return source.candidateId === authorized.candidateId
    && normalizedUrl(source.url) === normalizedUrl(authorized.url)
    && source.title === authorized.title
    && source.publisher === authorized.publisher
    && source.publishedAt === authorized.publishedAt
    && source.snippet === authorized.snippet
    && source.sourceCategory === authorized.sourceCategory
    && source.relevance === authorized.relevance
    && source.matchedQueryIds.length === authorized.matchedQueryIds.length
    && source.matchedQueryIds.every((queryId, index) => authorized.matchedQueryIds[index] === queryId)
}

export function createHttpFetchToolAdapter(
  dependencies: HttpFetchDependencies = {},
): ResearchToolAdapter {
  return async (call, context) => {
    if (call.tool !== 'http_fetch') {
      throw new ResearchToolRuntimeError(
        'RESEARCH_TOOL_ARGUMENTS_INVALID',
        'http_fetch Tool Call 参数无效。',
      )
    }
    const authorized = context.authorizedSearchSources
    if (!authorized || call.sources.some((source) => (
      !authorized.some((candidate) => isAuthorizedSource(source, candidate))
    ))) {
      throw new ResearchToolRuntimeError(
        'RESEARCH_TOOL_PROVENANCE_INVALID',
        'http_fetch Source 不属于当前 Research Round。',
      )
    }
    const toolResult: HttpFetchToolResult = await fetchStaticResearchSources(call, dependencies)
    return toolResult
  }
}

export const httpFetchToolAdapter = createHttpFetchToolAdapter()

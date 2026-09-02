import {
  enrichResearchSourcesWithGlm,
  searchResearchSourcesWithGlm,
} from './glmResearchRetrievalService'
import {
  ResearchToolRuntimeError,
  type ReadWebpageToolResult,
  type ResearchToolAdapter,
  type WebSearchToolResult,
} from '../types/researchTool'

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

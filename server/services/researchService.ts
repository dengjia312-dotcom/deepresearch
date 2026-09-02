import type {
  ResearchAgentCheckpoint,
  ResearchRequest,
  ResearchResponse,
} from '../types/research'
import type { ResearchReaderStatus } from '../types/researchTool'
import { runResearchAgent } from './researchAgentService'
import { synthesizeResearchResponse } from './researchSynthesisService'
import { resolveResearchStrategy } from './researchStrategyService'

export interface ResearchExecutionHooks {
  onSearchStarted?: () => Promise<void> | void
  onSearchCompleted?: (validSourceCount: number) => Promise<void> | void
  onReaderStarted?: (readerTargetCount: number) => Promise<void> | void
  onReaderCompleted?: (status: ResearchReaderStatus) => Promise<void> | void
  assertCurrent?: () => Promise<void> | void
  onAgentCheckpoint?: (checkpoint: ResearchAgentCheckpoint) => Promise<void> | void
  onSynthesisStarted?: () => Promise<void> | void
  onSynthesisParsed?: () => Promise<void> | void
  onResponseBuilt?: () => Promise<void> | void
}

export async function researchWithProviders(
  request: ResearchRequest,
  hooks: ResearchExecutionHooks = {},
): Promise<ResearchResponse> {
  await hooks.onSearchStarted?.()
  const strategyStartedAt = Date.now()
  const strategy = resolveResearchStrategy(request)
  console.info('[research:intent] completed', {
    ambiguityDetected: strategy.intent.ambiguityDetected,
    scopeCount: strategy.intent.scope.length,
    excludedMeaningCount: strategy.intent.excludedMeanings.length,
    durationMs: Date.now() - strategyStartedAt,
  })
  console.info('[research:query-plan] completed', {
    queryCount: strategy.queryPlan.queries.length,
    purposes: strategy.queryPlan.queries.map((query) => query.purpose),
    durationMs: Date.now() - strategyStartedAt,
  })
  const executionRequest = { ...request, researchStrategy: strategy }
  const retrieval = await runResearchAgent(executionRequest, strategy, {
    assertCurrent: hooks.assertCurrent,
    onCheckpoint: hooks.onAgentCheckpoint,
    onSearchCompleted: hooks.onSearchCompleted,
    onReaderStarted: hooks.onReaderStarted,
    onReaderCompleted: hooks.onReaderCompleted,
  })
  await hooks.assertCurrent?.()
  await hooks.onSynthesisStarted?.()
  return synthesizeResearchResponse(
    executionRequest,
    retrieval.metadata,
    retrieval.evidenceSources,
    {
      actualSourceCount: retrieval.actualSourceCount,
      deduplicatedSourceCount: retrieval.deduplicatedSourceCount,
    },
    retrieval.warnings,
    {
      onSynthesisParsed: hooks.onSynthesisParsed,
      onResponseBuilt: hooks.onResponseBuilt,
    },
  )
}

import { randomUUID } from 'node:crypto'
import type {
  ResearchAgentCheckpoint,
  ResearchAgentEvidenceRecord,
  ResearchEvidenceBinding,
  ResearchEvidenceNeed,
  ResearchFollowUpQuery,
  ResearchRequest,
  ResearchStrategy,
  ResearchSynthesisEvidence,
  SearchQuery,
  VerifiedSearchMetadata,
} from '../types/research'
import type {
  ResearchReaderStats,
  ResearchReaderStatus,
  ResearchToolProgress,
} from '../types/researchTool'
import {
  evaluateResearchEvidence,
  type ResearchEvidenceEvaluatorInput,
} from './researchEvidenceEvaluatorService'
import {
  createResearchToolExecutor,
  type ResearchToolExecutorFactory,
} from './researchToolExecutor'
import { defaultResearchToolRegistry } from './researchToolRegistry'

export const RESEARCH_AGENT_MAX_ROUNDS = 2 as const
export const RESEARCH_AGENT_MAX_REPLANS = 1 as const
export const RESEARCH_AGENT_MAX_FOLLOW_UP_QUERIES = 3 as const
export const RESEARCH_AGENT_TOOL_REGISTRY = Object.freeze(
  defaultResearchToolRegistry.list().map((definition) => definition.name),
)
const MAX_SYNTHESIS_EVIDENCE = 16

export interface ResearchAgentHooks {
  assertCurrent?: () => Promise<void> | void
  onCheckpoint?: (checkpoint: ResearchAgentCheckpoint) => Promise<void> | void
  onSearchCompleted?: (validSourceCount: number) => Promise<void> | void
  onReaderStarted?: (readerTargetCount: number) => Promise<void> | void
  onReaderCompleted?: (status: ResearchReaderStatus) => Promise<void> | void
}

export interface ResearchAgentDependencies {
  createToolExecutor?: ResearchToolExecutorFactory
  evaluate?: (input: ResearchEvidenceEvaluatorInput) => ReturnType<typeof evaluateResearchEvidence>
}

interface AgentRoundResult {
  actualSourceCount: number
  deduplicatedSourceCount: number
  warnings: string[]
  readerStats: ResearchReaderStats
}

export interface ResearchAgentResult extends AgentRoundResult {
  metadata: VerifiedSearchMetadata[]
  evidenceSources: ResearchSynthesisEvidence[]
}

function now() {
  return new Date().toISOString()
}

function normalizedUrl(value: string) {
  try {
    const url = new URL(value)
    url.hash = ''
    return url.toString()
  } catch {
    return value.trim()
  }
}

function bindingKey(binding: ResearchEvidenceBinding) {
  return [
    binding.evidenceNeedId ?? '',
    binding.queryId,
    binding.agentRound,
    binding.acquisitionTool,
  ].join('|')
}

function evidenceRank(value: ResearchAgentEvidenceRecord['evidenceType']) {
  return value === 'full_text' ? 3 : value === 'partial' ? 2 : 1
}

function createEmptyReaderStats(): ResearchReaderStats {
  return {
    attemptedCount: 0,
    fullTextCount: 0,
    partialCount: 0,
    insufficientCount: 0,
    failedCount: 0,
    searchSummaryCount: 0,
    averageContentLength: 0,
    failureCategories: {
      HTTP_4XX: 0,
      HTTP_5XX: 0,
      TIMEOUT: 0,
      NETWORK: 0,
      INVALID_RESPONSE: 0,
      EMPTY_CONTENT: 0,
      UNKNOWN: 0,
    },
    httpStatusCounts: {},
  }
}

function mergeReaderStats(target: ResearchReaderStats, incoming: ResearchReaderStats) {
  const previousContentTotal = target.averageContentLength * target.attemptedCount
  const incomingContentTotal = incoming.averageContentLength * incoming.attemptedCount
  target.attemptedCount += incoming.attemptedCount
  target.fullTextCount += incoming.fullTextCount
  target.partialCount += incoming.partialCount
  target.insufficientCount += incoming.insufficientCount
  target.failedCount += incoming.failedCount
  target.searchSummaryCount += incoming.searchSummaryCount
  target.averageContentLength = target.attemptedCount > 0
    ? Math.round((previousContentTotal + incomingContentTotal) / target.attemptedCount)
    : 0
  Object.keys(target.failureCategories).forEach((key) => {
    const category = key as keyof ResearchReaderStats['failureCategories']
    target.failureCategories[category] += incoming.failureCategories[category]
  })
  Object.entries(incoming.httpStatusCounts).forEach(([status, count]) => {
    target.httpStatusCounts[status] = (target.httpStatusCounts[status] ?? 0) + count
  })
}

function createCheckpoint(): ResearchAgentCheckpoint {
  return {
    version: 1,
    currentRound: 1,
    maxRounds: RESEARCH_AGENT_MAX_ROUNDS,
    replanCount: 0,
    maxReplans: RESEARCH_AGENT_MAX_REPLANS,
    phase: 'initializing',
    evaluationStatus: 'not_started',
    evidenceNeeds: [],
    followUpQueries: [],
    evidenceCount: 0,
    currentTool: null,
    toolCallCount: 0,
    toolCallCounts: { web_search: 0, read_webpage: 0 },
    updatedAt: now(),
  }
}

function cloneCheckpoint(checkpoint: ResearchAgentCheckpoint): ResearchAgentCheckpoint {
  return JSON.parse(JSON.stringify(checkpoint)) as ResearchAgentCheckpoint
}

function attachNeedBindings(
  evidencePool: Map<string, ResearchAgentEvidenceRecord>,
  needs: ResearchEvidenceNeed[],
) {
  needs.forEach((need) => {
    need.supportingEvidenceIds.forEach((evidenceId) => {
      const record = [...evidencePool.values()].find((item) => item.evidenceId === evidenceId)
      const base = record?.bindings[0]
      if (!record || !base) return
      const binding = { ...base, evidenceNeedId: need.id }
      if (!record.bindings.some((item) => bindingKey(item) === bindingKey(binding))) {
        record.bindings.push(binding)
      }
    })
  })
}

function toFinalEvidence(evidencePool: Map<string, ResearchAgentEvidenceRecord>) {
  return [...evidencePool.values()]
    .sort((left, right) => (
      Number(right.bindings.some((binding) => binding.evidenceNeedId))
        - Number(left.bindings.some((binding) => binding.evidenceNeedId))
      || evidenceRank(right.evidenceType) - evidenceRank(left.evidenceType)
      || left.evidenceId.localeCompare(right.evidenceId)
    ))
    .slice(0, MAX_SYNTHESIS_EVIDENCE)
}

function publicRetrievalResult(
  evidence: ResearchAgentEvidenceRecord[],
  totals: AgentRoundResult,
): ResearchAgentResult {
  const metadata: VerifiedSearchMetadata[] = evidence.map((item) => ({ ...item.metadata }))
  const evidenceSources: ResearchSynthesisEvidence[] = evidence.map((item, index) => ({
    ...item.metadata,
    sourceId: `source-${index + 1}`,
    evidenceType: item.evidenceType,
    content: item.content,
  }))
  return { ...totals, metadata, evidenceSources }
}

export async function runResearchAgent(
  request: ResearchRequest,
  strategy: ResearchStrategy,
  hooks: ResearchAgentHooks = {},
  dependencies: ResearchAgentDependencies = {},
): Promise<ResearchAgentResult> {
  const evaluate = dependencies.evaluate ?? evaluateResearchEvidence
  const createToolExecutor = dependencies.createToolExecutor ?? createResearchToolExecutor
  const checkpoint = createCheckpoint()
  const evidencePool = new Map<string, ResearchAgentEvidenceRecord>()
  const executedQueries: SearchQuery[] = []
  const warnings: string[] = []
  const readerStats = createEmptyReaderStats()
  let actualSourceCount = 0
  const searchedUrls = new Set<string>()
  let readerTargetCount = 0
  let evidenceSequence = 0

  const persistCheckpoint = async (patch: Partial<ResearchAgentCheckpoint>) => {
    Object.assign(checkpoint, patch, { evidenceCount: evidencePool.size, updatedAt: now() })
    await hooks.onCheckpoint?.(cloneCheckpoint(checkpoint))
  }

  const toolExecutor = createToolExecutor({
    onProgress: async (progress: ResearchToolProgress) => {
      await persistCheckpoint({
        currentTool: progress.currentTool,
        toolCallCount: progress.toolCallCount,
        toolCallCounts: progress.toolCallCounts,
      })
    },
  })

  const executeRound = async (
    round: 1 | 2,
    queries: SearchQuery[],
    priorEvidenceNeeds: ResearchEvidenceNeed[] = [],
  ) => {
    await hooks.assertCurrent?.()
    await persistCheckpoint({ currentRound: round, phase: 'round_search' })
    const evidenceNeedIds = [...new Set(queries.flatMap((query) => (
      'evidenceNeedIds' in query
        ? (query as ResearchFollowUpQuery).evidenceNeedIds
        : []
    )))]
    const searchResult = await toolExecutor.execute({
      executionId: randomUUID(),
      tool: 'web_search',
      round,
      evidenceNeedIds,
      queries,
    }, {
      request,
      strategy,
      assertCurrent: hooks.assertCurrent,
      onReaderCompleted: hooks.onReaderCompleted,
    })
    if (searchResult.tool !== 'web_search') throw new Error('Unexpected Research Tool result')
    actualSourceCount += searchResult.actualSourceCount
    searchResult.sources.forEach((source) => searchedUrls.add(normalizedUrl(source.url)))
    warnings.push(...searchResult.warnings)
    executedQueries.push(...queries)
    await hooks.onSearchCompleted?.(searchedUrls.size)
    await hooks.assertCurrent?.()
    await persistCheckpoint({ phase: 'round_read' })
    readerTargetCount += Math.min(8, searchResult.sources.length)
    await hooks.onReaderStarted?.(readerTargetCount)
    const readerResult = await toolExecutor.execute({
      executionId: randomUUID(),
      tool: 'read_webpage',
      round,
      evidenceNeedIds,
      sources: searchResult.sources,
    }, {
      request,
      strategy,
      assertCurrent: hooks.assertCurrent,
      onReaderCompleted: hooks.onReaderCompleted,
    })
    if (readerResult.tool !== 'read_webpage') throw new Error('Unexpected Research Tool result')
    mergeReaderStats(readerStats, readerResult.readerStats)
    warnings.push(...readerResult.warnings)
    const searchByUrl = new Map(searchResult.sources.map((item) => [normalizedUrl(item.url), item]))
    readerResult.evidenceSources.forEach((source) => {
      const key = normalizedUrl(source.url)
      const searchSource = searchByUrl.get(key)
      const queryIds = searchSource?.matchedQueryIds ?? queries.map((query) => query.id)
      const acquisitionTool = source.evidenceType === 'search_summary'
        ? 'web_search' as const
        : 'read_webpage' as const
      const bindings = queryIds.flatMap<ResearchEvidenceBinding>((queryId) => {
        const query = queries.find((item) => item.id === queryId)
        const needIds = query && 'evidenceNeedIds' in query
          ? (query as ResearchFollowUpQuery).evidenceNeedIds
          : []
        if (needIds.length === 0) return [{ queryId, agentRound: round, acquisitionTool }]
        return needIds.map((evidenceNeedId) => ({
          evidenceNeedId,
          queryId,
          agentRound: round,
          acquisitionTool,
        }))
      })
      const existing = evidencePool.get(key)
      if (existing) {
        bindings.forEach((binding) => {
          if (!existing.bindings.some((item) => bindingKey(item) === bindingKey(binding))) {
            existing.bindings.push(binding)
          }
        })
        if (evidenceRank(source.evidenceType) > evidenceRank(existing.evidenceType)) {
          existing.evidenceType = source.evidenceType
          existing.content = source.content
          existing.metadata = {
            url: source.url,
            title: source.title,
            publisher: source.publisher,
            publishedAt: source.publishedAt,
            snippet: source.snippet,
          }
          existing.sourceType = searchSource?.sourceCategory ?? existing.sourceType
        }
        return
      }
      evidenceSequence += 1
      evidencePool.set(key, {
        evidenceId: `evidence-${evidenceSequence}`,
        normalizedUrl: key,
        metadata: {
          url: source.url,
          title: source.title,
          publisher: source.publisher,
          publishedAt: source.publishedAt,
          snippet: source.snippet,
        },
        evidenceType: source.evidenceType,
        content: source.content,
        sourceType: searchSource?.sourceCategory ?? 'general_web',
        bindings,
      })
    })
    await persistCheckpoint({
      phase: 'evaluating',
      evaluationStatus: 'evaluating',
      currentTool: null,
    })
    await hooks.assertCurrent?.()
    const evaluation = await evaluate({
      intent: strategy.intent,
      plan: request.researchPlanContext ?? {
        objective: request.goal,
        scope: strategy.intent.scope.join('；'),
        questions: strategy.queryPlan.queries.map((query) => ({ id: query.id, text: query.purpose })),
        sourcePreferences: request.sourcePreferences,
      },
      initialQueries: strategy.queryPlan.queries,
      executedQueries,
      evidence: [...evidencePool.values()],
      priorEvidenceNeeds,
      round,
      allowReplan: round === 1,
    })
    await hooks.assertCurrent?.()
    attachNeedBindings(evidencePool, evaluation.evidenceNeeds)
    return evaluation
  }

  try {
    await persistCheckpoint({})
    const firstEvaluation = await executeRound(1, strategy.queryPlan.queries)
    if (firstEvaluation.status === 'sufficient') {
      await persistCheckpoint({
        phase: 'completed',
        currentTool: null,
        evaluationStatus: 'sufficient',
        evidenceNeeds: firstEvaluation.evidenceNeeds,
        followUpQueries: [],
      })
    } else {
      const followUpQueries = firstEvaluation.followUpQueries.slice(
        0,
        RESEARCH_AGENT_MAX_FOLLOW_UP_QUERIES,
      )
      await persistCheckpoint({
        phase: 'replanning',
        currentTool: null,
        evaluationStatus: 'insufficient',
        evidenceNeeds: firstEvaluation.evidenceNeeds,
        followUpQueries,
        replanCount: 1,
      })
      await hooks.assertCurrent?.()
      const secondEvaluation = await executeRound(
        2,
        followUpQueries,
        firstEvaluation.evidenceNeeds,
      )
      if (secondEvaluation.status === 'insufficient') {
        warnings.push('补充研究已达到两轮上限，仍存在部分证据缺口；报告将基于当前最佳证据生成。')
      }
      await persistCheckpoint({
        phase: 'completed',
        currentTool: null,
        evaluationStatus: secondEvaluation.status,
        evidenceNeeds: secondEvaluation.evidenceNeeds,
        followUpQueries,
      })
    }
    const finalEvidence = toFinalEvidence(evidencePool)
    return publicRetrievalResult(finalEvidence, {
      actualSourceCount,
      deduplicatedSourceCount: evidencePool.size,
      warnings: [...new Set(warnings)],
      readerStats,
    })
  } catch (error) {
    try {
      await persistCheckpoint({ phase: 'failed', currentTool: null })
    } catch {
      // Preserve the original execution/stale error when checkpoint persistence is no longer valid.
    }
    throw error
  }
}

export const researchAgentTestApi = {
  maxRounds: RESEARCH_AGENT_MAX_ROUNDS,
  maxReplans: RESEARCH_AGENT_MAX_REPLANS,
  maxFollowUpQueries: RESEARCH_AGENT_MAX_FOLLOW_UP_QUERIES,
  maxSynthesisEvidence: MAX_SYNTHESIS_EVIDENCE,
}

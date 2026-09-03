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
  HttpFetchFailureCode,
  HttpFetchItemResult,
  ResearchReaderStats,
  ResearchReaderStatus,
  ResearchSearchSource,
  ResearchToolProgress,
} from '../types/researchTool'
import { ResearchToolRuntimeError } from '../types/researchTool'
import {
  evaluateResearchEvidence,
  type ResearchEvidenceEvaluatorInput,
} from './researchEvidenceEvaluatorService'
import {
  createResearchToolExecutor,
  type ResearchToolExecutorFactory,
} from './researchToolExecutor'
import { defaultResearchToolRegistry } from './researchToolRegistry'
import {
  createHttpFetchEvidenceCandidate,
  mergeResearchEvidenceCandidates,
  type ResearchEvidenceUpgradeCandidate,
} from './httpFetchService'
import {
  HttpFetchItemError,
  validateHttpFetchUrl,
} from './httpFetchSecurityService'
import { ResearchServiceError } from './serviceError'

export const RESEARCH_AGENT_MAX_ROUNDS = 2 as const
export const RESEARCH_AGENT_MAX_REPLANS = 1 as const
export const RESEARCH_AGENT_MAX_FOLLOW_UP_QUERIES = 3 as const
export const RESEARCH_AGENT_TOOL_REGISTRY = Object.freeze(
  defaultResearchToolRegistry.list().map((definition) => definition.name),
)
const MAX_SYNTHESIS_EVIDENCE = 16
const MAX_ROUND_ACQUISITION_SOURCES = 8
const HTTP_SECURITY_FAILURES = new Set<HttpFetchFailureCode>([
  'UNSAFE_URL',
  'UNSUPPORTED_PROTOCOL',
  'PRIVATE_ADDRESS_BLOCKED',
  'REDIRECT_BLOCKED',
])
const HTTP_RECOVERABLE_FAILURES = new Set<HttpFetchFailureCode>([
  'DNS_RESOLUTION_FAILED',
  'TIMEOUT',
  'NETWORK_ERROR',
  'HTTP_ERROR',
  'RESPONSE_TOO_LARGE',
  'UNSUPPORTED_CONTENT_TYPE',
  'UNSUPPORTED_CONTENT_ENCODING',
  'UNSUPPORTED_CHARSET',
  'PARSE_FAILED',
  'EMPTY_CONTENT',
  'TOO_MANY_REDIRECTS',
  'REDIRECT_LOOP',
])

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

function effectiveLength(value: string) {
  return value.replace(/\s/g, '').length
}

function contentQuality(
  evidenceType: ResearchAgentEvidenceRecord['evidenceType'],
  content: string,
): ResearchEvidenceUpgradeCandidate['quality'] {
  const length = effectiveLength(content)
  const paragraphCount = Math.max(1, content.split(/\n{2,}/).filter(Boolean).length)
  const baseConfidence = evidenceType === 'full_text' ? 0.72 : evidenceType === 'partial' ? 0.58 : 0.35
  return {
    confidence: Math.min(
      0.98,
      baseConfidence + Math.min(0.18, length / 10_000) + Math.min(0.08, paragraphCount / 100),
    ),
    effectiveLength: length,
    paragraphCount,
    linkDensity: 0,
  }
}

function bindingsForSource(
  source: ResearchSearchSource,
  queries: SearchQuery[],
  round: 1 | 2,
  acquisitionTool: ResearchEvidenceBinding['acquisitionTool'],
) {
  const queryIds = source.matchedQueryIds.length > 0
    ? source.matchedQueryIds
    : queries.map((query) => query.id)
  return queryIds.flatMap<ResearchEvidenceBinding>((queryId) => {
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
}

function createSearchSummaryCandidate(
  source: ResearchSearchSource,
  bindings: ResearchEvidenceBinding[],
  evidenceId: string,
): ResearchEvidenceUpgradeCandidate {
  return {
    evidence: {
      evidenceId,
      normalizedUrl: normalizedUrl(source.url),
      metadata: {
        url: source.url,
        title: source.title,
        publisher: source.publisher,
        publishedAt: source.publishedAt,
        snippet: source.snippet,
      },
      evidenceType: 'search_summary',
      content: source.snippet.slice(0, 6_000),
      sourceType: source.sourceCategory,
      bindings,
    },
    quality: contentQuality('search_summary', source.snippet),
  }
}

function createReaderEvidenceCandidate(
  source: ResearchSearchSource,
  readerEvidence: ResearchSynthesisEvidence,
  bindings: ResearchEvidenceBinding[],
  evidenceId: string,
): ResearchEvidenceUpgradeCandidate | null {
  if (readerEvidence.evidenceType === 'search_summary') return null
  return {
    evidence: {
      evidenceId,
      normalizedUrl: normalizedUrl(source.url),
      metadata: {
        url: source.url,
        title: readerEvidence.title,
        publisher: readerEvidence.publisher,
        publishedAt: readerEvidence.publishedAt,
        snippet: readerEvidence.snippet,
      },
      evidenceType: readerEvidence.evidenceType,
      content: readerEvidence.content,
      sourceType: source.sourceCategory,
      bindings,
    },
    quality: contentQuality(readerEvidence.evidenceType, readerEvidence.content),
  }
}

function isStaticSecurityRejection(url: string) {
  try {
    validateHttpFetchUrl(url)
    return false
  } catch (error) {
    return error instanceof HttpFetchItemError && HTTP_SECURITY_FAILURES.has(error.code)
  }
}

function requireHttpFailureCode(item: HttpFetchItemResult) {
  const code = item.failureCode
  if (!code || code === 'SOURCE_NOT_AUTHORIZED') {
    throw new ResearchToolRuntimeError(
      'RESEARCH_TOOL_PROVENANCE_INVALID',
      'http_fetch 返回了无效的来源状态。',
    )
  }
  return code
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
    toolCallCounts: { web_search: 0, read_webpage: 0, http_fetch: 0 },
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
  const evidenceQuality = new Map<string, ResearchEvidenceUpgradeCandidate['quality']>()
  const executedQueries: SearchQuery[] = []
  const warnings: string[] = []
  const readerStats = createEmptyReaderStats()
  const securityRejectedUrls = new Set<string>()
  const searchSummaryFallbackUrls = new Set<string>()
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

  const evidenceIdFor = (key: string) => {
    const existing = evidencePool.get(key)
    if (existing) return existing.evidenceId
    evidenceSequence += 1
    return `evidence-${evidenceSequence}`
  }

  const mergeEvidence = (candidate: ResearchEvidenceUpgradeCandidate) => {
    const key = candidate.evidence.normalizedUrl
    const existing = evidencePool.get(key)
    const existingQuality = evidenceQuality.get(key)
    if (!existing || !existingQuality) {
      evidencePool.set(key, candidate.evidence)
      evidenceQuality.set(key, candidate.quality)
      return
    }
    const merged = mergeResearchEvidenceCandidates(
      { evidence: existing, quality: existingQuality },
      candidate,
    )
    evidencePool.set(key, merged.evidence)
    evidenceQuality.set(key, merged.quality)
  }

  const removeEvidence = (url: string) => {
    const key = normalizedUrl(url)
    evidencePool.delete(key)
    evidenceQuality.delete(key)
    searchSummaryFallbackUrls.delete(key)
    securityRejectedUrls.add(key)
  }

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

    const httpTargets = searchResult.sources.slice(0, MAX_ROUND_ACQUISITION_SOURCES)
    const httpResult = await toolExecutor.execute({
      executionId: randomUUID(),
      tool: 'http_fetch',
      round,
      evidenceNeedIds,
      sources: httpTargets,
    }, {
      request,
      strategy,
      assertCurrent: hooks.assertCurrent,
      authorizedSearchSources: searchResult.sources,
    })
    if (httpResult.tool !== 'http_fetch') throw new Error('Unexpected Research Tool result')
    const httpItems = new Map<string, HttpFetchItemResult>()
    httpResult.items.forEach((item) => {
      if (httpItems.has(item.candidateId)) {
        throw new ResearchToolRuntimeError(
          'RESEARCH_TOOL_PROVENANCE_INVALID',
          'http_fetch 返回了重复的来源结果。',
        )
      }
      httpItems.set(item.candidateId, item)
    })
    if (
      httpItems.size !== httpTargets.length
      || httpTargets.some((source) => !httpItems.has(source.candidateId))
    ) {
      throw new ResearchToolRuntimeError(
        'RESEARCH_TOOL_PROVENANCE_INVALID',
        'http_fetch 未返回完整的来源结果。',
      )
    }

    const securityRejectedIds = new Set<string>()
    const recoverableFailureIds = new Set<string>()
    httpResult.items.forEach((item) => {
      if (item.status !== 'failed') return
      const code = requireHttpFailureCode(item)
      if (HTTP_SECURITY_FAILURES.has(code)) securityRejectedIds.add(item.candidateId)
      else if (HTTP_RECOVERABLE_FAILURES.has(code)) recoverableFailureIds.add(item.candidateId)
      else {
        throw new ResearchToolRuntimeError(
          'RESEARCH_TOOL_PROVENANCE_INVALID',
          'http_fetch 返回了未知的来源状态。',
        )
      }
    })

    searchResult.sources.forEach((source) => {
      const staticallyRejected = isStaticSecurityRejection(source.url)
      if (securityRejectedIds.has(source.candidateId) || staticallyRejected) {
        removeEvidence(source.url)
        return
      }
      const key = normalizedUrl(source.url)
      if (securityRejectedUrls.has(key)) return
      mergeEvidence(createSearchSummaryCandidate(
        source,
        bindingsForSource(source, queries, round, 'web_search'),
        evidenceIdFor(key),
      ))
    })

    httpTargets.forEach((source) => {
      const item = httpItems.get(source.candidateId)!
      const key = normalizedUrl(source.url)
      if (item.status === 'failed' || securityRejectedUrls.has(key)) return
      const candidate = createHttpFetchEvidenceCandidate(
        source,
        item,
        bindingsForSource(source, queries, round, 'web_search'),
        evidenceIdFor(key),
      )
      if (candidate) {
        mergeEvidence(candidate)
        searchSummaryFallbackUrls.delete(key)
      }
    })

    const readerFallbackSources = httpTargets.filter((source) => {
      if (securityRejectedUrls.has(normalizedUrl(source.url))) return false
      const item = httpItems.get(source.candidateId)!
      return item.status === 'partial' || recoverableFailureIds.has(source.candidateId)
    })
    if (readerFallbackSources.length > 0) {
      readerTargetCount += readerFallbackSources.length
      await hooks.onReaderStarted?.(readerTargetCount)
      const readerResult = await toolExecutor.execute({
        executionId: randomUUID(),
        tool: 'read_webpage',
        round,
        evidenceNeedIds,
        sources: readerFallbackSources,
      }, {
        request,
        strategy,
        assertCurrent: hooks.assertCurrent,
        onReaderCompleted: hooks.onReaderCompleted,
      })
      if (readerResult.tool !== 'read_webpage') throw new Error('Unexpected Research Tool result')
      mergeReaderStats(readerStats, readerResult.readerStats)
      const searchByUrl = new Map(
        readerFallbackSources.map((source) => [normalizedUrl(source.url), source]),
      )
      readerResult.evidenceSources.forEach((readerEvidence) => {
        const key = normalizedUrl(readerEvidence.url)
        const searchSource = searchByUrl.get(key)
        if (!searchSource || securityRejectedUrls.has(key)) return
        const candidate = createReaderEvidenceCandidate(
          searchSource,
          readerEvidence,
          bindingsForSource(searchSource, queries, round, 'read_webpage'),
          evidenceIdFor(key),
        )
        if (candidate) mergeEvidence(candidate)
      })
      readerFallbackSources.forEach((source) => {
        const key = normalizedUrl(source.url)
        if (evidencePool.get(key)?.evidenceType === 'search_summary') {
          searchSummaryFallbackUrls.add(key)
        } else {
          searchSummaryFallbackUrls.delete(key)
        }
      })
    }
    if (evidencePool.size === 0) {
      throw new ResearchServiceError(
        'NO_REAL_SOURCES',
        502,
        '联网检索未获得可安全使用的真实来源。',
      )
    }
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
    if (searchSummaryFallbackUrls.size > 0) {
      warnings.push(
        `有 ${searchSummaryFallbackUrls.size} 条来源未获得可用正文，已使用搜索摘要继续研究。`,
      )
    }
    if (securityRejectedUrls.size > 0) {
      warnings.push(`有 ${securityRejectedUrls.size} 条来源未通过安全访问校验，已从研究证据中排除。`)
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

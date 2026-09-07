import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { StaleTaskWriteError } from '../server/db/errors'
import {
  RESEARCH_AGENT_TOOL_REGISTRY,
  runResearchAgent,
  researchAgentTestApi,
} from '../server/services/researchAgentService'
import {
  evaluateResearchEvidence,
  researchEvidenceEvaluatorTestApi,
} from '../server/services/researchEvidenceEvaluatorService'
import { researchWithProviders } from '../server/services/researchService'
import type {
  ResearchAgentCheckpoint,
  ResearchAgentEvidenceRecord,
  ResearchEvidenceEvaluation,
  ResearchRequest,
  ResearchStrategy,
  SearchQuery,
} from '../server/types/research'
import {
  emptyResearchJobProgress,
  normalizeStoredResearchJobProgress,
  toPublicResearchJobProgress,
} from '../server/types/researchJob'
import {
  DEFAULT_RESEARCH_TOOL_BUDGET,
  ResearchToolExecutor,
  type ResearchToolExecutorHooks,
} from '../server/services/researchToolExecutor'
import { ResearchToolRegistry } from '../server/services/researchToolRegistry'
import type {
  HttpFetchItemResult,
  ResearchSearchSource,
  ResearchToolAdapter,
  ResearchToolDefinition,
} from '../server/types/researchTool'
import { ResearchServiceError } from '../server/services/serviceError'

const initialQueries: SearchQuery[] = [
  { id: 'query-1', query: '环境设计专业 就业趋势', purpose: '就业趋势', priority: 1 },
  { id: 'query-2', query: '空间设计 AI 岗位能力', purpose: 'AI 与能力', priority: 2 },
]

const strategy: ResearchStrategy = {
  version: 2,
  intent: {
    normalizedTopic: '环境设计专业与空间设计行业的未来',
    researchObject: '环境设计专业及空间设计行业',
    userIntent: '分析未来发展、就业前景、行业趋势和能力要求',
    scope: ['环境设计专业', '室内设计', '景观设计', '空间设计', '就业', 'AI'],
    excludedMeanings: ['生态环境治理', '环境科学', '污染治理', '生态安全'],
    keyConcepts: ['环境设计专业', '空间设计', '就业', 'AI'],
    ambiguityDetected: false,
  },
  queryPlan: { queries: initialQueries },
  intentConfirmation: {
    status: 'confirmed',
    candidates: [],
    confirmedIntent: {
      source: 'candidate',
      candidateId: 'candidate-1',
      label: '环境设计专业与行业发展',
      normalizedTopic: '环境设计专业与空间设计行业的未来',
      researchObject: '环境设计专业及空间设计行业',
      userIntent: '分析未来发展、就业前景、行业趋势和能力要求',
      scope: ['环境设计专业', '空间设计', '就业', 'AI'],
      keyConcepts: ['环境设计专业', '空间设计', '就业', 'AI'],
      excludedMeanings: ['生态环境治理', '环境科学', '污染治理', '生态安全'],
    },
  },
  queryPlanStatus: 'ready',
}

const request: ResearchRequest = {
  taskId: 'task-agent',
  requestId: 'request-agent',
  topic: '环境设计的未来',
  goal: strategy.intent.userIntent,
  sourcePreferences: ['权威报告'],
  targetSourceCount: 12,
  researchStrategy: strategy,
  researchPlanContext: {
    objective: strategy.intent.userIntent,
    scope: '中国环境设计专业及空间设计行业',
    questions: [
      { id: 'question-1', text: '就业前景如何？' },
      { id: 'question-2', text: 'AI 如何影响岗位能力？' },
    ],
    sourcePreferences: ['权威报告'],
  },
}

const replanUnavailableWarning = '部分证据仍有补充空间，已基于当前可用资料完成研究。'

function makeEvaluatorEvidence(
  evidenceTypes: ResearchAgentEvidenceRecord['evidenceType'][] = [
    'full_text', 'full_text', 'full_text', 'full_text', 'full_text',
    'search_summary', 'search_summary', 'search_summary',
  ],
) {
  return evidenceTypes.map<ResearchAgentEvidenceRecord>((evidenceType, index) => ({
    evidenceId: `evidence-${index + 1}`,
    normalizedUrl: `https://example.com/evidence-${index + 1}`,
    metadata: {
      url: `https://example.com/evidence-${index + 1}`,
      title: `来源 ${index + 1}`,
      publisher: '研究机构',
      publishedAt: '2026-09-01',
      snippet: `摘要 ${index + 1}`,
    },
    evidenceType,
    content: evidenceType === 'search_summary' ? `摘要 ${index + 1}` : `正文证据 ${index + 1}`,
    sourceType: 'professional',
    bindings: [{ queryId: 'query-1', agentRound: 1, acquisitionTool: 'web_search' }],
  }))
}

function qwenEvaluatorResponse(payload: unknown) {
  return new Response(JSON.stringify({
    choices: [{ message: { content: typeof payload === 'string' ? payload : JSON.stringify(payload) } }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

async function withMockQwenFetch<T>(
  fetchImplementation: typeof fetch,
  action: () => Promise<T>,
) {
  const originalFetch = globalThis.fetch
  const oldKey = process.env.QWEN_API_KEY
  const oldBase = process.env.QWEN_BASE_URL
  process.env.QWEN_API_KEY = 'test-key'
  process.env.QWEN_BASE_URL = 'https://qwen.test/v1'
  globalThis.fetch = fetchImplementation
  try {
    return await action()
  } finally {
    globalThis.fetch = originalFetch
    if (oldKey === undefined) delete process.env.QWEN_API_KEY
    else process.env.QWEN_API_KEY = oldKey
    if (oldBase === undefined) delete process.env.QWEN_BASE_URL
    else process.env.QWEN_BASE_URL = oldBase
  }
}

function makeSearch(round: number, queries: SearchQuery[]) {
  const urls = round === 1
    ? ['https://example.com/shared', 'https://example.com/round-1']
    : ['https://example.com/shared', 'https://example.com/round-2']
  return makeSearchWithUrls(round, queries, urls)
}

function makeSearchWithUrls(round: number, queries: SearchQuery[], urls: string[]) {
  return {
    actualSourceCount: urls.length,
    deduplicatedSourceCount: urls.length,
    metadata: urls.map((url, index) => ({
      candidateId: `candidate-r${round}-${index + 1}`,
      url,
      title: `第 ${round} 轮来源 ${index + 1}`,
      publisher: '研究机构',
      publishedAt: '2026-09-01',
      snippet: `第 ${round} 轮摘要`,
      matchedQueryIds: [queries[index % queries.length]!.id],
      sourceCategory: index === 0 ? 'academic' as const : 'professional' as const,
      relevance: 'high' as const,
    })),
    warnings: [],
  }
}

async function readSearchMetadata(metadata: Array<{
  url: string
  title: string
  publisher: string
  publishedAt: string
  snippet: string
}>) {
  return {
    evidenceSources: metadata.map((source, index) => ({
      ...source,
      sourceId: `source-${index + 1}`,
      evidenceType: 'full_text' as const,
      content: `${source.title} 正文证据`.repeat(80),
    })),
    readerStats: {
      attemptedCount: metadata.length,
      fullTextCount: metadata.length,
      partialCount: 0,
      insufficientCount: 0,
      failedCount: 0,
      searchSummaryCount: 0,
      averageContentLength: 1200,
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
    },
    warnings: [],
  }
}

function httpItem(
  source: ResearchSearchSource,
  status: HttpFetchItemResult['status'] = 'failed',
  overrides: Partial<HttpFetchItemResult> = {},
): HttpFetchItemResult {
  if (status === 'failed') {
    return {
      candidateId: source.candidateId,
      status,
      content: '',
      contentLength: 0,
      failureCode: 'TIMEOUT',
      fetchMetadata: { redirectCount: 0, durationMs: 5 },
      ...overrides,
    }
  }
  const contentLength = status === 'full_text' ? 1_500 : 700
  return {
    candidateId: source.candidateId,
    status,
    finalUrl: `${source.url}/redirected`,
    title: `${source.title} HTTP`,
    content: `${status} HTTP evidence `.repeat(100).slice(0, contentLength),
    contentLength,
    contentType: 'text/html',
    extraction: {
      paragraphCount: status === 'full_text' ? 6 : 3,
      linkDensity: 0.05,
      confidence: status === 'full_text' ? 0.92 : 0.72,
    },
    fetchMetadata: { redirectCount: 1, durationMs: 5, httpStatus: 200 },
    ...overrides,
  }
}

function createMockToolExecutorFactory(options: {
  search: (queries: SearchQuery[]) => Promise<ReturnType<typeof makeSearch>> | ReturnType<typeof makeSearch>
  http?: (sources: ResearchSearchSource[]) => HttpFetchItemResult[] | Promise<HttpFetchItemResult[]>
  read?: (metadata: ResearchSearchSource[]) => ReturnType<typeof readSearchMetadata>
}) {
  return (hooks: ResearchToolExecutorHooks = {}) => {
    const webAdapter: ResearchToolAdapter = async (call) => {
      if (call.tool !== 'web_search') throw new Error('Unexpected mock Tool Call')
      const result = await options.search(call.queries)
      return {
        executionId: call.executionId,
        tool: 'web_search',
        status: result.warnings.length > 0 ? 'partial' : 'success',
        actualSourceCount: result.actualSourceCount,
        deduplicatedSourceCount: result.deduplicatedSourceCount,
        sources: result.metadata,
        warnings: result.warnings,
      }
    }
    const readAdapter: ResearchToolAdapter = async (call, context) => {
      if (call.tool !== 'read_webpage') throw new Error('Unexpected mock Tool Call')
      const result = await (options.read ?? readSearchMetadata)(
        call.sources as ResearchSearchSource[],
      )
      for (let index = 0; index < result.readerStats.attemptedCount; index += 1) {
        await context.onReaderCompleted?.('full_text')
      }
      return {
        executionId: call.executionId,
        tool: 'read_webpage',
        status: result.warnings.length > 0 ? 'partial' : 'success',
        ...result,
      }
    }
    const httpAdapter: ResearchToolAdapter = async (call) => {
      if (call.tool !== 'http_fetch') throw new Error('Unexpected mock Tool Call')
      const items = await (options.http
        ? options.http(call.sources)
        : call.sources.map((source) => httpItem(source)))
      const successfulCount = items.filter((item) => item.status !== 'failed').length
      return {
        executionId: call.executionId,
        tool: 'http_fetch',
        status: successfulCount === items.length ? 'success' : 'partial',
        items,
        successfulCount,
        failedCount: items.length - successfulCount,
        warnings: [],
      }
    }
    const base = {
      description: 'Agent test Tool',
      supportedSourceTypes: ['general_web'] as const,
      costLevel: 'low' as const,
      latencyLevel: 'low' as const,
      maxCallsPerRun: 2,
      enabled: true,
      validateArguments: () => true,
    }
    const definitions: ResearchToolDefinition[] = [
      { ...base, name: 'web_search', capabilities: ['discover_sources'], adapter: webAdapter },
      { ...base, name: 'http_fetch', capabilities: ['fetch_static_content'], adapter: httpAdapter },
      { ...base, name: 'read_webpage', capabilities: ['extract_web_content'], adapter: readAdapter },
    ]
    return new ResearchToolExecutor(
      new ResearchToolRegistry(definitions),
      DEFAULT_RESEARCH_TOOL_BUDGET,
      hooks,
    )
  }
}

test('Agent sufficient 时只执行 Initial QueryPlan 一轮且不修改 canonical strategy', async () => {
  const originalStrategy = JSON.stringify(strategy)
  const originalIntent = structuredClone(strategy.intent)
  const originalConfirmedIntent = structuredClone(strategy.intentConfirmation.confirmedIntent)
  const originalQueryPlan = structuredClone(strategy.queryPlan)
  const searched: SearchQuery[][] = []
  let evaluatorEvidence: ResearchAgentEvidenceRecord[] = []
  const checkpoints: ResearchAgentCheckpoint[] = []
  const result = await runResearchAgent(request, strategy, {
    onCheckpoint: (checkpoint) => { checkpoints.push(checkpoint) },
  }, {
    createToolExecutor: createMockToolExecutorFactory({
      search: async (queries) => {
        searched.push(queries)
        return makeSearch(1, queries)
      },
    }),
    evaluate: async (input) => {
      evaluatorEvidence = input.evidence
      return { status: 'sufficient', evidenceNeeds: [], followUpQueries: [] }
    },
  })
  assert.equal(JSON.stringify(strategy), originalStrategy)
  assert.deepEqual(strategy.intent, originalIntent)
  assert.deepEqual(strategy.intentConfirmation.confirmedIntent, originalConfirmedIntent)
  assert.deepEqual(strategy.queryPlan, originalQueryPlan)
  assert.deepEqual(searched, [initialQueries])
  assert.equal(evaluatorEvidence.length, 2)
  assert.ok(evaluatorEvidence.every((item) => (
    item.bindings.every((binding) => binding.agentRound === 1)
  )))
  assert.equal(checkpoints.at(-1)?.phase, 'completed')
  assert.equal(checkpoints.at(-1)?.evaluationStatus, 'sufficient')
  assert.equal(checkpoints.at(-1)?.toolCallCount, 3)
  assert.equal(checkpoints.at(-1)?.toolCallCounts?.http_fetch, 1)
  assert.equal(checkpoints.at(-1)?.currentTool, null)
  assert.ok(checkpoints.filter((item) => item.phase === 'evaluating').every(
    (item) => item.currentTool === null,
  ))
  assert.equal(result.metadata.length, result.evidenceSources.length)
})

test('HTTP-first 全部 full_text 时只 Fetch 前 8 条、跳过 Reader 并保留原 Citation URL', async () => {
  const urls = Array.from({ length: 10 }, (_, index) => `https://example.com/http-full-${index + 1}`)
  const checkpoints: ResearchAgentCheckpoint[] = []
  const readerTargets: number[] = []
  let readerCalls = 0
  let evaluatorEvidence: ResearchAgentEvidenceRecord[] = []
  const originalIntent = structuredClone(strategy.intent)
  const originalQueryPlan = structuredClone(strategy.queryPlan)
  const result = await runResearchAgent(request, strategy, {
    onCheckpoint: (checkpoint) => { checkpoints.push(checkpoint) },
    onReaderStarted: (count) => { readerTargets.push(count) },
  }, {
    createToolExecutor: createMockToolExecutorFactory({
      search: (queries) => makeSearchWithUrls(1, queries, urls),
      http: (sources) => {
        assert.equal(sources.length, 8)
        return sources.map((source) => httpItem(source, 'full_text'))
      },
      read: async (sources) => {
        readerCalls += 1
        return readSearchMetadata(sources)
      },
    }),
    evaluate: async (input) => {
      evaluatorEvidence = input.evidence
      return { status: 'sufficient', evidenceNeeds: [], followUpQueries: [] }
    },
  })
  assert.equal(readerCalls, 0)
  assert.deepEqual(readerTargets, [])
  assert.equal(checkpoints.at(-1)?.toolCallCount, 2)
  assert.deepEqual(checkpoints.at(-1)?.toolCallCounts, {
    web_search: 1,
    read_webpage: 0,
    http_fetch: 1,
  })
  assert.equal(evaluatorEvidence.filter((item) => item.evidenceType === 'full_text').length, 8)
  assert.equal(evaluatorEvidence.filter((item) => item.evidenceType === 'search_summary').length, 2)
  assert.ok(evaluatorEvidence.slice(0, 8).every((item) => (
    item.bindings.some((binding) => binding.acquisitionTool === 'web_search')
    && item.bindings.some((binding) => binding.acquisitionTool === 'http_fetch')
  )))
  assert.equal(result.metadata.length, 10)
  assert.deepEqual(result.metadata.map((item) => item.url), result.evidenceSources.map((item) => item.url))
  assert.ok(result.metadata.every((item) => !item.url.endsWith('/redirected')))
  assert.deepEqual(strategy.intent, originalIntent)
  assert.deepEqual(strategy.queryPlan, originalQueryPlan)
})

test('HTTP-first mixed batch 只把 partial/recoverable subset 交给 Reader 并按质量合并', async () => {
  const urls = Array.from({ length: 10 }, (_, index) => `https://example.com/mixed-${index + 1}`)
  let fallbackCandidateIds: string[] = []
  let readerTargetCount = 0
  let evaluatorEvidence: ResearchAgentEvidenceRecord[] = []
  const result = await runResearchAgent(request, strategy, {
    onReaderStarted: (count) => { readerTargetCount = count },
  }, {
    createToolExecutor: createMockToolExecutorFactory({
      search: (queries) => makeSearchWithUrls(1, queries, urls),
      http: (sources) => sources.map((source, index) => {
        if (index === 1 || index === 7) {
          return httpItem(source, 'partial', index === 7 ? {
            extraction: { paragraphCount: 8, linkDensity: 0.01, confidence: 0.97 },
            contentLength: 900,
            content: 'strong HTTP partial '.repeat(50),
          } : {})
        }
        if (index === 2) return httpItem(source, 'failed', { failureCode: 'TIMEOUT' })
        if (index === 3) {
          return httpItem(source, 'failed', { failureCode: 'UNSUPPORTED_CONTENT_TYPE' })
        }
        if (index === 4) {
          return httpItem(source, 'failed', { failureCode: 'PRIVATE_ADDRESS_BLOCKED' })
        }
        if (index === 5) return httpItem(source, 'failed', { failureCode: 'REDIRECT_BLOCKED' })
        return httpItem(source, 'full_text')
      }),
      read: async (sources) => {
        fallbackCandidateIds = sources.map((source) => source.candidateId)
        const batch = await readSearchMetadata(sources)
        const unsupported = batch.evidenceSources[2]!
        unsupported.evidenceType = 'search_summary'
        unsupported.content = sources[2]!.snippet
        const weaker = batch.evidenceSources[3]!
        weaker.evidenceType = 'partial'
        weaker.content = 'weak Reader partial'
        batch.readerStats.fullTextCount = 2
        batch.readerStats.partialCount = 1
        batch.readerStats.failedCount = 1
        batch.readerStats.searchSummaryCount = 1
        return batch
      },
    }),
    evaluate: async (input) => {
      evaluatorEvidence = input.evidence
      return { status: 'sufficient', evidenceNeeds: [], followUpQueries: [] }
    },
  })
  assert.equal(readerTargetCount, 4)
  assert.deepEqual(fallbackCandidateIds, [
    'candidate-r1-2',
    'candidate-r1-3',
    'candidate-r1-4',
    'candidate-r1-8',
  ])
  assert.ok(!result.metadata.some((item) => item.url === urls[4] || item.url === urls[5]))
  assert.ok(evaluatorEvidence.every((item) => item.metadata.url === item.normalizedUrl))
  const upgraded = evaluatorEvidence.find((item) => item.metadata.url === urls[1])!
  assert.equal(upgraded.evidenceType, 'full_text')
  assert.deepEqual(
    new Set(upgraded.bindings.map((binding) => binding.acquisitionTool)),
    new Set(['web_search', 'http_fetch', 'read_webpage']),
  )
  const timeoutUpgrade = evaluatorEvidence.find((item) => item.metadata.url === urls[2])!
  assert.equal(timeoutUpgrade.evidenceType, 'full_text')
  assert.deepEqual(
    new Set(timeoutUpgrade.bindings.map((binding) => binding.acquisitionTool)),
    new Set(['web_search', 'read_webpage']),
  )
  const unsupportedFallback = evaluatorEvidence.find((item) => item.metadata.url === urls[3])!
  assert.equal(unsupportedFallback.evidenceType, 'search_summary')
  assert.deepEqual(
    new Set(unsupportedFallback.bindings.map((binding) => binding.acquisitionTool)),
    new Set(['web_search']),
  )
  const preservedHttp = evaluatorEvidence.find((item) => item.metadata.url === urls[7])!
  assert.equal(preservedHttp.evidenceType, 'partial')
  assert.match(preservedHttp.content, /strong HTTP partial/)
  assert.deepEqual(
    new Set(preservedHttp.bindings.map((binding) => binding.acquisitionTool)),
    new Set(['web_search', 'http_fetch', 'read_webpage']),
  )
  assert.equal(result.readerStats.attemptedCount, 4)
  assert.equal(result.readerStats.fullTextCount, 2)
  assert.equal(result.readerStats.partialCount, 1)
  assert.equal(result.readerStats.failedCount, 1)
  assert.equal(result.warnings.filter((warning) => warning.includes('搜索摘要')).length, 1)
  assert.equal(result.warnings.filter((warning) => warning.includes('安全访问校验')).length, 1)
  assert.ok(result.metadata.some((item) => item.url === urls[8]))
  assert.ok(result.metadata.some((item) => item.url === urls[9]))
})

test('HTTP 和 Reader 均失败时保留 Search Summary 并继续 Evaluator', async () => {
  let evaluatorCalls = 0
  const result = await runResearchAgent(request, strategy, {}, {
    createToolExecutor: createMockToolExecutorFactory({
      search: (queries) => makeSearch(1, queries),
      http: (sources) => sources.map((source) => httpItem(source, 'failed', {
        failureCode: 'NETWORK_ERROR',
      })),
      read: async (sources) => ({
        evidenceSources: sources.map((source, index) => ({
          ...source,
          sourceId: `source-${index + 1}`,
          evidenceType: 'search_summary' as const,
          content: source.snippet,
        })),
        readerStats: {
          attemptedCount: sources.length,
          fullTextCount: 0,
          partialCount: 0,
          insufficientCount: 0,
          failedCount: sources.length,
          searchSummaryCount: sources.length,
          averageContentLength: 0,
          failureCategories: {
            HTTP_4XX: 0, HTTP_5XX: 0, TIMEOUT: 0, NETWORK: sources.length,
            INVALID_RESPONSE: 0, EMPTY_CONTENT: 0, UNKNOWN: 0,
          },
          httpStatusCounts: {},
        },
        warnings: ['should not be exposed'],
      }),
    }),
    evaluate: async (input) => {
      evaluatorCalls += 1
      assert.ok(input.evidence.every((item) => item.evidenceType === 'search_summary'))
      return { status: 'sufficient', evidenceNeeds: [], followUpQueries: [] }
    },
  })
  assert.equal(evaluatorCalls, 1)
  assert.equal(result.evidenceSources.length, 2)
  assert.equal(result.warnings.some((warning) => warning === 'should not be exposed'), false)
  assert.equal(result.warnings.filter((warning) => warning.includes('搜索摘要')).length, 1)
})

test('HTTP security rejection 排除 Search Summary、禁止 Reader 且全排除返回 NO_REAL_SOURCES', async () => {
  let readerCalls = 0
  let evaluatorCalls = 0
  await assert.rejects(
    runResearchAgent(request, strategy, {}, {
      createToolExecutor: createMockToolExecutorFactory({
        search: (queries) => makeSearch(1, queries),
        http: (sources) => sources.map((source, index) => httpItem(source, 'failed', {
          failureCode: index === 0 ? 'PRIVATE_ADDRESS_BLOCKED' : 'REDIRECT_BLOCKED',
        })),
        read: async (sources) => {
          readerCalls += 1
          return readSearchMetadata(sources)
        },
      }),
      evaluate: async () => {
        evaluatorCalls += 1
        return { status: 'sufficient', evidenceNeeds: [], followUpQueries: [] }
      },
    }),
    (error) => error instanceof ResearchServiceError && error.code === 'NO_REAL_SOURCES',
  )
  assert.equal(readerCalls, 0)
  assert.equal(evaluatorCalls, 0)
})

test('Agent insufficient 仅生成一次 Replan、执行第二轮并按 URL 合并 Evidence', async () => {
  const followUps = [{
    id: 'follow-up-r2-1',
    query: '中国高校 环境设计专业 AI 就业 数据',
    purpose: '补充高校就业与 AI 岗位证据',
    priority: 1,
    round: 2 as const,
    evidenceNeedIds: ['need-1'],
  }]
  const searched: SearchQuery[][] = []
  const evaluations: ResearchEvidenceEvaluation[] = [
    {
      status: 'insufficient',
      evidenceNeeds: [{
        id: 'need-1',
        label: '就业数据',
        description: '缺少高校就业数据',
        relatedQuestionIds: ['question-1'],
        status: 'open',
        supportingEvidenceIds: ['evidence-1'],
      }],
      followUpQueries: followUps,
    },
    { status: 'sufficient', evidenceNeeds: [], followUpQueries: [] },
  ]
  let evaluationCount = 0
  let secondRoundEvidence: ResearchAgentEvidenceRecord[] = []
  let readRound = 0
  const checkpoints: ResearchAgentCheckpoint[] = []
  const result = await runResearchAgent(request, strategy, {
    onCheckpoint: (checkpoint) => { checkpoints.push(checkpoint) },
  }, {
    createToolExecutor: createMockToolExecutorFactory({
      search: async (queries) => {
        searched.push(queries)
        return makeSearch(searched.length, queries)
      },
      read: async (metadata) => {
        readRound += 1
        const result = await readSearchMetadata(metadata)
        const shared = result.evidenceSources.find(
          (item) => item.url === 'https://example.com/shared',
        )
        if (shared && readRound === 1) {
          shared.evidenceType = 'partial'
          shared.content = '第一轮 partial evidence'
          result.readerStats.fullTextCount -= 1
          result.readerStats.partialCount += 1
        }
        if (shared && readRound === 2) shared.content = '第二轮 upgraded full text evidence'
        return result
      },
    }),
    evaluate: async (input) => {
      if (evaluationCount === 1) secondRoundEvidence = input.evidence
      return evaluations[evaluationCount++]!
    },
  })
  assert.equal(evaluationCount, 2)
  assert.equal(searched.length, researchAgentTestApi.maxRounds)
  assert.deepEqual(searched[1], followUps)
  assert.equal(checkpoints.filter((item) => item.phase === 'replanning').length, 1)
  assert.equal(checkpoints.at(-1)?.currentRound, 2)
  assert.equal(checkpoints.at(-1)?.replanCount, researchAgentTestApi.maxReplans)
  assert.equal(checkpoints.at(-1)?.toolCallCount, 6)
  assert.deepEqual(checkpoints.at(-1)?.toolCallCounts, {
    web_search: 2,
    read_webpage: 2,
    http_fetch: 2,
  })
  assert.equal(checkpoints.at(-1)?.currentTool, null)
  assert.equal(checkpoints.at(-1)?.toolCallCounts?.http_fetch, 2)
  assert.ok(checkpoints.filter((item) => (
    item.phase === 'evaluating' || item.phase === 'replanning' || item.phase === 'completed'
  )).every((item) => item.currentTool === null))
  assert.equal(result.deduplicatedSourceCount, 3)
  assert.equal(result.metadata.length, 3)
  assert.equal(result.evidenceSources.length, 3)
  assert.deepEqual(result.evidenceSources.map((item) => item.sourceId), [
    'source-1', 'source-2', 'source-3',
  ])
  assert.deepEqual(
    result.metadata.map((item) => item.url),
    result.evidenceSources.map((item) => item.url),
  )
  assert.equal(
    result.evidenceSources.find((item) => item.url === 'https://example.com/shared')?.content,
    '第二轮 upgraded full text evidence',
  )
  const sharedEvidence = secondRoundEvidence.find(
    (item) => item.normalizedUrl === 'https://example.com/shared',
  )
  assert.ok(sharedEvidence)
  assert.deepEqual(
    [...new Set(sharedEvidence.bindings.map((binding) => binding.agentRound))].sort(),
    [1, 2],
  )
  assert.ok(sharedEvidence.bindings.some((binding) => (
    binding.agentRound === 2
    && binding.queryId === 'follow-up-r2-1'
    && binding.evidenceNeedId === 'need-1'
    && binding.acquisitionTool === 'read_webpage'
  )))
})

test('Agent insufficient 且没有 Follow-up 时跳过 Round 2 并保留当前 Evidence', async () => {
  let searchCount = 0
  let evaluationCount = 0
  const checkpoints: ResearchAgentCheckpoint[] = []
  const result = await runResearchAgent(request, strategy, {
    onCheckpoint: (checkpoint) => { checkpoints.push(checkpoint) },
  }, {
    createToolExecutor: createMockToolExecutorFactory({
      search: (queries) => {
        searchCount += 1
        return makeSearch(searchCount, queries)
      },
    }),
    evaluate: async () => {
      evaluationCount += 1
      return {
        status: 'insufficient',
        evidenceNeeds: [{
          id: 'need-1', label: '补充数据', description: '仍可补充数据',
          relatedQuestionIds: [], status: 'open', supportingEvidenceIds: [],
        }],
        followUpQueries: [],
        replanAvailable: false,
      }
    },
  })
  assert.equal(searchCount, 1)
  assert.equal(evaluationCount, 1)
  assert.ok(result.evidenceSources.length > 0)
  assert.deepEqual(result.warnings, [replanUnavailableWarning])
  assert.equal(checkpoints.some((checkpoint) => checkpoint.phase === 'replanning'), false)
  assert.equal(checkpoints.at(-1)?.phase, 'completed')
  assert.equal(checkpoints.at(-1)?.currentRound, 1)
  assert.equal(checkpoints.at(-1)?.replanCount, 0)
  assert.equal(checkpoints.at(-1)?.evaluationStatus, 'insufficient')
  assert.deepEqual(checkpoints.at(-1)?.followUpQueries, [])
  assert.deepEqual(checkpoints.at(-1)?.toolCallCounts, {
    web_search: 1,
    read_webpage: 1,
    http_fetch: 1,
  })
})

test('Agent insufficient 且没有有效 Need 时跳过 Round 2', async () => {
  let searchCount = 0
  const checkpoints: ResearchAgentCheckpoint[] = []
  const result = await runResearchAgent(request, strategy, {
    onCheckpoint: (checkpoint) => { checkpoints.push(checkpoint) },
  }, {
    createToolExecutor: createMockToolExecutorFactory({
      search: (queries) => {
        searchCount += 1
        return makeSearch(searchCount, queries)
      },
    }),
    evaluate: async () => ({
      status: 'insufficient',
      evidenceNeeds: [],
      followUpQueries: [],
      replanAvailable: false,
    }),
  })
  assert.equal(searchCount, 1)
  assert.ok(result.evidenceSources.length > 0)
  assert.equal(result.warnings.filter((warning) => warning === replanUnavailableWarning).length, 1)
  assert.equal(checkpoints.some((checkpoint) => checkpoint.phase === 'replanning'), false)
  assert.equal(checkpoints.at(-1)?.phase, 'completed')
  assert.equal(checkpoints.at(-1)?.replanCount, 0)
  assert.deepEqual(checkpoints.at(-1)?.evidenceNeeds, [])
})

test('Agent 第二轮仍 insufficient 时强制结束，不执行第三轮', async () => {
  let searchCount = 0
  let evaluationCount = 0
  const result = await runResearchAgent(request, strategy, {}, {
    createToolExecutor: createMockToolExecutorFactory({
      search: async (queries) => {
        searchCount += 1
        return makeSearch(searchCount, queries)
      },
    }),
    evaluate: async () => {
      evaluationCount += 1
      return evaluationCount === 1
        ? {
            status: 'insufficient',
            evidenceNeeds: [{
              id: 'need-1', label: '数据', description: '缺少数据',
              relatedQuestionIds: [], status: 'open', supportingEvidenceIds: [],
            }],
            followUpQueries: [{
              id: 'follow-up-r2-1', query: '环境设计 就业 数据', purpose: '补数据',
              priority: 1, round: 2, evidenceNeedIds: ['need-1'],
            }],
          }
        : {
            status: 'insufficient',
            evidenceNeeds: [{
              id: 'need-1', label: '数据', description: '仍缺少数据',
              relatedQuestionIds: [], status: 'unresolved', supportingEvidenceIds: [],
            }],
            followUpQueries: [],
          }
    },
  })
  assert.equal(searchCount, 2)
  assert.equal(evaluationCount, 2)
  assert.ok(result.warnings.some((warning) => warning.includes('两轮上限')))
})

test('stale request 在进入 Round 2 前终止且不会继续调用 Search', async () => {
  let searchCount = 0
  let stale = false
  await assert.rejects(
    runResearchAgent(request, strategy, {
      assertCurrent: () => {
        if (stale) throw new StaleTaskWriteError()
      },
      onCheckpoint: (checkpoint) => {
        if (checkpoint.phase === 'replanning') stale = true
      },
    }, {
      createToolExecutor: createMockToolExecutorFactory({
        search: async (queries) => {
          searchCount += 1
          return makeSearch(searchCount, queries)
        },
      }),
      evaluate: async () => ({
        status: 'insufficient',
        evidenceNeeds: [{
          id: 'need-1', label: '缺口', description: '缺口',
          relatedQuestionIds: [], status: 'open', supportingEvidenceIds: [],
        }],
        followUpQueries: [{
          id: 'follow-up-r2-1', query: '环境设计 就业 补充', purpose: '补充',
          priority: 1, round: 2, evidenceNeedIds: ['need-1'],
        }],
      }),
    }),
    StaleTaskWriteError,
  )
  assert.equal(searchCount, 1)
})

test('Agent 执行异常进入 failed 且保留原始错误', async () => {
  const checkpoints: ResearchAgentCheckpoint[] = []
  const expected = new Error('search failed')
  await assert.rejects(
    runResearchAgent(request, strategy, {
      onCheckpoint: (checkpoint) => { checkpoints.push(checkpoint) },
    }, {
      createToolExecutor: createMockToolExecutorFactory({
        search: async () => { throw expected },
      }),
    }),
    (error) => error === expected,
  )
  assert.equal(checkpoints.at(-1)?.phase, 'failed')
  assert.equal(checkpoints.at(-1)?.currentTool, null)
  assert.equal(checkpoints.at(-1)?.toolCallCount, 1)
})

test('Tool 完成后 request stale 时不进入 Reader 或 Evaluator', async () => {
  let stale = false
  let httpCalls = 0
  let readerCalls = 0
  let evaluatorCalls = 0
  await assert.rejects(
    runResearchAgent(request, strategy, {
      assertCurrent: () => {
        if (stale) throw new StaleTaskWriteError()
      },
    }, {
      createToolExecutor: createMockToolExecutorFactory({
        search: async (queries) => {
          stale = true
          return makeSearch(1, queries)
        },
        http: async (sources) => {
          httpCalls += 1
          return sources.map((source) => httpItem(source))
        },
        read: async (metadata) => {
          readerCalls += 1
          return readSearchMetadata(metadata)
        },
      }),
      evaluate: async () => {
        evaluatorCalls += 1
        return { status: 'sufficient', evidenceNeeds: [], followUpQueries: [] }
      },
    }),
    StaleTaskWriteError,
  )
  assert.equal(httpCalls, 0)
  assert.equal(readerCalls, 0)
  assert.equal(evaluatorCalls, 0)
})

test('http_fetch 完成后 stale 时不进入 Reader 或 Evaluator', async () => {
  let stale = false
  let readerCalls = 0
  let evaluatorCalls = 0
  await assert.rejects(
    runResearchAgent(request, strategy, {
      assertCurrent: () => {
        if (stale) throw new StaleTaskWriteError()
      },
    }, {
      createToolExecutor: createMockToolExecutorFactory({
        search: (queries) => makeSearch(1, queries),
        http: async (sources) => {
          stale = true
          return sources.map((source) => httpItem(source, 'partial'))
        },
        read: async (sources) => {
          readerCalls += 1
          return readSearchMetadata(sources)
        },
      }),
      evaluate: async () => {
        evaluatorCalls += 1
        return { status: 'sufficient', evidenceNeeds: [], followUpQueries: [] }
      },
    }),
    StaleTaskWriteError,
  )
  assert.equal(readerCalls, 0)
  assert.equal(evaluatorCalls, 0)
})

test('Reader 完成后 stale 时不进入 Evidence Evaluator', async () => {
  let stale = false
  let evaluatorCalls = 0
  await assert.rejects(
    runResearchAgent(request, strategy, {
      assertCurrent: () => {
        if (stale) throw new StaleTaskWriteError()
      },
    }, {
      createToolExecutor: createMockToolExecutorFactory({
        search: (queries) => makeSearch(1, queries),
        read: async (sources) => {
          const result = await readSearchMetadata(sources)
          stale = true
          return result
        },
      }),
      evaluate: async () => {
        evaluatorCalls += 1
        return { status: 'sufficient', evidenceNeeds: [], followUpQueries: [] }
      },
    }),
    StaleTaskWriteError,
  )
  assert.equal(evaluatorCalls, 0)
})

test('Evidence Evaluator 限制 Follow-up 数量、去重并拒绝 URL/排除含义', async () => {
  const originalFetch = globalThis.fetch
  const oldKey = process.env.QWEN_API_KEY
  const oldBase = process.env.QWEN_BASE_URL
  process.env.QWEN_API_KEY = 'test-key'
  process.env.QWEN_BASE_URL = 'https://qwen.test/v1'
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({
      status: 'insufficient',
      intent: { researchObject: '恶意改写' },
      evidenceNeeds: [{
        id: 'raw-need', label: '招聘证据', description: '缺少岗位能力证据',
        relatedQuestionIds: ['question-2'], supportingEvidenceIds: ['evidence-1'],
      }],
      followUpQueries: [
        { query: 'https://bad.example.com', purpose: '坏链接', evidenceNeedIds: ['raw-need'] },
        { query: 'site:example.com 环境设计', purpose: '站点限定', evidenceNeedIds: ['raw-need'] },
        { query: 'bad.example.com 环境设计', purpose: '裸域名', evidenceNeedIds: ['raw-need'] },
        { query: '污染治理 环境科学', purpose: '错误方向', evidenceNeedIds: ['raw-need'] },
        { query: '环境设计专业 就业趋势', purpose: '重复初始查询', evidenceNeedIds: ['raw-need'] },
        { query: '环境设计 招聘 岗位能力', purpose: '岗位证据', evidenceNeedIds: ['raw-need'] },
        { query: '环境设计 招聘 薪酬', purpose: '薪酬证据', evidenceNeedIds: ['raw-need'] },
        { query: '环境设计 高校 就业率', purpose: '就业率证据', evidenceNeedIds: ['raw-need'] },
        { query: '环境设计 人才需求', purpose: '更多证据', evidenceNeedIds: ['raw-need'] },
      ],
    }) } }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  try {
    const evidence: ResearchAgentEvidenceRecord[] = Array.from({ length: 3 }, (_, index) => ({
      evidenceId: `evidence-${index + 1}`,
      normalizedUrl: `https://example.com/${index + 1}`,
      metadata: {
        url: `https://example.com/${index + 1}`,
        title: `来源 ${index + 1}`,
        publisher: '机构',
        publishedAt: '2026-09-01',
        snippet: '摘要',
      },
      evidenceType: 'full_text',
      content: '正文',
      sourceType: 'professional',
      bindings: [{ queryId: 'query-1', agentRound: 1, acquisitionTool: 'read_webpage' }],
    }))
    const result = await evaluateResearchEvidence({
      intent: strategy.intent,
      plan: request.researchPlanContext!,
      initialQueries,
      executedQueries: initialQueries,
      evidence,
      round: 1,
      allowReplan: true,
    })
    assert.equal(result.followUpQueries.length, researchEvidenceEvaluatorTestApi.maxFollowUpQueries)
    assert.deepEqual(result.followUpQueries.map((query) => query.query), [
      '环境设计 招聘 岗位能力',
      '环境设计 招聘 薪酬',
      '环境设计 高校 就业率',
    ])
    assert.ok(result.followUpQueries.every((query) => !/https?:|bad\.example\.com|污染治理|环境科学/.test(query.query)))
    assert.ok(result.followUpQueries.every((query) => query.query !== initialQueries[0]?.query))
    assert.ok(result.followUpQueries.every((query) => query.evidenceNeedIds[0] === 'need-1'))
    assert.equal(strategy.intent.researchObject, '环境设计专业及空间设计行业')
  } finally {
    globalThis.fetch = originalFetch
    if (oldKey === undefined) delete process.env.QWEN_API_KEY
    else process.env.QWEN_API_KEY = oldKey
    if (oldBase === undefined) delete process.env.QWEN_BASE_URL
    else process.env.QWEN_BASE_URL = oldBase
  }
})

const unavailableGuardrailCases = [
  {
    name: 'duplicate',
    query: initialQueries[0]!.query,
    evidenceNeedIds: ['raw-need'],
    reason: 'duplicate',
  },
  {
    name: 'canonical boundary',
    query: '量子物理 粒子统计',
    evidenceNeedIds: ['raw-need'],
    reason: 'canonical_boundary',
  },
  {
    name: 'excluded meaning',
    query: '污染治理 环境科学 数据',
    evidenceNeedIds: ['raw-need'],
    reason: 'excluded_meaning',
  },
  {
    name: 'URL/domain',
    query: 'https://bad.example.com 环境设计',
    evidenceNeedIds: ['raw-need'],
    reason: 'url_or_domain',
  },
  {
    name: 'invalid binding',
    query: '环境设计 招聘 能力数据',
    evidenceNeedIds: ['unknown-need'],
    reason: 'invalid_binding',
  },
] as const

for (const guardrailCase of unavailableGuardrailCases) {
  test(`Evaluator 所有 Follow-up 因 ${guardrailCase.name} 被过滤时返回 replan unavailable`, async () => {
    const warningLogs: unknown[][] = []
    const originalWarn = console.warn
    console.warn = (...values: unknown[]) => { warningLogs.push(values) }
    try {
      const result = await withMockQwenFetch(
        async () => qwenEvaluatorResponse({
          status: 'insufficient',
          evidenceNeeds: [{
            id: 'raw-need',
            label: '补充证据',
            description: '不应出现在诊断日志中的原始缺口正文',
            relatedQuestionIds: ['question-1'],
            supportingEvidenceIds: ['evidence-1'],
          }],
          followUpQueries: [{
            query: guardrailCase.query,
            purpose: '补充目的',
            evidenceNeedIds: guardrailCase.evidenceNeedIds,
          }],
        }),
        () => evaluateResearchEvidence({
          intent: strategy.intent,
          plan: request.researchPlanContext!,
          initialQueries,
          executedQueries: initialQueries,
          evidence: makeEvaluatorEvidence(),
          round: 1,
          allowReplan: true,
        }),
      )
      assert.equal(result.status, 'insufficient')
      assert.equal(result.replanAvailable, false)
      assert.equal(result.evidenceNeeds.length, 1)
      assert.deepEqual(result.followUpQueries, [])

      const diagnostic = warningLogs.find(
        ([message]) => message === '[research:agent] replan-unavailable',
      )
      assert.ok(diagnostic)
      const metadata = diagnostic[1] as Record<string, unknown>
      assert.deepEqual(Object.keys(metadata), [
        'round',
        'status',
        'validEvidenceNeedCount',
        'validFollowUpQueryCount',
        'rejectedReasonCounts',
        'evidenceCount',
        'fullTextCount',
        'partialCount',
        'searchSummaryCount',
      ])
      assert.deepEqual(metadata.rejectedReasonCounts, { [guardrailCase.reason]: 1 })
      assert.equal(metadata.evidenceCount, 8)
      assert.equal(metadata.fullTextCount, 5)
      assert.equal(metadata.partialCount, 0)
      assert.equal(metadata.searchSummaryCount, 3)
      assert.doesNotMatch(
        JSON.stringify(diagnostic),
        /bad\.example|量子物理|污染治理|环境设计专业 就业趋势|招聘 能力数据|原始缺口正文|evidence-1/,
      )

      let searchCount = 0
      const checkpoints: ResearchAgentCheckpoint[] = []
      const agentResult = await runResearchAgent(request, strategy, {
        onCheckpoint: (checkpoint) => { checkpoints.push(checkpoint) },
      }, {
        createToolExecutor: createMockToolExecutorFactory({
          search: (queries) => {
            searchCount += 1
            return makeSearch(searchCount, queries)
          },
        }),
        evaluate: async () => result,
      })
      assert.equal(searchCount, 1)
      assert.equal(agentResult.warnings.filter(
        (warning) => warning === replanUnavailableWarning,
      ).length, 1)
      assert.equal(checkpoints.some((checkpoint) => checkpoint.phase === 'replanning'), false)
      assert.equal(checkpoints.at(-1)?.replanCount, 0)
    } finally {
      console.warn = originalWarn
    }
  })
}

test('Evaluator 没有有效 Need 时返回 replan unavailable 并记录脱敏计数', async () => {
  const warningLogs: unknown[][] = []
  const originalWarn = console.warn
  console.warn = (...values: unknown[]) => { warningLogs.push(values) }
  try {
    const result = await withMockQwenFetch(
      async () => qwenEvaluatorResponse({
        status: 'insufficient',
        evidenceNeeds: [{ id: '', label: '缺口', description: '无效 Need' }],
        followUpQueries: [{
          query: '环境设计 招聘 数据',
          purpose: '补充目的',
          evidenceNeedIds: ['missing-need'],
        }],
      }),
      () => evaluateResearchEvidence({
        intent: strategy.intent,
        plan: request.researchPlanContext!,
        initialQueries,
        executedQueries: initialQueries,
        evidence: makeEvaluatorEvidence(),
        round: 1,
        allowReplan: true,
      }),
    )
    assert.equal(result.replanAvailable, false)
    assert.deepEqual(result.evidenceNeeds, [])
    assert.deepEqual(result.followUpQueries, [])
    const diagnostic = warningLogs.find(
      ([message]) => message === '[research:agent] replan-unavailable',
    )
    assert.ok(diagnostic)
    assert.deepEqual((diagnostic[1] as Record<string, unknown>).rejectedReasonCounts, {
      invalid_need: 1,
      invalid_binding: 1,
    })
  } finally {
    console.warn = originalWarn
  }
})

test('Evaluator 部分 Query 无效且至少一条有效时只用有效 Query 进入 Round 2', async () => {
  const searched: SearchQuery[][] = []
  await withMockQwenFetch(
    async () => qwenEvaluatorResponse({
      status: 'insufficient',
      evidenceNeeds: [{
        id: 'raw-need', label: '招聘证据', description: '仍需招聘数据',
        relatedQuestionIds: ['question-1'], supportingEvidenceIds: [],
      }],
      followUpQueries: [
        { query: 'https://bad.example.com', purpose: '无效链接', evidenceNeedIds: ['raw-need'] },
        { query: '环境设计 招聘 能力数据', purpose: '有效补充', evidenceNeedIds: ['raw-need'] },
      ],
    }),
    async () => {
      const result = await runResearchAgent(request, strategy, {}, {
        createToolExecutor: createMockToolExecutorFactory({
          search: (queries) => {
            searched.push(queries)
            return makeSearch(searched.length, queries)
          },
        }),
      })
      assert.equal(searched.length, 2)
      assert.equal(searched[1]?.length, 1)
      assert.equal(searched[1]?.[0]?.query, '环境设计 招聘 能力数据')
      assert.equal(result.warnings.filter((warning) => warning.includes('两轮上限')).length, 1)
      assert.equal(result.warnings.includes(replanUnavailableWarning), false)
    },
  )
})

test('Evaluator JSON、status 与 Provider fatal boundary 保持不变', async () => {
  const input = {
    intent: strategy.intent,
    plan: request.researchPlanContext!,
    initialQueries,
    executedQueries: initialQueries,
    evidence: makeEvaluatorEvidence(),
    round: 1 as const,
    allowReplan: true,
  }
  await assert.rejects(
    withMockQwenFetch(
      async () => qwenEvaluatorResponse('not-json'),
      () => evaluateResearchEvidence(input),
    ),
    (error) => error instanceof ResearchServiceError
      && error.code === 'AI_GENERATION_RESPONSE_INVALID'
      && error.diagnosticCode === 'QWEN_JSON_INVALID',
  )
  await assert.rejects(
    withMockQwenFetch(
      async () => qwenEvaluatorResponse({
        status: 'unknown', evidenceNeeds: [], followUpQueries: [],
      }),
      () => evaluateResearchEvidence(input),
    ),
    (error) => error instanceof ResearchServiceError
      && error.code === 'AI_GENERATION_RESPONSE_INVALID'
      && error.publicMessage.includes('证据完整性评估无效'),
  )
  await assert.rejects(
    withMockQwenFetch(
      async () => { throw new Error('provider unavailable') },
      () => evaluateResearchEvidence(input),
    ),
    (error) => error instanceof ResearchServiceError
      && error.code === 'AI_GENERATION_FAILED',
  )
})

test('“游戏对人的影响”5 full_text + 3 summary 且 Replan 无效时完成当前轮', async () => {
  const gameQueries: SearchQuery[] = [
    { id: 'game-query-1', query: '电子游戏 心理健康 影响', purpose: '心理影响', priority: 1 },
    { id: 'game-query-2', query: '电子游戏 认知发展 影响', purpose: '认知影响', priority: 2 },
    { id: 'game-query-3', query: '电子游戏 社会行为 影响', purpose: '社会影响', priority: 3 },
  ]
  const gameStrategy: ResearchStrategy = {
    ...strategy,
    intent: {
      normalizedTopic: '游戏对人的影响',
      researchObject: '电子游戏参与者',
      userIntent: '分析游戏对人的多维影响',
      scope: ['电子游戏', '心理健康', '认知发展', '社会行为'],
      excludedMeanings: [],
      keyConcepts: ['电子游戏', '游戏影响'],
      ambiguityDetected: false,
    },
    queryPlan: { queries: gameQueries },
  }
  const gameRequest: ResearchRequest = {
    ...request,
    topic: '游戏对人的影响',
    goal: gameStrategy.intent.userIntent,
    researchStrategy: gameStrategy,
    researchPlanContext: {
      objective: gameStrategy.intent.userIntent,
      scope: gameStrategy.intent.scope.join('；'),
      questions: gameQueries.map((query, index) => ({ id: `game-question-${index + 1}`, text: query.purpose })),
      sourcePreferences: [],
    },
  }
  const urls = Array.from({ length: 8 }, (_, index) => `https://example.com/game-${index + 1}`)
  const searched: SearchQuery[][] = []
  const checkpoints: ResearchAgentCheckpoint[] = []
  await withMockQwenFetch(
    async () => qwenEvaluatorResponse({
      status: 'insufficient',
      evidenceNeeds: [],
      followUpQueries: [],
    }),
    async () => {
      const result = await runResearchAgent(gameRequest, gameStrategy, {
        onCheckpoint: (checkpoint) => { checkpoints.push(checkpoint) },
      }, {
        createToolExecutor: createMockToolExecutorFactory({
          search: (queries) => {
            searched.push(queries)
            return makeSearchWithUrls(1, queries, urls)
          },
          http: (sources) => sources.map((source, index) => (
            index < 5
              ? httpItem(source, 'full_text')
              : httpItem(source, 'failed', { failureCode: 'EMPTY_CONTENT' })
          )),
          read: async (sources) => ({
            evidenceSources: sources.map((source, index) => ({
              ...source,
              sourceId: `source-${index + 1}`,
              evidenceType: 'search_summary' as const,
              content: source.snippet,
            })),
            readerStats: {
              attemptedCount: sources.length,
              fullTextCount: 0,
              partialCount: 0,
              insufficientCount: 0,
              failedCount: sources.length,
              searchSummaryCount: sources.length,
              averageContentLength: 0,
              failureCategories: {
                HTTP_4XX: 0, HTTP_5XX: 0, TIMEOUT: 0, NETWORK: 0,
                INVALID_RESPONSE: 0, EMPTY_CONTENT: sources.length, UNKNOWN: 0,
              },
              httpStatusCounts: {},
            },
            warnings: [],
          }),
        }),
      })
      assert.equal(searched.length, 1)
      assert.equal(result.evidenceSources.filter((item) => item.evidenceType === 'full_text').length, 5)
      assert.equal(result.evidenceSources.filter((item) => item.evidenceType === 'search_summary').length, 3)
      assert.equal(result.warnings.filter((warning) => warning === replanUnavailableWarning).length, 1)
      assert.equal(checkpoints.some((checkpoint) => checkpoint.phase === 'replanning'), false)
      assert.equal(checkpoints.at(-1)?.phase, 'completed')
      assert.equal(checkpoints.at(-1)?.currentRound, 1)
      assert.equal(checkpoints.at(-1)?.replanCount, 0)
      assert.deepEqual(checkpoints.at(-1)?.toolCallCounts, {
        web_search: 1,
        read_webpage: 1,
        http_fetch: 1,
      })
    },
  )
})

test('Replan unavailable 后完整 Research 链路只执行一次 Synthesis', async () => {
  const originalFetch = globalThis.fetch
  const environment = {
    GLM_API_KEY: process.env.GLM_API_KEY,
    GLM_BASE_URL: process.env.GLM_BASE_URL,
    QWEN_API_KEY: process.env.QWEN_API_KEY,
    QWEN_BASE_URL: process.env.QWEN_BASE_URL,
  }
  let searchCallCount = 0
  let evaluatorCallCount = 0
  let synthesisCallCount = 0
  let synthesisStartedCount = 0
  process.env.GLM_API_KEY = 'test-glm-key'
  process.env.GLM_BASE_URL = 'https://glm.test/api/paas/v4'
  process.env.QWEN_API_KEY = 'test-qwen-key'
  process.env.QWEN_BASE_URL = 'https://qwen.test/v1'
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    if (url.endsWith('/web_search')) {
      searchCallCount += 1
      return new Response(JSON.stringify({
        search_result: Array.from({ length: 6 }, (_, index) => ({
          title: `电子游戏影响研究 ${index + 1}`,
          link: `https://game-source-${index + 1}.example.com/article`,
          content: `电子游戏对心理健康、认知发展与社会行为的影响 ${index + 1}`.repeat(20),
          media: `研究机构 ${index + 1}`,
          publish_date: '2026-09-01',
        })),
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (url.endsWith('/reader')) {
      return new Response(JSON.stringify({
        reader_result: { content: '电子游戏影响研究正文证据'.repeat(100) },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    const body = JSON.parse(String(init?.body)) as {
      messages?: Array<{ role?: string; content?: string }>
    }
    const prompt = body.messages?.map((message) => message.content ?? '').join('\n') ?? ''
    if (prompt.includes('请评估这些证据是否足以回答')) {
      evaluatorCallCount += 1
      return qwenEvaluatorResponse({
        status: 'insufficient',
        evidenceNeeds: [],
        followUpQueries: [],
      })
    }
    synthesisCallCount += 1
    return qwenEvaluatorResponse({
      summary: '研究摘要',
      insights: [{
        title: '主要影响',
        content: '游戏可能同时产生积极与消极影响。',
        sourceUrls: ['https://game-source-1.example.com/article'],
      }],
      warnings: [],
    })
  }
  try {
    const gameStrategy: ResearchStrategy = {
      ...strategy,
      intent: {
        normalizedTopic: '游戏对人的影响',
        researchObject: '电子游戏参与者',
        userIntent: '分析游戏对人的多维影响',
        scope: ['电子游戏', '心理健康', '认知发展', '社会行为'],
        excludedMeanings: [],
        keyConcepts: ['电子游戏', '游戏影响'],
        ambiguityDetected: false,
      },
      intentConfirmation: {
        status: 'not_required',
        candidates: [],
      },
      queryPlan: {
        queries: [
          { id: 'game-query-1', query: '电子游戏 心理健康 影响', purpose: '心理影响', priority: 1 },
          { id: 'game-query-2', query: '电子游戏 认知发展 影响', purpose: '认知影响', priority: 2 },
          { id: 'game-query-3', query: '电子游戏 社会行为 影响', purpose: '社会影响', priority: 3 },
        ],
      },
    }
    const result = await researchWithProviders({
      ...request,
      topic: '游戏对人的影响',
      goal: gameStrategy.intent.userIntent,
      researchStrategy: gameStrategy,
      researchPlanContext: {
        objective: gameStrategy.intent.userIntent,
        scope: gameStrategy.intent.scope.join('；'),
        questions: gameStrategy.queryPlan.queries.map((query, index) => ({
          id: `game-question-${index + 1}`,
          text: query.purpose,
        })),
        sourcePreferences: [],
      },
    }, {
      onSynthesisStarted: () => { synthesisStartedCount += 1 },
    })
    assert.equal(searchCallCount, 3)
    assert.equal(evaluatorCallCount, 1)
    assert.equal(synthesisStartedCount, 1)
    assert.equal(synthesisCallCount, 1)
    assert.equal(result.summary, '研究摘要')
    assert.equal(result.warnings.filter((warning) => warning === replanUnavailableWarning).length, 1)
  } finally {
    globalThis.fetch = originalFetch
    Object.entries(environment).forEach(([name, value]) => {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    })
  }
})

test('Agent checkpoint JSONB roundtrip 保留内部状态但公开 DTO 只暴露安全计数', () => {
  const checkpoint: ResearchAgentCheckpoint = {
    version: 1,
    currentRound: 2,
    maxRounds: 2,
    replanCount: 1,
    maxReplans: 1,
    phase: 'round_search',
    evaluationStatus: 'insufficient',
    evidenceNeeds: [{
      id: 'need-1', label: '内部缺口', description: '内部描述',
      relatedQuestionIds: ['question-1'], status: 'open', supportingEvidenceIds: ['evidence-1'],
    }],
    followUpQueries: [{
      id: 'follow-up-r2-1', query: '内部完整查询', purpose: '内部目的',
      priority: 1, round: 2, evidenceNeedIds: ['need-1'],
    }],
    evidenceCount: 4,
    currentTool: 'web_search',
    toolCallCount: 3,
    toolCallCounts: { web_search: 2, read_webpage: 1 },
    updatedAt: '2026-09-01T00:00:00.000Z',
  }
  const storedInput = { ...emptyResearchJobProgress(), agentState: checkpoint }
  const roundtripped = normalizeStoredResearchJobProgress(JSON.parse(JSON.stringify(storedInput)))
  assert.deepEqual(roundtripped.agentState, checkpoint)
  const publicProgress = toPublicResearchJobProgress(storedInput)
  assert.equal(publicProgress.agent?.followUpQueryCount, 1)
  assert.equal(publicProgress.agent?.evidenceNeedCount, 1)
  assert.equal(publicProgress.agent?.currentTool, 'web_search')
  assert.equal(publicProgress.agent?.toolCallCount, 3)
  assert.doesNotMatch(
    JSON.stringify(publicProgress),
    /内部完整查询|内部缺口|内部描述|executionId|toolCallCounts|arguments|https:\/\//,
  )
  const unsafePublicProgress = toPublicResearchJobProgress({
    ...emptyResearchJobProgress(),
    agentState: {
      ...checkpoint,
      arguments: { query: '敏感 Query', url: 'https://secret.example.com' },
      executionId: 'secret-execution-id',
      result: { providerResponse: 'secret-response' },
    },
  })
  assert.doesNotMatch(
    JSON.stringify(unsafePublicProgress),
    /敏感 Query|secret\.example|secret-execution-id|secret-response|arguments|result/,
  )

  const legacyCheckpoint = structuredClone(checkpoint)
  delete legacyCheckpoint.currentTool
  delete legacyCheckpoint.toolCallCount
  delete legacyCheckpoint.toolCallCounts
  const legacyProgress = toPublicResearchJobProgress({
    ...emptyResearchJobProgress(),
    agentState: legacyCheckpoint,
  })
  assert.equal(legacyProgress.agent?.currentTool, null)
  assert.equal(legacyProgress.agent?.toolCallCount, 0)
})

test('Agent v1 硬边界与 Tool Registry 固定且不写用户资料池', () => {
  assert.equal(researchAgentTestApi.maxRounds, 2)
  assert.equal(researchAgentTestApi.maxReplans, 1)
  assert.equal(researchAgentTestApi.maxFollowUpQueries, 3)
  assert.deepEqual(RESEARCH_AGENT_TOOL_REGISTRY, ['web_search', 'read_webpage', 'http_fetch'])
  const source = readFileSync('server/services/researchAgentService.ts', 'utf8')
  assert.doesNotMatch(source, /searchResearchSourcesWithGlm|enrichResearchSourcesWithGlm/)
  assert.match(source, /tool:\s*['"]http_fetch['"]/)
  assert.doesNotMatch(source, /research_pool_items|addOwnedPoolItem/)
  const apiSource = readFileSync('src/services/researchApi.ts', 'utf8')
  const contextSource = readFileSync('src/context/ResearchContext.tsx', 'utf8')
  const pageSource = readFileSync('src/pages/SearchResultsPage.tsx', 'utf8')
  assert.match(apiSource, /'http_fetch'/)
  assert.match(contextSource, /agent\.currentTool === 'http_fetch'/)
  assert.match(pageSource, /正在获取网页内容/)
  assert.doesNotMatch(pageSource, /fallbackSources|executionId|failureCode/)
})

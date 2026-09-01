import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { StaleTaskWriteError } from '../server/db/errors'
import {
  runResearchAgent,
  researchAgentTestApi,
} from '../server/services/researchAgentService'
import {
  evaluateResearchEvidence,
  researchEvidenceEvaluatorTestApi,
} from '../server/services/researchEvidenceEvaluatorService'
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

function makeSearch(round: number, queries: SearchQuery[]) {
  const urls = round === 1
    ? ['https://example.com/shared', 'https://example.com/round-1']
    : ['https://example.com/shared', 'https://example.com/round-2']
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
    search: async (_request, _strategy, queries) => {
      searched.push(queries ?? [])
      return makeSearch(1, queries ?? [])
    },
    read: async (metadata) => readSearchMetadata(metadata),
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
  assert.equal(result.metadata.length, result.evidenceSources.length)
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
    search: async (_request, _strategy, queries) => {
      const executed = queries ?? []
      searched.push(executed)
      return makeSearch(searched.length, executed)
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

test('Agent 第二轮仍 insufficient 时强制结束，不执行第三轮', async () => {
  let searchCount = 0
  let evaluationCount = 0
  const result = await runResearchAgent(request, strategy, {}, {
    search: async (_request, _strategy, queries) => {
      searchCount += 1
      return makeSearch(searchCount, queries ?? [])
    },
    read: async (metadata) => readSearchMetadata(metadata),
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
  let assertionCount = 0
  await assert.rejects(
    runResearchAgent(request, strategy, {
      assertCurrent: () => {
        assertionCount += 1
        if (assertionCount === 5) throw new StaleTaskWriteError()
      },
    }, {
      search: async (_request, _strategy, queries) => {
        searchCount += 1
        return makeSearch(searchCount, queries ?? [])
      },
      read: async (metadata) => readSearchMetadata(metadata),
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
      search: async () => { throw expected },
    }),
    (error) => error === expected,
  )
  assert.equal(checkpoints.at(-1)?.phase, 'failed')
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
    updatedAt: '2026-09-01T00:00:00.000Z',
  }
  const storedInput = { ...emptyResearchJobProgress(), agentState: checkpoint }
  const roundtripped = normalizeStoredResearchJobProgress(JSON.parse(JSON.stringify(storedInput)))
  assert.deepEqual(roundtripped.agentState, checkpoint)
  const publicProgress = toPublicResearchJobProgress(storedInput)
  assert.equal(publicProgress.agent?.followUpQueryCount, 1)
  assert.equal(publicProgress.agent?.evidenceNeedCount, 1)
  assert.doesNotMatch(JSON.stringify(publicProgress), /内部完整查询|内部缺口|内部描述/)
})

test('Agent v1 硬边界与 Tool Registry 固定且不写用户资料池', () => {
  assert.equal(researchAgentTestApi.maxRounds, 2)
  assert.equal(researchAgentTestApi.maxReplans, 1)
  assert.equal(researchAgentTestApi.maxFollowUpQueries, 3)
  const source = readFileSync('server/services/researchAgentService.ts', 'utf8')
  assert.match(source, /'web_search', 'read_webpage'/)
  assert.doesNotMatch(source, /research_pool_items|addOwnedPoolItem/)
})

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { ResearchServiceError } from '../server/services/serviceError'
import {
  DEFAULT_RESEARCH_TOOL_BUDGET,
  ResearchToolExecutor,
} from '../server/services/researchToolExecutor'
import {
  defaultResearchToolRegistry,
  ResearchToolRegistry,
} from '../server/services/researchToolRegistry'
import type { ResearchRequest, ResearchStrategy, ResearchToolName } from '../server/types/research'
import {
  ResearchToolRuntimeError,
  type ResearchToolAdapter,
  type ResearchToolBudget,
  type ResearchToolCall,
  type ResearchToolDefinition,
  type ResearchToolExecutionContext,
  type ResearchToolResult,
} from '../server/types/researchTool'

const strategy: ResearchStrategy = {
  version: 2,
  intent: {
    normalizedTopic: '测试主题',
    researchObject: '测试主题',
    userIntent: '分析测试主题',
    scope: ['测试主题'],
    excludedMeanings: [],
    keyConcepts: ['测试主题'],
    ambiguityDetected: false,
  },
  queryPlan: {
    queries: [{ id: 'query-1', query: '测试主题 趋势', purpose: '趋势', priority: 1 }],
  },
  intentConfirmation: { status: 'not_required', candidates: [] },
  queryPlanStatus: 'ready',
}

const request: ResearchRequest = {
  taskId: 'task-tool-runtime',
  requestId: 'request-tool-runtime',
  topic: '测试主题',
  goal: '分析测试主题',
  sourcePreferences: [],
  targetSourceCount: 8,
  researchStrategy: strategy,
}

const context: ResearchToolExecutionContext = { request, strategy }

function call(tool: 'web_search' = 'web_search'): ResearchToolCall {
  if (tool === 'web_search') {
    return {
      executionId: randomUUID(),
      tool,
      round: 1,
      evidenceNeedIds: [],
      queries: strategy.queryPlan.queries,
    }
  }
  throw new Error('unsupported test Tool')
}

function resultFor(callValue: ResearchToolCall): ResearchToolResult {
  if (callValue.tool === 'web_search') {
    return {
      executionId: callValue.executionId,
      tool: 'web_search',
      status: 'success',
      actualSourceCount: 1,
      deduplicatedSourceCount: 1,
      sources: [],
      warnings: [],
    }
  }
  return {
    executionId: callValue.executionId,
    tool: 'read_webpage',
    status: 'success',
    evidenceSources: [],
    readerStats: {
      attemptedCount: 0,
      fullTextCount: 0,
      partialCount: 0,
      insufficientCount: 0,
      failedCount: 0,
      searchSummaryCount: 0,
      averageContentLength: 0,
      failureCategories: {
        HTTP_4XX: 0, HTTP_5XX: 0, TIMEOUT: 0, NETWORK: 0,
        INVALID_RESPONSE: 0, EMPTY_CONTENT: 0, UNKNOWN: 0,
      },
      httpStatusCounts: {},
    },
    warnings: [],
  }
}

function definition(
  name: ResearchToolName,
  adapter: ResearchToolAdapter,
  options: Partial<Pick<ResearchToolDefinition, 'enabled' | 'maxCallsPerRun' | 'validateArguments'>> = {},
): ResearchToolDefinition {
  return {
    name,
    description: `${name} test definition`,
    capabilities: name === 'web_search'
      ? ['discover_sources']
      : name === 'http_fetch'
        ? ['fetch_static_content']
        : ['extract_web_content'],
    supportedSourceTypes: ['general_web'],
    costLevel: 'low',
    latencyLevel: 'low',
    maxCallsPerRun: options.maxCallsPerRun ?? 4,
    enabled: options.enabled ?? true,
    validateArguments: options.validateArguments ?? (() => true),
    adapter,
  }
}

function readCall(): ResearchToolCall {
  return {
    executionId: randomUUID(),
    tool: 'read_webpage',
    round: 1,
    evidenceNeedIds: [],
    sources: [{
      url: 'https://example.com/source',
      title: '测试主题来源',
      publisher: '测试机构',
      publishedAt: '2026-09-01',
      snippet: '测试主题摘要',
    }],
  }
}

test('默认 Research Tool Registry 只读且精确注册三个生产 Tool', () => {
  assert.deepEqual(
    defaultResearchToolRegistry.list().map((item) => item.name),
    ['web_search', 'read_webpage', 'http_fetch'],
  )
  assert.ok(Object.isFrozen(defaultResearchToolRegistry.list()[0]))
  assert.ok(Object.isFrozen(defaultResearchToolRegistry.list()[0]?.capabilities))
})

test('Registry 拒绝 duplicate definition', () => {
  const adapter: ResearchToolAdapter = async (callValue) => resultFor(callValue)
  assert.throws(
    () => new ResearchToolRegistry([
      definition('web_search', adapter),
      definition('web_search', adapter),
    ]),
    (error) => error instanceof ResearchToolRuntimeError
      && error.code === 'RESEARCH_TOOL_UNAVAILABLE',
  )
})

test('Executor 拒绝 unknown/disabled Tool 且不消耗 budget', async () => {
  let adapterCalls = 0
  const adapter: ResearchToolAdapter = async (callValue) => {
    adapterCalls += 1
    return resultFor(callValue)
  }
  const registry = new ResearchToolRegistry([
    definition('web_search', adapter, { enabled: false }),
  ])
  const executor = new ResearchToolExecutor(registry)
  await assert.rejects(
    executor.execute({ ...call(), tool: 'unknown_tool' }, context),
    (error) => error instanceof ResearchToolRuntimeError
      && error.code === 'RESEARCH_TOOL_UNAVAILABLE',
  )
  await assert.rejects(
    executor.execute(call(), context),
    (error) => error instanceof ResearchToolRuntimeError
      && error.code === 'RESEARCH_TOOL_UNAVAILABLE',
  )
  assert.equal(adapterCalls, 0)
  assert.equal(executor.getSnapshot().toolCallCount, 0)
})

test('invalid arguments 不执行 Adapter 且不消耗 budget', async () => {
  let adapterCalls = 0
  const registry = new ResearchToolRegistry([
    definition('web_search', async (callValue) => {
      adapterCalls += 1
      return resultFor(callValue)
    }, { validateArguments: () => false }),
  ])
  const executor = new ResearchToolExecutor(registry)
  await assert.rejects(
    executor.execute(call(), context),
    (error) => error instanceof ResearchToolRuntimeError
      && error.code === 'RESEARCH_TOOL_ARGUMENTS_INVALID',
  )
  assert.equal(adapterCalls, 0)
  assert.deepEqual(executor.getSnapshot(), {
    currentTool: null,
    toolCallCount: 0,
    toolCallCounts: { web_search: 0, read_webpage: 0, http_fetch: 0 },
  })
})

test('Executor total 与 per-tool invocation budget 均生效', async () => {
  const adapter: ResearchToolAdapter = async (callValue) => resultFor(callValue)
  const registry = new ResearchToolRegistry([
    definition('web_search', adapter),
    definition('read_webpage', adapter),
  ])
  const totalBudget: ResearchToolBudget = {
    maxTotalCalls: 1,
    maxCallsByTool: { web_search: 2, read_webpage: 2, http_fetch: 2 },
  }
  const totalExecutor = new ResearchToolExecutor(registry, totalBudget)
  await totalExecutor.execute(call(), context)
  await assert.rejects(
    totalExecutor.execute(readCall(), context),
    (error) => error instanceof ResearchToolRuntimeError
      && error.code === 'RESEARCH_TOOL_BUDGET_EXCEEDED',
  )

  const perToolBudget: ResearchToolBudget = {
    maxTotalCalls: 4,
    maxCallsByTool: { web_search: 1, read_webpage: 2, http_fetch: 2 },
  }
  const perToolExecutor = new ResearchToolExecutor(registry, perToolBudget)
  await perToolExecutor.execute(call(), context)
  await assert.rejects(
    perToolExecutor.execute(call(), context),
    (error) => error instanceof ResearchToolRuntimeError
      && error.code === 'RESEARCH_TOOL_BUDGET_EXCEEDED',
  )
})

test('Provider fatal 调用消耗一次 budget、不自动 retry 且清理 currentTool', async () => {
  const expected = new ResearchServiceError('RESEARCH_SEARCH_FAILED', 502, 'provider failed')
  let adapterCalls = 0
  const progress: Array<{ currentTool: ResearchToolName | null; toolCallCount: number }> = []
  const registry = new ResearchToolRegistry([
    definition('web_search', async () => {
      adapterCalls += 1
      throw expected
    }),
  ])
  const executor = new ResearchToolExecutor(registry, DEFAULT_RESEARCH_TOOL_BUDGET, {
    onProgress: (value) => {
      progress.push({ currentTool: value.currentTool, toolCallCount: value.toolCallCount })
    },
  })
  await assert.rejects(executor.execute(call(), context), (error) => error === expected)
  assert.equal(adapterCalls, 1)
  assert.equal(executor.getSnapshot().toolCallCount, 1)
  assert.equal(executor.getSnapshot().currentTool, null)
  assert.deepEqual(progress, [
    { currentTool: 'web_search', toolCallCount: 1 },
    { currentTool: null, toolCallCount: 1 },
  ])
})

test('默认 Adapter 继续复用 GLM Search/Reader 并保留 warning、fallback 与原错误', async () => {
  const originalFetch = globalThis.fetch
  const oldKey = process.env.GLM_API_KEY
  const oldBaseUrl = process.env.GLM_BASE_URL
  process.env.GLM_API_KEY = 'test-glm-key'
  process.env.GLM_BASE_URL = 'https://glm.test'
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    if (url.endsWith('/web_search')) {
      const body = JSON.parse(String(init?.body)) as { search_query: string }
      if (body.search_query.includes('失败')) {
        return new Response(JSON.stringify({ error: 'failed' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({
        search_result: [{
          link: 'https://example.com/source',
          title: '测试主题行业趋势',
          content: '测试主题的真实搜索摘要',
          media: '测试机构',
          publish_date: '2026-09-01',
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (url.endsWith('/reader')) {
      return new Response(JSON.stringify({ error: 'reader failed' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    throw new Error(`Unexpected URL: ${url}`)
  }
  try {
    const executor = new ResearchToolExecutor()
    const search = await executor.execute({
      executionId: randomUUID(),
      tool: 'web_search',
      round: 1,
      evidenceNeedIds: [],
      queries: [
        strategy.queryPlan.queries[0]!,
        { id: 'query-2', query: '失败方向', purpose: '失败测试', priority: 2 },
      ],
    }, context)
    assert.equal(search.tool, 'web_search')
    assert.equal(search.status, 'partial')
    assert.equal(search.warnings.length, 1)
    assert.equal(search.sources.length, 1)

    const reader = await executor.execute({
      executionId: randomUUID(),
      tool: 'read_webpage',
      round: 1,
      evidenceNeedIds: [],
      sources: search.sources,
    }, context)
    assert.equal(reader.tool, 'read_webpage')
    assert.equal(reader.status, 'partial')
    assert.equal(reader.readerStats.failedCount, 1)
    assert.equal(reader.readerStats.failureCategories.HTTP_5XX, 1)
    assert.equal(reader.evidenceSources[0]?.evidenceType, 'search_summary')
    assert.equal(reader.evidenceSources[0]?.content, '测试主题的真实搜索摘要')

    await assert.rejects(
      new ResearchToolExecutor().execute({
        executionId: randomUUID(),
        tool: 'web_search',
        round: 1,
        evidenceNeedIds: [],
        queries: [{ id: 'query-fail', query: '失败', purpose: '失败', priority: 1 }],
      }, context),
      (error) => error instanceof ResearchServiceError
        && error.code === 'RESEARCH_SEARCH_FAILED'
        && error.statusCode === 502,
    )
  } finally {
    globalThis.fetch = originalFetch
    if (oldKey === undefined) delete process.env.GLM_API_KEY
    else process.env.GLM_API_KEY = oldKey
    if (oldBaseUrl === undefined) delete process.env.GLM_BASE_URL
    else process.env.GLM_BASE_URL = oldBaseUrl
  }
})

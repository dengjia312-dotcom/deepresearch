import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createMimoWebSearchStartupDiagnosticRunner } from '../server/services/mimoWebSearchStartupDiagnostic'
import { MimoServiceError } from '../server/services/mimoResearchService'
import type { ResearchRequest, ResearchResponse } from '../server/types/research'

const testConfiguration = {
  apiKey: 'diagnostic-secret-key',
  baseUrl: 'https://api.xiaomimimo.com/v1',
  model: 'mimo-v2.5',
  configured: true,
}

function successResponse() {
  return new Response(JSON.stringify({
    choices: [{
      finish_reason: 'stop',
      message: {
        content: 'sensitive response body',
        annotations: [{
          type: 'url_citation',
          url: 'https://sensitive.example/source',
          title: 'sensitive title',
          summary: 'sensitive summary',
        }],
      },
    }],
    usage: {
      web_search_usage: { tool_usage: 3, page_usage: 9 },
    },
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function successfulResearch(request: ResearchRequest): Promise<ResearchResponse> {
  return {
    taskId: request.taskId,
    requestId: request.requestId,
    mode: 'live',
    dataSource: 'real',
    topic: request.topic,
    summary: 'sensitive production summary',
    insights: [],
    sources: Array.from({ length: 12 }, (_, index) => ({
      id: `source-${index + 1}`,
      title: 'sensitive source title',
      url: `https://sensitive.example/source-${index + 1}`,
      publisher: 'sensitive publisher',
      publishedAt: '2026-08-27',
      type: '行业媒体',
      credibility: '待评估',
      summary: 'sensitive source summary',
      keyInsight: 'sensitive source insight',
    })),
    warnings: [],
    targetSourceCount: 12,
    actualSourceCount: 48,
    deduplicatedSourceCount: 47,
    validSourceCount: 12,
    searchedAt: '2026-08-27T00:00:00.000Z',
  }
}

test('环境变量未严格开启时完全不调用 MiMo', () => {
  let fetchCount = 0
  const disabledValues = [undefined, 'false', 'TRUE', '1']
  disabledValues.forEach((value) => {
    const runner = createMimoWebSearchStartupDiagnosticRunner({
      environment: { AI_WEB_SEARCH_STARTUP_DIAGNOSTIC: value },
      fetchImpl: async () => {
        fetchCount += 1
        return successResponse()
      },
      getConfiguration: () => testConfiguration,
    })

    assert.equal(runner(), null)
  })
  assert.equal(fetchCount, 0)
})

test('环境变量开启时诊断在进程内最多调用一次', async () => {
  let fetchCount = 0
  let researchCount = 0
  let requestBody: Record<string, unknown> | null = null
  let researchRequest: ResearchRequest | null = null
  const executionOrder: string[] = []
  const runner = createMimoWebSearchStartupDiagnosticRunner({
    environment: { AI_WEB_SEARCH_STARTUP_DIAGNOSTIC: 'true' },
    fetchImpl: async (_input, init) => {
      fetchCount += 1
      executionOrder.push('minimal')
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      return successResponse()
    },
    getConfiguration: () => testConfiguration,
    logger: { info: () => undefined, error: () => undefined },
    runResearch: async (request) => {
      researchCount += 1
      executionOrder.push('production')
      researchRequest = request
      return successfulResearch(request)
    },
  })

  const first = runner()
  const second = runner()
  assert.ok(first)
  assert.equal(second, null)
  await first
  assert.equal(fetchCount, 1)
  assert.equal(researchCount, 1)
  assert.deepEqual(executionOrder, ['minimal', 'production'])
  assert.ok(requestBody)
  assert.equal(requestBody.model, 'mimo-v2.5')
  assert.equal(requestBody.tool_choice, 'auto')
  assert.equal(requestBody.stream, false)
  assert.equal(requestBody.max_completion_tokens, 1024)
  assert.equal(requestBody.temperature, 1.0)
  assert.deepEqual(requestBody.thinking, { type: 'disabled' })
  assert.deepEqual(requestBody.tools, [{
    type: 'web_search',
    max_keyword: 3,
    force_search: true,
    limit: 3,
  }])
  assert.ok(researchRequest)
  assert.equal(researchRequest.topic, 'C端产品经理基础')
  assert.equal(researchRequest.targetSourceCount, 12)
  assert.equal(researchRequest.sourcePreferences.length, 5)
})

test('诊断日志只包含安全结构摘要', async () => {
  const logs: Array<{ message: string; details: Record<string, unknown> }> = []
  const runner = createMimoWebSearchStartupDiagnosticRunner({
    environment: { AI_WEB_SEARCH_STARTUP_DIAGNOSTIC: 'true' },
    fetchImpl: async () => successResponse(),
    getConfiguration: () => testConfiguration,
    logger: {
      info: (message, details) => logs.push({ message, details }),
      error: (message, details) => logs.push({ message, details }),
    },
    runResearch: successfulResearch,
  })

  await runner()

  assert.equal(logs.length, 2)
  assert.equal(logs[0]?.message, '[diagnostic:web-search:minimal] result')
  assert.deepEqual(logs[0]?.details, {
    httpStatus: 200,
    annotationCount: 1,
    annotationTypes: ['url_citation'],
    hasWebSearchUsage: true,
    toolUsage: 3,
    pageUsage: 9,
    finishReason: 'stop',
    durationMs: logs[0]?.details.durationMs,
  })
  assert.equal(logs[1]?.message, '[diagnostic:web-search:production] result')
  assert.deepEqual(logs[1]?.details, {
    success: true,
    actualSourceCount: 48,
    deduplicatedSourceCount: 47,
    finalSourceCount: 12,
    durationMs: logs[1]?.details.durationMs,
    errorCode: null,
    bodyFingerprint: '4f36b17ae541',
  })
  const serializedLogs = JSON.stringify(logs)
  assert.doesNotMatch(serializedLogs, /diagnostic-secret-key/)
  assert.doesNotMatch(serializedLogs, /sensitive\.example/)
  assert.doesNotMatch(serializedLogs, /sensitive response body|sensitive title|sensitive summary/)
})

test('A/B 诊断失败不会抛错或依赖 route 与数据库路径', async () => {
  const errors: Array<Record<string, unknown>> = []
  const runner = createMimoWebSearchStartupDiagnosticRunner({
    environment: { AI_WEB_SEARCH_STARTUP_DIAGNOSTIC: 'true' },
    fetchImpl: async () => { throw new Error('network unavailable') },
    getConfiguration: () => testConfiguration,
    logger: {
      info: () => undefined,
      error: (_message, details) => errors.push(details),
    },
    runResearch: async () => {
      throw new MimoServiceError('NO_REAL_SOURCES', 502, 'no sources')
    },
  })

  await assert.doesNotReject(async () => runner())
  assert.equal(errors[0]?.errorCode, 'MIMO_NETWORK_ERROR')
  assert.equal(errors[1]?.errorCode, 'NO_REAL_SOURCES')

  const source = readFileSync(
    new URL('../server/services/mimoWebSearchStartupDiagnostic.ts', import.meta.url),
    'utf8',
  )
  assert.doesNotMatch(source, /ResearchContext|taskRepository|startOwnedStage|database/i)
})

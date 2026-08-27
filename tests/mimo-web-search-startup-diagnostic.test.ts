import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createMimoWebSearchStartupDiagnosticRunner } from '../server/services/mimoWebSearchStartupDiagnostic'

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
  let requestBody: Record<string, unknown> | null = null
  const runner = createMimoWebSearchStartupDiagnosticRunner({
    environment: { AI_WEB_SEARCH_STARTUP_DIAGNOSTIC: 'true' },
    fetchImpl: async (_input, init) => {
      fetchCount += 1
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      return successResponse()
    },
    getConfiguration: () => testConfiguration,
  })

  const first = runner()
  const second = runner()
  assert.ok(first)
  assert.equal(second, null)
  await first
  assert.equal(fetchCount, 1)
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
  })

  await runner()

  assert.equal(logs.length, 1)
  assert.equal(logs[0]?.message, '[diagnostic:web-search] result')
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
  const serializedLogs = JSON.stringify(logs)
  assert.doesNotMatch(serializedLogs, /diagnostic-secret-key/)
  assert.doesNotMatch(serializedLogs, /sensitive\.example/)
  assert.doesNotMatch(serializedLogs, /sensitive response body|sensitive title|sensitive summary/)
})

test('诊断失败不会抛错或依赖正式 Research 与数据库路径', async () => {
  const errors: Array<Record<string, unknown>> = []
  const runner = createMimoWebSearchStartupDiagnosticRunner({
    environment: { AI_WEB_SEARCH_STARTUP_DIAGNOSTIC: 'true' },
    fetchImpl: async () => { throw new Error('network unavailable') },
    getConfiguration: () => testConfiguration,
    logger: {
      info: () => undefined,
      error: (_message, details) => errors.push(details),
    },
  })

  await assert.doesNotReject(async () => runner())
  assert.equal(errors[0]?.errorCode, 'MIMO_NETWORK_ERROR')

  const source = readFileSync(
    new URL('../server/services/mimoWebSearchStartupDiagnostic.ts', import.meta.url),
    'utf8',
  )
  assert.doesNotMatch(source, /researchWithMimo|ResearchContext|taskRepository|database/i)
})

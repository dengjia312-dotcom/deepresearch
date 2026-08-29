import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MimoServiceError,
  researchWithMimo,
} from '../server/services/mimoResearchService'
import type { ResearchRequest } from '../server/types/research'

const request: ResearchRequest = {
  taskId: '11111111-1111-4111-8111-111111111111',
  requestId: '22222222-2222-4222-8222-222222222222',
  topic: 'C端产品经理基础',
  goal: '梳理核心能力模型与行业实践',
  sourcePreferences: ['权威报告', '行业研究'],
  targetSourceCount: 12,
}

const verifiedUrl = 'https://example.com/verified-source'
const unverifiedUrl = 'https://unverified.example/not-allowed'

function annotation(url = verifiedUrl) {
  return {
    type: 'url_citation',
    url,
    title: '已验证来源',
    summary: '联网搜索返回的来源摘要',
    site_name: '示例研究机构',
    publish_time: '2026-08-28',
  }
}

function searchPayload(annotations: unknown[]) {
  return {
    choices: [{
      finish_reason: 'stop',
      message: { content: 'search completed', annotations },
    }],
    usage: {
      web_search_usage: {
        tool_usage: annotations.length > 0 ? 1 : 0,
        page_usage: annotations.length,
      },
    },
  }
}

function synthesisPayload(sourceUrls = [verifiedUrl]) {
  return {
    choices: [{
      finish_reason: 'stop',
      message: {
        content: JSON.stringify({
          summary: '研究摘要',
          insights: [{
            title: '研究洞察',
            content: '洞察正文',
            sourceUrls,
          }],
          warnings: [],
        }),
      },
    }],
  }
}

interface MockResponse {
  status?: number
  payload: unknown
}

async function withMockedMimo<T>(
  responses: MockResponse[],
  callback: (requestBodies: Record<string, unknown>[]) => Promise<T>,
) {
  const originalFetch = globalThis.fetch
  const originalApiKey = process.env.AI_API_KEY
  const originalInfo = console.info
  const originalWarn = console.warn
  const originalError = console.error
  const requestBodies: Record<string, unknown>[] = []
  let responseIndex = 0

  process.env.AI_API_KEY = 'test-api-key'
  console.info = () => undefined
  console.warn = () => undefined
  console.error = () => undefined
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    requestBodies.push(body)
    const response = responses[responseIndex]
    responseIndex += 1
    if (!response) throw new Error('Unexpected MiMo request')
    return new Response(JSON.stringify(response.payload), {
      status: response.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    return await callback(requestBodies)
  } finally {
    globalThis.fetch = originalFetch
    console.info = originalInfo
    console.warn = originalWarn
    console.error = originalError
    if (originalApiKey === undefined) delete process.env.AI_API_KEY
    else process.env.AI_API_KEY = originalApiKey
  }
}

function isWebSearchRequest(body: Record<string, unknown>) {
  return Array.isArray(body.tools)
    && body.tools.some((tool) => (
      tool
      && typeof tool === 'object'
      && !Array.isArray(tool)
      && (tool as Record<string, unknown>).type === 'web_search'
    ))
}

test('Search 首次返回真实来源时不重试', async () => {
  await withMockedMimo([
    { payload: searchPayload([annotation()]) },
    { payload: synthesisPayload() },
  ], async (bodies) => {
    const result = await researchWithMimo(request)
    assert.equal(bodies.length, 2)
    assert.equal(bodies.filter(isWebSearchRequest).length, 1)
    assert.equal(result.sources.length, 1)
  })
})

test('Search 首次为空且第二次成功时只重试一次', async () => {
  await withMockedMimo([
    { payload: searchPayload([]) },
    { payload: searchPayload([annotation()]) },
    { payload: synthesisPayload() },
  ], async (bodies) => {
    const result = await researchWithMimo(request)
    assert.equal(bodies.length, 3)
    assert.equal(bodies.filter(isWebSearchRequest).length, 2)
    assert.equal(result.actualSourceCount, 1)
    assert.equal(result.sources.length, 1)
  })
})

test('Search 连续两次为空时抛出 NO_REAL_SOURCES 且不进入综合阶段', async () => {
  await withMockedMimo([
    { payload: searchPayload([]) },
    { payload: searchPayload([]) },
  ], async (bodies) => {
    await assert.rejects(
      researchWithMimo(request),
      (error: unknown) => error instanceof MimoServiceError
        && error.code === 'NO_REAL_SOURCES',
    )
    assert.equal(bodies.length, 2)
    assert.equal(bodies.every(isWebSearchRequest), true)
  })
})

test('Search 返回 HTTP 402 时不重试', async () => {
  await withMockedMimo([
    { status: 402, payload: { error: { code: 'insufficient_balance' } } },
  ], async (bodies) => {
    await assert.rejects(
      researchWithMimo(request),
      (error: unknown) => error instanceof MimoServiceError
        && error.code === 'MIMO_QUOTA_EXCEEDED',
    )
    assert.equal(bodies.length, 1)
  })
})

test('Search 返回 HTTP 429 时不重试', async () => {
  await withMockedMimo([
    { status: 429, payload: { error: { code: 'rate_limited' } } },
  ], async (bodies) => {
    await assert.rejects(
      researchWithMimo(request),
      (error: unknown) => error instanceof MimoServiceError
        && error.code === 'MIMO_RATE_LIMITED',
    )
    assert.equal(bodies.length, 1)
  })
})

test('Synthesis 请求不携带 web_search 工具', async () => {
  await withMockedMimo([
    { payload: searchPayload([annotation()]) },
    { payload: synthesisPayload() },
  ], async (bodies) => {
    await researchWithMimo(request)
    assert.equal(isWebSearchRequest(bodies[0] ?? {}), true)
    assert.equal(isWebSearchRequest(bodies[1] ?? {}), false)
    assert.equal(bodies[1]?.tools, undefined)
    assert.equal(bodies[1]?.tool_choice, undefined)
  })
})

test('Synthesis 输入只包含 Search 验证后的来源', async () => {
  await withMockedMimo([
    { payload: searchPayload([annotation()]) },
    { payload: synthesisPayload() },
  ], async (bodies) => {
    await researchWithMimo(request)
    const synthesisBody = JSON.stringify(bodies[1])
    assert.match(synthesisBody, /example\.com\/verified-source/)
    assert.doesNotMatch(synthesisBody, /unverified\.example/)
  })
})

test('Synthesis 生成不存在的 URL 时不能进入来源或引用关系', async () => {
  await withMockedMimo([
    { payload: searchPayload([annotation()]) },
    { payload: synthesisPayload([unverifiedUrl]) },
  ], async () => {
    const result = await researchWithMimo(request)
    assert.deepEqual(result.sources.map((source) => source.url), [verifiedUrl])
    assert.deepEqual(result.insights[0]?.sourceIds, [])
    assert.doesNotMatch(JSON.stringify(result.sources), /unverified\.example/)
    assert.ok(result.warnings.length > 0)
  })
})

test('Research 最终响应结构保持不变', async () => {
  await withMockedMimo([
    { payload: searchPayload([annotation()]) },
    { payload: synthesisPayload() },
  ], async () => {
    const result = await researchWithMimo(request)
    assert.deepEqual(Object.keys(result).sort(), [
      'actualSourceCount',
      'dataSource',
      'deduplicatedSourceCount',
      'insights',
      'mode',
      'requestId',
      'searchedAt',
      'sources',
      'summary',
      'targetSourceCount',
      'taskId',
      'topic',
      'validSourceCount',
      'warnings',
    ])
  })
})

test('Search 返回数据格式异常时不重试', async () => {
  await withMockedMimo([
    { payload: {} },
  ], async (bodies) => {
    await assert.rejects(
      researchWithMimo(request),
      (error: unknown) => error instanceof MimoServiceError
        && error.code === 'MIMO_RESPONSE_INVALID',
    )
    assert.equal(bodies.length, 1)
  })
})

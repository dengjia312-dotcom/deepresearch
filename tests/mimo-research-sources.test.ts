import assert from 'node:assert/strict'
import test from 'node:test'
import {
  extractVerifiedSearchMetadata,
  MimoServiceError,
  researchWithMimo,
} from '../server/services/mimoResearchService'
import type { ResearchRequest } from '../server/types/research'

const researchRequest: ResearchRequest = {
  taskId: 'task-source-test',
  requestId: 'request-source-test',
  topic: '测试研究主题',
  goal: '验证真实来源提取',
  sourcePreferences: [],
  targetSourceCount: 8,
}

function completionPayload(message: Record<string, unknown>) {
  return {
    id: 'completion-test',
    choices: [{ message }],
    model: 'mimo-v2.5',
    usage: {
      web_search_usage: {
        tool_usage: 1,
        page_usage: 1,
      },
    },
  }
}

function officialAnnotation(url = 'https://example.com/research') {
  return {
    type: 'url_citation',
    url,
    title: '官方来源标题',
    summary: '官方来源摘要',
    site_name: '示例研究机构',
    publish_time: '2026-08-27T08:00:00+08:00',
  }
}

async function withMockedMimoResponse(
  payload: unknown,
  callback: () => Promise<void>,
  captureRequest?: (body: Record<string, unknown>) => void,
) {
  const originalFetch = globalThis.fetch
  const originalApiKey = process.env.AI_API_KEY
  process.env.AI_API_KEY = 'test-api-key'
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as unknown
    if (captureRequest && body && typeof body === 'object' && !Array.isArray(body)) {
      captureRequest(body as Record<string, unknown>)
    }
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    await callback()
  } finally {
    globalThis.fetch = originalFetch
    if (originalApiKey === undefined) delete process.env.AI_API_KEY
    else process.env.AI_API_KEY = originalApiKey
  }
}

test('Research 实际请求显式启用 MiMo web_search tool choice', async () => {
  let requestBody: Record<string, unknown> | null = null
  const annotation = officialAnnotation()
  await withMockedMimoResponse(completionPayload({
    content: JSON.stringify({
      summary: '研究摘要',
      insights: [{
        title: '研究洞察',
        content: '洞察正文',
        sourceUrls: [annotation.url],
      }],
      warnings: [],
    }),
    annotations: [annotation],
  }), async () => {
    await researchWithMimo(researchRequest)
  }, (body) => {
    requestBody = body
  })

  assert.ok(requestBody)
  const tools = Array.isArray(requestBody.tools) ? requestBody.tools : []
  const webSearch = tools.find((tool) => (
    tool
    && typeof tool === 'object'
    && !Array.isArray(tool)
    && (tool as Record<string, unknown>).type === 'web_search'
  )) as Record<string, unknown> | undefined
  assert.ok(webSearch)
  assert.equal(webSearch.force_search, true)
  assert.equal(requestBody.tool_choice, 'auto')
})

test('官方 message.annotations url_citation 格式可提取来源', () => {
  const result = extractVerifiedSearchMetadata(completionPayload({
    content: '{}',
    annotations: [officialAnnotation()],
  }))

  assert.equal(result.actualSourceCount, 1)
  assert.equal(result.deduplicatedMetadata.length, 1)
  assert.equal(result.deduplicatedMetadata[0]?.url, 'https://example.com/research')
})

test('url_citation 官方字段正确映射为来源元数据', () => {
  const result = extractVerifiedSearchMetadata(completionPayload({
    content: '{}',
    annotations: [officialAnnotation()],
  }))

  assert.deepEqual(result.deduplicatedMetadata, [{
    url: 'https://example.com/research',
    title: '官方来源标题',
    snippet: '官方来源摘要',
    publisher: '示例研究机构',
    publishedAt: '2026-08-27T08:00:00+08:00',
  }])
})

test('重复 annotation URL 会在保留实际数量的同时正确去重', () => {
  const result = extractVerifiedSearchMetadata(completionPayload({
    content: '{}',
    annotations: [
      officialAnnotation('https://example.com/research#first'),
      officialAnnotation('https://example.com/research'),
    ],
  }))

  assert.equal(result.actualSourceCount, 2)
  assert.equal(result.deduplicatedMetadata.length, 1)
  assert.equal(result.deduplicatedMetadata[0]?.url, 'https://example.com/research')
})

test('annotations 无真实来源时仍抛出 NO_REAL_SOURCES', async () => {
  await withMockedMimoResponse(completionPayload({
    content: JSON.stringify({ summary: '摘要', insights: [], warnings: [] }),
    annotations: [],
  }), async () => {
    await assert.rejects(
      researchWithMimo(researchRequest),
      (error: unknown) => error instanceof MimoServiceError
        && error.code === 'NO_REAL_SOURCES'
        && error.statusCode === 502,
    )
  })
})

test('模型正文中的 URL 不能绕过 NO_REAL_SOURCES', async () => {
  await withMockedMimoResponse(completionPayload({
    content: JSON.stringify({
      summary: '模型生成的摘要',
      insights: [{
        title: '模型洞察',
        content: '模型正文',
        sourceUrls: ['https://model-generated.example/source'],
      }],
      warnings: [],
    }),
  }), async () => {
    await assert.rejects(
      researchWithMimo(researchRequest),
      (error: unknown) => error instanceof MimoServiceError
        && error.code === 'NO_REAL_SOURCES',
    )
  })
})

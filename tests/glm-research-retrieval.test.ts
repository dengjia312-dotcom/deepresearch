import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  enrichResearchSourcesWithGlm,
  glmResearchRetrievalTestApi,
  searchResearchSourcesWithGlm,
  type GlmReaderResult,
} from '../server/services/glmResearchRetrievalService'
import {
  buildMimoResearchSynthesisRequestBody,
  MimoServiceError,
  synthesizeResearchResponseWithMimo,
} from '../server/services/mimoResearchService'
import { researchWithProviders } from '../server/services/researchService'
import type {
  ResearchRequest,
  ResearchSynthesisEvidence,
  VerifiedSearchMetadata,
} from '../server/types/research'

const request: ResearchRequest = {
  taskId: '11111111-1111-4111-8111-111111111111',
  requestId: '22222222-2222-4222-8222-222222222222',
  topic: 'C端产品经理基础',
  goal: '梳理核心能力模型、用户研究方法和产品决策流程',
  sourcePreferences: ['权威报告', '行业研究'],
  targetSourceCount: 12,
}

function searchItem(index: number, overrides: Record<string, unknown> = {}) {
  return {
    title: `来源 ${index}`,
    link: `https://source-${index}.example.com/article`,
    content: `行业研究内容 ${index}`.repeat(30),
    media: `研究机构 ${index}`,
    publish_date: '2026-08-29',
    ...overrides,
  }
}

function searchPayload(count = 12) {
  return {
    search_result: Array.from({ length: count }, (_, index) => searchItem(index + 1)),
  }
}

function metadata(index: number, snippet = `搜索摘要 ${index}`.repeat(40)): VerifiedSearchMetadata {
  return {
    url: `https://source-${index}.example.com/article`,
    title: `来源 ${index}`,
    publisher: `研究机构 ${index}`,
    publishedAt: '2026-08-29',
    snippet,
  }
}

function readerResult(status: GlmReaderResult['status'], content: string): GlmReaderResult {
  return {
    status,
    content,
    contentLength: content.length,
    httpStatus: status === 'unavailable' ? 500 : 200,
  }
}

async function withMockedProviders<T>(
  fetchImpl: typeof fetch,
  callback: () => Promise<T>,
) {
  const originalFetch = globalThis.fetch
  const environment = {
    GLM_API_KEY: process.env.GLM_API_KEY,
    GLM_BASE_URL: process.env.GLM_BASE_URL,
    AI_API_KEY: process.env.AI_API_KEY,
    AI_BASE_URL: process.env.AI_BASE_URL,
  }
  const originalInfo = console.info
  const originalWarn = console.warn
  const originalError = console.error
  globalThis.fetch = fetchImpl
  process.env.GLM_API_KEY = 'test-glm-key'
  process.env.GLM_BASE_URL = 'https://glm.test/api/paas/v4'
  process.env.AI_API_KEY = 'test-mimo-key'
  process.env.AI_BASE_URL = 'https://mimo.test/v1'
  console.info = () => undefined
  console.warn = () => undefined
  console.error = () => undefined

  try {
    return await callback()
  } finally {
    globalThis.fetch = originalFetch
    console.info = originalInfo
    console.warn = originalWarn
    console.error = originalError
    Object.entries(environment).forEach(([name, value]) => {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    })
  }
}

test('GLM Search 12 个结果按官方字段映射为统一来源元数据', async () => {
  let requestBody: Record<string, unknown> | null = null
  await withMockedProviders(async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
    return new Response(JSON.stringify(searchPayload()), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }, async () => {
    const result = await searchResearchSourcesWithGlm(request)
    assert.equal(result.actualSourceCount, 12)
    assert.equal(result.deduplicatedSourceCount, 12)
    assert.equal(result.metadata.length, 12)
    assert.deepEqual(result.metadata[0], {
      url: 'https://source-1.example.com/article',
      title: '来源 1',
      publisher: '研究机构 1',
      publishedAt: '2026-08-29',
      snippet: '行业研究内容 1'.repeat(30),
    })
    assert.ok(requestBody)
    assert.equal(requestBody.search_engine, 'search_std')
    assert.equal(requestBody.content_size, 'high')
    assert.equal(requestBody.count, 12)
    assert.match(String(requestBody.search_query), /C端产品经理基础/)
  })
})

test('GLM Search 映射会过滤非 HTTP URL 和空标题内容', () => {
  const result = glmResearchRetrievalTestApi.mapGlmSearchResults({
    search_result: [
      searchItem(1),
      searchItem(2, { link: 'javascript:alert(1)' }),
      searchItem(3, { title: '' }),
      searchItem(4, { content: '' }),
    ],
  })
  assert.ok(result)
  assert.equal(result.actualSourceCount, 4)
  assert.equal(result.validSourceCount, 1)
  assert.equal(result.deduplicatedMetadata.length, 1)
})

test('GLM Search URL 去重会忽略 fragment', () => {
  const result = glmResearchRetrievalTestApi.mapGlmSearchResults({
    search_result: [
      searchItem(1, { link: 'https://example.com/article#first' }),
      searchItem(2, { link: 'https://example.com/article' }),
    ],
  })
  assert.ok(result)
  assert.equal(result.validSourceCount, 2)
  assert.equal(result.deduplicatedMetadata.length, 1)
})

test('Reader content >= 1000 判定为 full_text', () => {
  assert.equal(glmResearchRetrievalTestApi.classifyReaderContent(1000), 'full_text')
})

test('Reader content 300 到 999 判定为 partial 并合并 Search content', async () => {
  assert.equal(glmResearchRetrievalTestApi.classifyReaderContent(300), 'partial')
  assert.equal(glmResearchRetrievalTestApi.classifyReaderContent(999), 'partial')
  const result = await enrichResearchSourcesWithGlm([metadata(1, 'search evidence')], {
    readSource: async () => readerResult('partial', 'reader evidence'.repeat(30)),
  })
  assert.equal(result.evidenceSources[0]?.evidenceType, 'partial')
  assert.match(result.evidenceSources[0]?.content ?? '', /reader evidence/)
  assert.match(result.evidenceSources[0]?.content ?? '', /search evidence/)
})

test('Reader content < 300 判定为 insufficient 并回退 Search content', async () => {
  const source = metadata(1, 'search fallback')
  const result = await enrichResearchSourcesWithGlm([source], {
    readSource: async () => readerResult('insufficient', 'x'.repeat(299)),
  })
  assert.equal(result.readerStats.insufficientCount, 1)
  assert.equal(result.evidenceSources[0]?.evidenceType, 'search_summary')
  assert.equal(result.evidenceSources[0]?.content, 'search fallback')
})

test('Reader HTTP 失败不会终止 Research 并回退 Search content', async () => {
  const source = metadata(1, 'search fallback')
  const result = await enrichResearchSourcesWithGlm([source], {
    readSource: async () => readerResult('unavailable', ''),
  })
  assert.equal(result.readerStats.failedCount, 1)
  assert.equal(result.evidenceSources[0]?.evidenceType, 'search_summary')
  assert.equal(result.evidenceSources[0]?.content, 'search fallback')
  assert.equal(result.warnings.length, 1)
})

test('Reader 最多尝试前 8 条来源，其余保留 Search evidence', async () => {
  let readCount = 0
  const result = await enrichResearchSourcesWithGlm(
    Array.from({ length: 12 }, (_, index) => metadata(index + 1)),
    {
      readSource: async () => {
        readCount += 1
        return readerResult('full_text', 'x'.repeat(1000))
      },
    },
  )
  assert.equal(readCount, 8)
  assert.equal(result.readerStats.attemptedCount, 8)
  assert.equal(result.evidenceSources.length, 12)
  assert.equal(result.readerStats.searchSummaryCount, 4)
})

test('Reader 并发不会超过配置的 3', async () => {
  let active = 0
  let maxActive = 0
  await enrichResearchSourcesWithGlm(
    Array.from({ length: 8 }, (_, index) => metadata(index + 1)),
    {
      concurrency: 8,
      readSource: async () => {
        active += 1
        maxActive = Math.max(maxActive, active)
        await new Promise((resolve) => setTimeout(resolve, 5))
        active -= 1
        return readerResult('full_text', 'x'.repeat(1000))
      },
    },
  )
  assert.equal(maxActive, 3)
})

test('每条 Reader 正文送入 Synthesis 前最多保留 6000 字符', async () => {
  const result = await enrichResearchSourcesWithGlm([metadata(1)], {
    readSource: async () => readerResult('full_text', 'x'.repeat(7000)),
  })
  assert.equal(result.evidenceSources[0]?.content.length, 6000)
  assert.equal(
    result.evidenceSources[0]?.content.length,
    glmResearchRetrievalTestApi.maxEvidenceContentLength,
  )
})

test('MiMo Synthesis 请求完全不携带 web_search 或 tools', () => {
  const evidence: ResearchSynthesisEvidence = {
    ...metadata(1),
    sourceId: 'source-1',
    evidenceType: 'full_text',
    content: '正文证据',
  }
  const body = buildMimoResearchSynthesisRequestBody(request, [evidence])
  assert.equal(body.tools, undefined)
  assert.equal(body.tool_choice, undefined)
  assert.doesNotMatch(JSON.stringify(body), /web_search|force_search/)
})

test('Synthesis 返回来源池外 URL 时不会建立真实引用', async () => {
  const source = metadata(1)
  const evidence: ResearchSynthesisEvidence = {
    ...source,
    sourceId: 'source-1',
    evidenceType: 'search_summary',
    content: source.snippet,
  }
  await withMockedProviders(async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({
      summary: '研究摘要',
      insights: [{
        title: '洞察',
        content: '洞察正文',
        sourceUrls: ['https://outside.example.com/fabricated'],
      }],
      warnings: [],
    }) } }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } }), async () => {
    const result = await synthesizeResearchResponseWithMimo(
      request,
      [source],
      [evidence],
      { actualSourceCount: 1, deduplicatedSourceCount: 1 },
    )
    assert.deepEqual(result.insights[0]?.sourceIds, [])
    assert.deepEqual(result.sources.map((item) => item.url), [source.url])
    assert.doesNotMatch(JSON.stringify(result.sources), /outside\.example/)
  })
})

test('正式 Research 链路保持原响应 schema 且 Reader 正文不进入 sources', async () => {
  const mimoBodies: Record<string, unknown>[] = []
  let readerCount = 0
  await withMockedProviders(async (input, init) => {
    const url = String(input)
    if (url.endsWith('/web_search')) {
      return new Response(JSON.stringify(searchPayload()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (url.endsWith('/reader')) {
      readerCount += 1
      return new Response(JSON.stringify({
        reader_result: { content: 'reader-private-content'.repeat(100) },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    mimoBodies.push(body)
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        summary: '研究摘要',
        insights: [{
          title: '洞察',
          content: '洞察正文',
          sourceUrls: ['https://source-1.example.com/article'],
        }],
        warnings: [],
      }) } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }, async () => {
    const result = await researchWithProviders(request)
    assert.equal(readerCount, 8)
    assert.equal(mimoBodies.length, 1)
    assert.equal(mimoBodies[0]?.tools, undefined)
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
    assert.equal(result.sources.length, 12)
    assert.doesNotMatch(JSON.stringify(result.sources), /reader-private-content/)
    assert.ok(result.sources.every((item) => item.summary.length <= 600))
  })
})

test('GLM Search HTTP 失败不重试且不会自动切换 mock', async () => {
  let fetchCount = 0
  await withMockedProviders(async () => {
    fetchCount += 1
    return new Response(JSON.stringify({ error: { code: 'upstream_error' } }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }, async () => {
    await assert.rejects(
      searchResearchSourcesWithGlm(request),
      (error: unknown) => error instanceof MimoServiceError
        && error.code === 'RESEARCH_SEARCH_FAILED',
    )
    assert.equal(fetchCount, 1)
  })

  const serviceSource = readFileSync(
    new URL('../server/services/researchService.ts', import.meta.url),
    'utf8',
  )
  assert.doesNotMatch(serviceSource, /USE_MOCK|searchResearchSourcesWithMimo/)
})

test('GLM Search HTTP 200 但零有效来源时只重试一次', async () => {
  let fetchCount = 0
  await withMockedProviders(async () => {
    fetchCount += 1
    return new Response(JSON.stringify({ search_result: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }, async () => {
    await assert.rejects(
      searchResearchSourcesWithGlm(request),
      (error: unknown) => error instanceof MimoServiceError
        && error.code === 'NO_REAL_SOURCES',
    )
    assert.equal(fetchCount, 2)
  })
})

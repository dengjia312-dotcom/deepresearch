import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  enrichResearchSourcesWithGlm,
  glmResearchRetrievalTestApi,
  readResearchSourceWithGlm,
  searchResearchSourcesWithGlm,
  type GlmReaderResult,
} from '../server/services/glmResearchRetrievalService'
import {
  buildResearchSynthesisPrompt,
  synthesizeResearchResponse,
} from '../server/services/researchSynthesisService'
import { ResearchServiceError } from '../server/services/serviceError'
import { researchWithProviders } from '../server/services/researchService'
import type {
  ResearchRequest,
  ResearchStrategy,
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
    QWEN_API_KEY: process.env.QWEN_API_KEY,
    QWEN_BASE_URL: process.env.QWEN_BASE_URL,
    QWEN_FAST_MODEL: process.env.QWEN_FAST_MODEL,
    QWEN_STRONG_MODEL: process.env.QWEN_STRONG_MODEL,
    GLM_SEARCH_QUERY_CONCURRENCY: process.env.GLM_SEARCH_QUERY_CONCURRENCY,
  }
  const originalInfo = console.info
  const originalWarn = console.warn
  const originalError = console.error
  globalThis.fetch = fetchImpl
  process.env.GLM_API_KEY = 'test-glm-key'
  process.env.GLM_BASE_URL = 'https://glm.test/api/paas/v4'
  process.env.QWEN_API_KEY = 'test-qwen-key'
  process.env.QWEN_BASE_URL = 'https://qwen.test/v1'
  process.env.QWEN_FAST_MODEL = 'qwen-test-fast'
  process.env.QWEN_STRONG_MODEL = 'qwen-test-strong'
  process.env.GLM_SEARCH_QUERY_CONCURRENCY = '2'
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

test('GLM Multi-query 每条取 6 个结果并跨 Query URL 去重', async () => {
  const requestBodies: Record<string, unknown>[] = []
  await withMockedProviders(async (_input, init) => {
    requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
    return new Response(JSON.stringify(searchPayload()), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }, async () => {
    const result = await searchResearchSourcesWithGlm(request)
    assert.equal(result.actualSourceCount, 48)
    assert.equal(result.deduplicatedSourceCount, 6)
    assert.equal(result.metadata.length, 6)
    assert.equal(result.metadata[0]?.url, 'https://source-1.example.com/article')
    assert.equal(result.metadata[0]?.title, '来源 1')
    assert.equal(result.metadata[0]?.publisher, '研究机构 1')
    assert.equal(result.metadata[0]?.publishedAt, '2026-08-29')
    assert.equal(result.metadata[0]?.snippet, '行业研究内容 1'.repeat(30))
    assert.deepEqual(
      (result.metadata[0] as VerifiedSearchMetadata & { matchedQueryIds: string[] }).matchedQueryIds,
      ['query-1', 'query-2', 'query-3', 'query-4'],
    )
    assert.equal(requestBodies.length, 4)
    assert.ok(requestBodies.every((body) => body.search_engine === 'search_std'))
    assert.ok(requestBodies.every((body) => body.content_size === 'high'))
    assert.ok(requestBodies.every((body) => body.count === 6))
    assert.equal(new Set(requestBodies.map((body) => body.search_query)).size, 4)
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

test('Reader HTTP 403、429 和 5xx 使用安全失败分类', async () => {
  for (const [status, category] of [[403, 'HTTP_4XX'], [429, 'HTTP_4XX'], [503, 'HTTP_5XX']] as const) {
    await withMockedProviders(async () => new Response('{}', {
      status,
      headers: { 'Content-Type': 'application/json' },
    }), async () => {
      const result = await readResearchSourceWithGlm('https://reader.example.com/article')
      assert.equal(result.status, 'unavailable')
      assert.equal(result.httpStatus, status)
      assert.equal(result.failureCategory, category)
    })
  }
})

test('Reader timeout、network 和 invalid response 使用安全失败分类', async () => {
  const cases: Array<[() => Promise<Response>, string]> = [
    [async () => { throw new DOMException('aborted', 'AbortError') }, 'TIMEOUT'],
    [async () => { throw new TypeError('network unavailable') }, 'NETWORK'],
    [async () => new Response('{}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }), 'INVALID_RESPONSE'],
  ]
  for (const [fetchImpl, category] of cases) {
    await withMockedProviders(fetchImpl, async () => {
      const result = await readResearchSourceWithGlm('https://reader.example.com/article')
      assert.equal(result.status, 'unavailable')
      assert.equal(result.failureCategory, category)
    })
  }
})

test('Reader 空正文归类 EMPTY_CONTENT 且继续使用 Search Summary', async () => {
  await withMockedProviders(async () => new Response(JSON.stringify({
    reader_result: { content: '' },
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }), async () => {
    const reader = await readResearchSourceWithGlm('https://reader.example.com/article')
    assert.equal(reader.status, 'insufficient')
    assert.equal(reader.failureCategory, 'EMPTY_CONTENT')
    const result = await enrichResearchSourcesWithGlm([metadata(1)], {
      readSource: async () => reader,
    })
    assert.equal(result.readerStats.failureCategories.EMPTY_CONTENT, 1)
    assert.equal(result.evidenceSources[0]?.evidenceType, 'search_summary')
  })
})

test('Reader 失败聚合状态码并继续使用 Search Summary fallback', async () => {
  const sources = [metadata(1), metadata(2), metadata(3)]
  const failures: GlmReaderResult[] = [
    { status: 'unavailable', content: '', contentLength: 0, httpStatus: 403, failureCategory: 'HTTP_4XX' },
    { status: 'unavailable', content: '', contentLength: 0, httpStatus: 500, failureCategory: 'HTTP_5XX' },
    { status: 'unavailable', content: '', contentLength: 0, httpStatus: null, failureCategory: 'TIMEOUT' },
  ]
  let index = 0
  const result = await enrichResearchSourcesWithGlm(sources, {
    readSource: async () => failures[index++]!,
  })
  assert.equal(result.readerStats.failedCount, 3)
  assert.equal(result.readerStats.searchSummaryCount, 3)
  assert.equal(result.readerStats.failureCategories.HTTP_4XX, 1)
  assert.equal(result.readerStats.failureCategories.HTTP_5XX, 1)
  assert.equal(result.readerStats.failureCategories.TIMEOUT, 1)
  assert.deepEqual(result.readerStats.httpStatusCounts, { '403': 1, '500': 1 })
  assert.ok(result.evidenceSources.every((source) => source.evidenceType === 'search_summary'))
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

test('Reader 每完成一个真实读取就报告一次真实分类进度', async () => {
  const progress: GlmReaderResult['status'][] = []
  const statuses: GlmReaderResult['status'][] = ['full_text', 'partial', 'insufficient']
  let index = 0
  await enrichResearchSourcesWithGlm(
    Array.from({ length: 3 }, (_, sourceIndex) => metadata(sourceIndex + 1)),
    {
      concurrency: 1,
      readSource: async () => {
        const status = statuses[index++]!
        const length = status === 'full_text' ? 1000 : status === 'partial' ? 300 : 10
        return readerResult(status, 'x'.repeat(length))
      },
      onReaderCompleted: (status) => { progress.push(status) },
    },
  )
  assert.deepEqual(progress, statuses)
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

test('Qwen Synthesis prompt 接收规范主题上下文且不使用搜索工具', () => {
  const evidence: ResearchSynthesisEvidence = {
    ...metadata(1),
    sourceId: 'source-1',
    evidenceType: 'full_text',
    content: '正文证据',
  }
  const prompt = buildResearchSynthesisPrompt({
    ...request,
    researchStrategy: {
      intent: {
        normalizedTopic: 'C端产品经理能力体系',
        researchObject: '中国互联网C端产品经理岗位',
        userIntent: request.goal,
        scope: ['能力模型'],
        excludedMeanings: [],
        keyConcepts: ['C端产品经理'],
        ambiguityDetected: false,
      },
      queryPlan: { queries: [
        { id: 'query-1', query: 'C端产品经理 能力模型', purpose: '能力', priority: 1 },
        { id: 'query-2', query: 'C端产品经理 用户研究', purpose: '用户研究', priority: 2 },
      ] },
    },
  }, [evidence])
  assert.match(prompt, /正文证据/)
  assert.match(prompt, /中国互联网C端产品经理岗位/)
  assert.doesNotMatch(prompt, /web_search|force_search/)
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
    const result = await synthesizeResearchResponse(
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
  const generationBodies: Record<string, unknown>[] = []
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
    generationBodies.push(body)
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
    assert.equal(readerCount, 6)
    assert.equal(generationBodies.length, 1)
    assert.equal(generationBodies[0]?.tools, undefined)
    assert.equal(generationBodies[0]?.reasoning_effort, 'none')
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
    assert.equal(result.sources.length, 6)
    assert.doesNotMatch(JSON.stringify(result.sources), /reader-private-content/)
    assert.ok(result.sources.every((item) => item.summary.length <= 600))
  })
})

test('全部 GLM Query HTTP 失败才使 Research Search 失败且不切换 mock', async () => {
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
      (error: unknown) => error instanceof ResearchServiceError
        && error.code === 'RESEARCH_SEARCH_FAILED',
    )
    assert.equal(fetchCount, 4)
  })

  const serviceSource = readFileSync(
    new URL('../server/services/researchService.ts', import.meta.url),
    'utf8',
  )
  assert.doesNotMatch(serviceSource, /USE_MOCK|searchResearchSourcesWithMimo/)
})

test('GLM Multi-query 全部返回空结果时不无限补搜', async () => {
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
      (error: unknown) => error instanceof ResearchServiceError
        && error.code === 'NO_REAL_SOURCES',
    )
    assert.equal(fetchCount, 4)
  })
})

test('单个 Query 失败不阻断其他 Query 的聚合结果', async () => {
  let fetchCount = 0
  await withMockedProviders(async (_input, init) => {
    fetchCount += 1
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    if (String(body.search_query).includes('风险')) {
      return new Response('{}', {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response(JSON.stringify(searchPayload(4)), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }, async () => {
    const result = await searchResearchSourcesWithGlm(request)
    assert.equal(fetchCount, 4)
    assert.equal(result.metadata.length, 4)
    assert.equal(result.warnings.length, 1)
  })
})

test('Multi-query 聚合记录 query origin、过滤 low 并让 Flash 判定规则冲突来源', async () => {
  const strategy: ResearchStrategy = {
    intent: {
      normalizedTopic: '环境设计专业与空间设计行业未来发展',
      researchObject: '环境设计专业及空间设计行业',
      userIntent: '分析就业、趋势和AI影响',
      scope: ['环境设计专业', '室内设计', '景观设计'],
      excludedMeanings: ['生态环境', '环境科学', '环境治理', '污染治理'],
      keyConcepts: ['环境设计专业', '室内设计', '景观设计', '空间设计', 'AI'],
      ambiguityDetected: true,
    },
    queryPlan: { queries: [
      { id: 'query-1', query: '环境设计专业 就业趋势', purpose: '就业', priority: 1 },
      { id: 'query-2', query: '室内设计 景观设计 趋势', purpose: '行业', priority: 2 },
      { id: 'query-3', query: 'AI 环境设计行业', purpose: '技术', priority: 3 },
      { id: 'query-4', query: '环境设计 招聘 能力', purpose: '能力', priority: 4 },
    ] },
  }
  let qwenCallCount = 0
  await withMockedProviders(async (input) => {
    if (String(input).endsWith('/chat/completions')) {
      qwenCallCount += 1
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          classifications: [{
            sourceId: 'candidate-3',
            relevance: 'medium',
            reason: '同时涉及专业语义，需要保留',
          }],
        }) } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(JSON.stringify({
      search_result: [
        searchItem(1, {
          title: '环境设计专业与室内设计就业趋势',
          content: '环境设计专业、室内设计和景观设计行业岗位变化分析。',
        }),
        searchItem(2, {
          title: '生态环境治理与污染防治',
          content: '生态环境、环境科学和污染治理政策。',
        }),
        searchItem(3, {
          title: '生态环境背景下的环境设计专业改革',
          content: '讨论环境设计专业课程与空间设计能力。',
        }),
      ],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }, async () => {
    const result = await searchResearchSourcesWithGlm(
      { ...request, topic: '环境设计的未来', researchStrategy: strategy },
      strategy,
    )
    assert.equal(qwenCallCount, 1)
    assert.equal(result.deduplicatedSourceCount, 3)
    assert.equal(result.metadata.length, 2)
    assert.ok(result.metadata.every((source) => !/污染防治/.test(source.title)))
    const withOrigins = result.metadata as Array<VerifiedSearchMetadata & { matchedQueryIds: string[] }>
    assert.ok(withOrigins.every((source) => source.matchedQueryIds.length === 4))
  })
})

test('GLM Query 并发默认不超过 2', async () => {
  let active = 0
  let maxActive = 0
  await withMockedProviders(async () => {
    active += 1
    maxActive = Math.max(maxActive, active)
    await new Promise((resolve) => setTimeout(resolve, 10))
    active -= 1
    return new Response(JSON.stringify(searchPayload(2)), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }, async () => {
    await searchResearchSourcesWithGlm(request)
    assert.equal(maxActive, 2)
  })
})

test('规则判定只让 high/medium 候选进入后续 Reader', async () => {
  const relevant = metadata(1)
  const irrelevant = metadata(2)
  assert.ok(
    ['high', 'medium'].includes(glmResearchRetrievalTestApi.relevanceByRule(relevant, {
      normalizedTopic: '来源 1',
      researchObject: '来源 1',
      userIntent: '测试',
      scope: ['来源 1'],
      excludedMeanings: ['来源 2'],
      keyConcepts: ['来源 1', '行业研究内容 1'],
      ambiguityDetected: true,
    })),
  )
  assert.equal(
    glmResearchRetrievalTestApi.relevanceByRule(irrelevant, {
      normalizedTopic: '来源 1',
      researchObject: '来源 1',
      userIntent: '测试',
      scope: ['来源 1'],
      excludedMeanings: ['来源 2'],
      keyConcepts: ['来源 1'],
      ambiguityDetected: true,
    }),
    'low',
  )
})

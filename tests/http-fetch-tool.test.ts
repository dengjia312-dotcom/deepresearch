import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import test from 'node:test'
import {
  createHttpFetchEvidenceCandidate,
  fetchStaticResearchSources,
  HTTP_FETCH_LIMITS,
  httpFetchTestApi,
  mergeResearchEvidenceCandidates,
  type HttpFetchTransport,
  type HttpFetchTransportResponse,
  type ResearchEvidenceUpgradeCandidate,
} from '../server/services/httpFetchService'
import {
  addressesMatch,
  assertAllResolvedAddressesPublic,
  HttpFetchItemError,
  isPublicHttpAddress,
  validateHttpFetchUrl,
} from '../server/services/httpFetchSecurityService'
import { createHttpFetchToolAdapter } from '../server/services/researchToolAdapters'
import { ResearchToolExecutor } from '../server/services/researchToolExecutor'
import {
  ResearchToolRegistry,
  researchToolRegistryTestApi,
} from '../server/services/researchToolRegistry'
import type { ResearchRequest, ResearchStrategy } from '../server/types/research'
import {
  ResearchToolRuntimeError,
  type HttpFetchItemResult,
  type HttpFetchToolCall,
  type ResearchSearchSource,
  type ResearchToolDefinition,
} from '../server/types/researchTool'

const PUBLIC_IP = '93.184.216.34'
const SECOND_PUBLIC_IP = '8.8.8.8'

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
  taskId: 'task-http-fetch',
  requestId: 'request-http-fetch',
  topic: '测试主题',
  goal: '分析测试主题',
  sourcePreferences: [],
  targetSourceCount: 8,
  researchStrategy: strategy,
}

function source(
  url = 'https://public.example/article',
  candidateId = 'candidate-1',
): ResearchSearchSource {
  return {
    candidateId,
    url,
    title: '搜索来源标题',
    publisher: '测试机构',
    publishedAt: '2026-09-01',
    snippet: '由服务端搜索返回的来源摘要。',
    matchedQueryIds: ['query-1'],
    sourceCategory: 'professional',
    relevance: 'high',
  }
}

function call(sources: ResearchSearchSource[] = [source()]): HttpFetchToolCall {
  return {
    executionId: randomUUID(),
    tool: 'http_fetch',
    round: 1,
    evidenceNeedIds: [],
    sources,
  }
}

function paragraph(seed: string, size = 420) {
  return `${seed} ${'这是用于验证静态正文抽取质量的有效研究内容。'.repeat(size / 20)}`
}

function articleHtml(title = '页面标题') {
  return `<!doctype html><html><head><title>${title}</title></head><body>
    <nav>${'导航噪音'.repeat(100)}</nav>
    <main><p>${paragraph('主区域备选')}</p></main>
    <article>
      <p>${paragraph('第一段')}</p>
      <p>${paragraph('第二段')}</p>
      <p>${paragraph('第三段')}</p>
      <script>window.secret = '不得保留'</script>
      <footer>${'页脚噪音'.repeat(100)}</footer>
    </article>
  </body></html>`
}

function response(options: {
  statusCode?: number
  headers?: Record<string, string | string[] | undefined>
  chunks?: Array<Buffer | string>
  remoteAddress?: string | null
  onDestroy?: () => void
} = {}): HttpFetchTransportResponse {
  return {
    statusCode: options.statusCode ?? 200,
    headers: options.headers ?? { 'content-type': 'text/html; charset=utf-8' },
    body: Readable.from(options.chunks ?? [Buffer.from(articleHtml())]),
    remoteAddress: options.remoteAddress === undefined ? PUBLIC_IP : options.remoteAddress,
    destroy: () => options.onDestroy?.(),
  }
}

function transportFrom(
  handler: (url: URL, index: number) => HttpFetchTransportResponse | Promise<HttpFetchTransportResponse>,
) {
  let index = 0
  const calls: Parameters<HttpFetchTransport>[0][] = []
  const transport: HttpFetchTransport = async (input) => {
    calls.push(input)
    return handler(input.url, index++)
  }
  return { transport, calls }
}

const publicDns = async () => [{ address: PUBLIC_IP, family: 4 as const }]

async function fetchOne(
  transport: HttpFetchTransport,
  input = source(),
  resolveDns = publicDns,
) {
  return fetchStaticResearchSources(call([input]), { transport, resolveDns })
}

test('URL safety 拒绝 localhost、受限地址、metadata、用户信息、非默认端口和非 HTTP', () => {
  const blocked = [
    'http://localhost/',
    'http://api.localhost/',
    'http://127.0.0.1/',
    'http://10.0.0.1/',
    'http://169.254.169.254/latest/meta-data',
    'http://100.64.0.1/',
    'http://224.0.0.1/',
    'http://192.0.2.1/',
    'http://168.63.129.16/',
    'http://[::1]/',
    'http://[fc00::1]/',
    'http://[fe80::1]/',
    'http://[ff02::1]/',
    'http://[2001:db8::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[0:0:0:0:0:ffff:7f00:1]/',
    'http://metadata.google.internal/',
    'http://user:password@public.example/',
    'https://public.example:8443/',
    'ftp://public.example/file',
  ]
  blocked.forEach((url) => assert.throws(() => validateHttpFetchUrl(url), HttpFetchItemError))
  assert.equal(validateHttpFetchUrl('https://public.example/path#fragment').url.hash, '')
})

test('IP policy fail closed：任一 DNS answer 受限即拒绝，IPv4-mapped 地址正确分类', () => {
  assert.equal(isPublicHttpAddress(PUBLIC_IP), true)
  assert.equal(isPublicHttpAddress('::ffff:8.8.8.8'), true)
  assert.equal(isPublicHttpAddress('::ffff:808:808'), true)
  assert.equal(isPublicHttpAddress('0:0:0:0:0:ffff:808:808'), true)
  assert.equal(isPublicHttpAddress('::ffff:127.0.0.1'), false)
  assert.equal(isPublicHttpAddress('::ffff:7f00:1'), false)
  assert.equal(isPublicHttpAddress('0:0:0:0:0:ffff:7f00:1'), false)
  assert.equal(isPublicHttpAddress('::ffff:10.0.0.1'), false)
  assert.equal(isPublicHttpAddress('0:0:0:0:0:ffff:a00:1'), false)
  assert.equal(isPublicHttpAddress('4000::1'), false)
  assert.equal(isPublicHttpAddress('5f00::1'), false)
  assert.equal(isPublicHttpAddress('64:ff9b::7f00:1'), false)
  assert.equal(isPublicHttpAddress('64:ff9b:1::7f00:1'), false)
  assert.equal(isPublicHttpAddress('100::1'), false)
  assert.equal(isPublicHttpAddress('2001::1'), false)
  assert.equal(isPublicHttpAddress('2001:2::1'), false)
  assert.equal(isPublicHttpAddress('2001:10::1'), false)
  assert.equal(isPublicHttpAddress('2001:20::1'), false)
  assert.equal(isPublicHttpAddress('2002::1'), false)
  assert.equal(isPublicHttpAddress('2001:db8::1'), false)
  assert.equal(isPublicHttpAddress('3fff::1'), false)
  assert.equal(isPublicHttpAddress('2001:4860:4860::8888'), true)
  assert.equal(addressesMatch('8.8.8.8', '::ffff:8.8.8.8'), true)
  assert.equal(addressesMatch('::ffff:127.0.0.1', '0:0:0:0:0:ffff:7f00:1'), true)
  assert.equal(
    addressesMatch('2001:4860:4860::8888', '2001:4860:4860:0:0:0:0:8888'),
    true,
  )
  assert.throws(
    () => assertAllResolvedAddressesPublic([
      { address: PUBLIC_IP, family: 4 },
      { address: '10.0.0.1', family: 4 },
    ]),
    (error) => error instanceof HttpFetchItemError && error.code === 'PRIVATE_ADDRESS_BLOCKED',
  )
})

test('DNS failure 与 mixed public/private DNS 形成单项失败，不抛成 Research fatal', async () => {
  const unused: HttpFetchTransport = async () => response()
  const failed = await fetchOne(unused, source(), async () => { throw new Error('dns down') })
  assert.equal(failed.items[0]?.failureCode, 'DNS_RESOLUTION_FAILED')
  const mixed = await fetchOne(unused, source(), async () => [
    { address: PUBLIC_IP, family: 4 },
    { address: '127.0.0.1', family: 4 },
  ])
  assert.equal(mixed.items[0]?.failureCode, 'PRIVATE_ADDRESS_BLOCKED')
  assert.equal(mixed.status, 'partial')
  const expandedMapped = await fetchOne(unused, source(), async () => [
    { address: '0:0:0:0:0:ffff:7f00:1', family: 6 },
  ])
  assert.equal(expandedMapped.items[0]?.failureCode, 'PRIVATE_ADDRESS_BLOCKED')
})

test('transport 获得已验证的 pinned IP，headers 不携带 Cookie/Auth/Referer', async () => {
  const fixture = transportFrom((_url) => response())
  const result = await fetchOne(fixture.transport)
  assert.equal(result.successfulCount, 1)
  assert.equal(fixture.calls[0]?.pinnedAddress.address, PUBLIC_IP)
  assert.equal(fixture.calls[0]?.headers['Accept-Encoding'], 'identity')
  assert.equal(fixture.calls[0]?.headers.Cookie, undefined)
  assert.equal(fixture.calls[0]?.headers.Authorization, undefined)
  assert.equal(fixture.calls[0]?.headers.Referer, undefined)
  assert.equal(fixture.calls[0]?.maxHeaderBytes, HTTP_FETCH_LIMITS.maxHeaderBytes)
})

test('native custom lookup 只返回已验证的 pinned IP', async () => {
  const lookup = httpFetchTestApi.createPinnedLookup({ address: PUBLIC_IP, family: 4 })
  const single = await new Promise<{ address: string; family: number }>((resolve, reject) => {
    lookup('public.example', {}, (error, address, family) => {
      if (error) reject(error)
      else resolve({ address: String(address), family: Number(family) })
    })
  })
  assert.deepEqual(single, { address: PUBLIC_IP, family: 4 })
})

test('remoteAddress 必须与 pinned public IP 一致', async () => {
  const mismatch = await fetchOne(async () => response({ remoteAddress: SECOND_PUBLIC_IP }))
  assert.equal(mismatch.items[0]?.failureCode, 'PRIVATE_ADDRESS_BLOCKED')
  const privateRemote = await fetchOne(async () => response({ remoteAddress: '127.0.0.1' }))
  assert.equal(privateRemote.items[0]?.failureCode, 'PRIVATE_ADDRESS_BLOCKED')
  const expandedMapped = await fetchOne(async () => response({
    remoteAddress: '0:0:0:0:0:ffff:7f00:1',
  }))
  assert.equal(expandedMapped.items[0]?.failureCode, 'PRIVATE_ADDRESS_BLOCKED')
})

test('redirect 每跳重验：安全 redirect 成功，private redirect 被拒绝', async () => {
  const safe = transportFrom((url) => {
    if (url.pathname === '/article') {
      return response({ statusCode: 302, headers: { location: '/final' }, chunks: [] })
    }
    return response()
  })
  const safeResult = await fetchOne(safe.transport)
  assert.equal(safeResult.items[0]?.status, 'full_text')
  assert.equal(safeResult.items[0]?.fetchMetadata.redirectCount, 1)
  assert.match(safeResult.items[0]?.finalUrl ?? '', /\/final$/)

  const blocked = await fetchOne(async () => response({
    statusCode: 302,
    headers: { location: 'http://127.0.0.1/internal' },
    chunks: [],
  }))
  assert.equal(blocked.items[0]?.failureCode, 'REDIRECT_BLOCKED')
})

test('redirect loop 与超过三跳均被拒绝', async () => {
  const loop = transportFrom((url) => response({
    statusCode: 302,
    headers: { location: url.pathname === '/article' ? '/again' : '/article' },
    chunks: [],
  }))
  const loopResult = await fetchOne(loop.transport)
  assert.equal(loopResult.items[0]?.failureCode, 'REDIRECT_LOOP')

  const redirects = transportFrom((_url, index) => response({
    statusCode: 302,
    headers: { location: `/redirect-${index + 1}` },
    chunks: [],
  }))
  const redirectsResult = await fetchOne(redirects.transport)
  assert.equal(redirectsResult.items[0]?.failureCode, 'TOO_MANY_REDIRECTS')
  assert.equal(redirects.calls.length, 4)
})

test('response boundary 拒绝 oversized Content-Length 和 streaming body', async () => {
  let contentLengthDestroyed = false
  const declared = await fetchOne(async () => response({
    headers: {
      'content-type': 'text/html',
      'content-length': String(HTTP_FETCH_LIMITS.maxBodyBytes + 1),
    },
    onDestroy: () => { contentLengthDestroyed = true },
  }))
  assert.equal(declared.items[0]?.failureCode, 'RESPONSE_TOO_LARGE')
  assert.equal(contentLengthDestroyed, true)

  let streamDestroyed = false
  const streamed = await fetchOne(async () => response({
    chunks: [
      Buffer.alloc(HTTP_FETCH_LIMITS.maxBodyBytes),
      Buffer.from('x'),
    ],
    onDestroy: () => { streamDestroyed = true },
  }))
  assert.equal(streamed.items[0]?.failureCode, 'RESPONSE_TOO_LARGE')
  assert.equal(streamDestroyed, true)
})

test('response boundary 拒绝 unsupported/missing Content-Type 与 Content-Encoding', async () => {
  const binary = await fetchOne(async () => response({
    headers: { 'content-type': 'application/pdf' },
  }))
  assert.equal(binary.items[0]?.failureCode, 'UNSUPPORTED_CONTENT_TYPE')
  const missing = await fetchOne(async () => response({ headers: {} }))
  assert.equal(missing.items[0]?.failureCode, 'UNSUPPORTED_CONTENT_TYPE')
  const compressed = await fetchOne(async () => response({
    headers: { 'content-type': 'text/html', 'content-encoding': 'gzip' },
  }))
  assert.equal(compressed.items[0]?.failureCode, 'UNSUPPORTED_CONTENT_ENCODING')
})

test('HTTP error、timeout、network error 保持内部单项 failure code', async () => {
  const httpError = await fetchOne(async () => response({ statusCode: 503 }))
  assert.equal(httpError.items[0]?.failureCode, 'HTTP_ERROR')
  assert.equal(httpError.items[0]?.fetchMetadata.httpStatus, 503)
  const timeout = await fetchOne(async () => { throw new DOMException('aborted', 'AbortError') })
  assert.equal(timeout.items[0]?.failureCode, 'TIMEOUT')
  const network = await fetchOne(async () => { throw new Error('socket reset') })
  assert.equal(network.items[0]?.failureCode, 'NETWORK_ERROR')
  await assert.rejects(
    httpFetchTestApi.withTimeout(new Promise<never>(() => {}), 1),
    (error) => error instanceof HttpFetchItemError && error.code === 'TIMEOUT',
  )
})

test('static HTML 提取 title/article 并移除 boilerplate、脚本和 raw HTML', async () => {
  const result = await fetchOne(async () => response())
  const item = result.items[0]!
  assert.equal(item.status, 'full_text')
  assert.equal(item.title, '页面标题')
  assert.match(item.content, /第一段/)
  assert.doesNotMatch(item.content, /主区域备选|导航噪音|页脚噪音|window\.secret|<article>/)
  assert.ok((item.extraction?.paragraphCount ?? 0) >= 3)
  assert.ok(item.content.length <= HTTP_FETCH_LIMITS.maxEvidenceCharacters)
})

test('正文选择按 article → main → body，malformed HTML 仍可提取', async () => {
  const mainHtml = `<html><body><div>${paragraph('body')}</div><main>
    <p>${paragraph('main-1')}</p><p>${paragraph('main-2')}</p><p>${paragraph('main-3')}</p>
  </main></body></html>`
  const mainResult = await fetchOne(async () => response({ chunks: [mainHtml] }))
  assert.equal(mainResult.items[0]?.status, 'full_text')
  assert.match(mainResult.items[0]?.content ?? '', /main-1/)
  assert.doesNotMatch(mainResult.items[0]?.content ?? '', /body/)

  const malformed = `<html><body><article><h1>回退标题</h1><p>${paragraph('一')}<p>${paragraph('二')}<p>${paragraph('三')}`
  const malformedResult = await fetchOne(async () => response({ chunks: [malformed] }))
  assert.equal(malformedResult.items[0]?.status, 'full_text')
  assert.equal(malformedResult.items[0]?.title, '回退标题')
})

test('og:title fallback、text/plain 与无 Content-Length streaming 正常工作', async () => {
  const ogHtml = `<html><head><meta property="og:title" content="OG 标题"></head><body><article>
    <p>${paragraph('一')}</p><p>${paragraph('二')}</p><p>${paragraph('三')}</p>
  </article></body></html>`
  const og = await fetchOne(async () => response({ chunks: [ogHtml] }))
  assert.equal(og.items[0]?.title, 'OG 标题')

  const plain = [paragraph('文本一'), paragraph('文本二'), paragraph('文本三')].join('\n\n')
  const plainResult = await fetchOne(async () => response({
    headers: { 'content-type': 'text/plain; charset=utf-8' },
    chunks: [plain.slice(0, 300), plain.slice(300)],
  }))
  assert.equal(plainResult.items[0]?.status, 'full_text')
  assert.equal(plainResult.items[0]?.contentType, 'text/plain')
})

test('空页面或有效正文不足 300 字符不产生 Evidence', async () => {
  const empty = await fetchOne(async () => response({ chunks: ['<html><body>短内容</body></html>'] }))
  assert.equal(empty.items[0]?.status, 'failed')
  assert.equal(empty.items[0]?.failureCode, 'EMPTY_CONTENT')
})

test('charset 按 BOM → header → meta → UTF-8 解码并拒绝未知 charset', () => {
  const utf8 = Buffer.from('中文 UTF-8')
  assert.equal(httpFetchTestApi.decodeBody(utf8, 'text/plain'), '中文 UTF-8')
  assert.equal(
    httpFetchTestApi.decodeBody(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), utf8]), 'text/plain; charset=unknown'),
    '中文 UTF-8',
  )
  const gbText = Buffer.from([0xd6, 0xd0, 0xce, 0xc4])
  assert.equal(httpFetchTestApi.decodeBody(gbText, 'text/plain; charset=gbk'), '中文')
  assert.equal(httpFetchTestApi.decodeBody(gbText, 'text/plain; charset=gb2312'), '中文')
  assert.equal(httpFetchTestApi.decodeBody(gbText, 'text/plain; charset=gb18030'), '中文')
  const meta = Buffer.concat([
    Buffer.from('<meta charset="gb18030"><p>'),
    gbText,
    Buffer.from('</p>'),
  ])
  assert.match(httpFetchTestApi.decodeBody(meta, 'text/html'), /中文/)
  assert.throws(
    () => httpFetchTestApi.decodeBody(utf8, 'text/plain; charset=x-unknown'),
    (error) => error instanceof HttpFetchItemError && error.code === 'UNSUPPORTED_CHARSET',
  )
})

test('batch 最多并发 3，结果保持来源顺序', async () => {
  let active = 0
  let peak = 0
  const sources = Array.from({ length: 8 }, (_, index) => (
    source(`https://public-${index}.example/article`, `candidate-${index}`)
  ))
  const result = await fetchStaticResearchSources(call(sources), {
    resolveDns: publicDns,
    transport: async () => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
      return response()
    },
  })
  assert.equal(peak, HTTP_FETCH_LIMITS.concurrency)
  assert.deepEqual(result.items.map((item) => item.candidateId), sources.map((item) => item.candidateId))
})

test('Tool Registry argument/provenance 校验阻止裸 URL 和未授权 Source', async () => {
  assert.equal(researchToolRegistryTestApi.validateHttpFetchCall(call()), true)
  assert.equal(researchToolRegistryTestApi.validateHttpFetchCall({
    ...call(), sources: undefined, url: source().url,
  }), false)
  assert.equal(researchToolRegistryTestApi.validateHttpFetchCall(call(
    Array.from(
      { length: 9 },
      (_, index) => source(`https://source-${index}.example/`, `candidate-${index}`),
    ),
  )), false)
  const adapter = createHttpFetchToolAdapter({
    resolveDns: publicDns,
    transport: async () => response(),
  })
  const definition: ResearchToolDefinition = {
    name: 'http_fetch',
    description: 'test',
    capabilities: ['fetch_static_content'],
    supportedSourceTypes: ['general_web', 'professional'],
    costLevel: 'low',
    latencyLevel: 'low',
    maxCallsPerRun: 2,
    enabled: true,
    validateArguments: (value) => (
      typeof value === 'object' && value !== null && Array.isArray(Reflect.get(value, 'sources'))
    ),
    adapter,
  }
  const executor = new ResearchToolExecutor(new ResearchToolRegistry([definition]))
  await assert.rejects(
    executor.execute({ ...call(), sources: undefined, url: source().url }, { request, strategy }),
    (error) => error instanceof ResearchToolRuntimeError
      && error.code === 'RESEARCH_TOOL_ARGUMENTS_INVALID',
  )
  await assert.rejects(
    executor.execute(call(), { request, strategy, authorizedSearchSources: [] }),
    (error) => error instanceof ResearchToolRuntimeError
      && error.code === 'RESEARCH_TOOL_PROVENANCE_INVALID',
  )
  const authorized = source()
  const mismatchExecutor = new ResearchToolExecutor(new ResearchToolRegistry([definition]))
  await assert.rejects(
    mismatchExecutor.execute(call([{ ...authorized, url: 'https://replaced.example/article' }]), {
      request,
      strategy,
      authorizedSearchSources: [authorized],
    }),
    (error) => error instanceof ResearchToolRuntimeError
      && error.code === 'RESEARCH_TOOL_PROVENANCE_INVALID',
  )
  const result = await executor.execute(call([authorized]), {
    request,
    strategy,
    authorizedSearchSources: [authorized],
  })
  assert.equal(result.tool, 'http_fetch')
})

test('http_fetch progress start/cleanup、budget 与 stale 行为由 Executor 统一保证', async () => {
  let calls = 0
  let stale = false
  const progress: Array<string | null> = []
  const definition: ResearchToolDefinition = {
    name: 'http_fetch',
    description: 'test',
    capabilities: ['fetch_static_content'],
    supportedSourceTypes: ['general_web'],
    costLevel: 'low',
    latencyLevel: 'low',
    maxCallsPerRun: 2,
    enabled: true,
    validateArguments: () => true,
    adapter: async (value) => {
      calls += 1
      stale = true
      return {
        executionId: value.executionId,
        tool: 'http_fetch',
        status: 'success',
        items: [],
        successfulCount: 0,
        failedCount: 0,
        warnings: [],
      }
    },
  }
  const executor = new ResearchToolExecutor(new ResearchToolRegistry([definition]), undefined, {
    onProgress: (value) => { progress.push(value.currentTool) },
  })
  await assert.rejects(
    executor.execute(call(), {
      request,
      strategy,
      assertCurrent: () => { if (stale) throw new Error('stale') },
    }),
    /stale/,
  )
  assert.equal(calls, 1)
  assert.deepEqual(progress, ['http_fetch', null])
  assert.equal(executor.getSnapshot().currentTool, null)
  assert.equal(executor.getSnapshot().toolCallCounts.http_fetch, 1)
})

test('http_fetch 每个 Executor 最多调用两次，provider throw 也消耗预算并清理进度', async () => {
  const makeDefinition = (adapter: ResearchToolDefinition['adapter']): ResearchToolDefinition => ({
    name: 'http_fetch',
    description: 'test',
    capabilities: ['fetch_static_content'],
    supportedSourceTypes: ['general_web'],
    costLevel: 'low',
    latencyLevel: 'low',
    maxCallsPerRun: 2,
    enabled: true,
    validateArguments: () => true,
    adapter,
  })
  let calls = 0
  const successExecutor = new ResearchToolExecutor(new ResearchToolRegistry([
    makeDefinition(async (value) => {
      calls += 1
      return {
        executionId: value.executionId,
        tool: 'http_fetch',
        status: 'success',
        items: [],
        successfulCount: 0,
        failedCount: 0,
        warnings: [],
      }
    }),
  ]))
  await successExecutor.execute(call(), { request, strategy })
  await successExecutor.execute(call(), { request, strategy })
  await assert.rejects(
    successExecutor.execute(call(), { request, strategy }),
    (error) => error instanceof ResearchToolRuntimeError
      && error.code === 'RESEARCH_TOOL_BUDGET_EXCEEDED',
  )
  assert.equal(calls, 2)
  assert.equal(successExecutor.getSnapshot().currentTool, null)

  const providerError = new Error('provider failed')
  const failedExecutor = new ResearchToolExecutor(new ResearchToolRegistry([
    makeDefinition(async () => { throw providerError }),
  ]))
  await assert.rejects(
    failedExecutor.execute(call(), { request, strategy }),
    (error) => error === providerError,
  )
  assert.equal(failedExecutor.getSnapshot().toolCallCounts.http_fetch, 1)
  assert.equal(failedExecutor.getSnapshot().currentTool, null)
})

function item(
  status: 'full_text' | 'partial',
  confidence: number,
  contentLength: number,
): HttpFetchItemResult {
  return {
    candidateId: 'candidate-1',
    status,
    finalUrl: 'https://public.example/article',
    title: 'HTTP 标题',
    content: 'HTTP evidence '.repeat(Math.ceil(contentLength / 14)).slice(0, contentLength),
    contentLength,
    contentType: 'text/html',
    extraction: { paragraphCount: 5, linkDensity: 0.05, confidence },
    fetchMetadata: { redirectCount: 0, durationMs: 5, httpStatus: 200 },
  }
}

function readerCandidate(): ResearchEvidenceUpgradeCandidate {
  return {
    evidence: {
      evidenceId: 'evidence-1',
      normalizedUrl: 'https://public.example/article',
      metadata: {
        url: 'https://public.example/article',
        title: 'Reader 标题',
        publisher: '测试机构',
        publishedAt: '2026-09-01',
        snippet: '摘要',
      },
      evidenceType: 'full_text',
      content: 'Reader stronger content',
      sourceType: 'professional',
      bindings: [{ queryId: 'query-1', agentRound: 1, acquisitionTool: 'read_webpage' }],
    },
    quality: { confidence: 0.98, effectiveLength: 2_000, paragraphCount: 8, linkDensity: 0.01 },
  }
}

test('HTTP Evidence 升级 search_summary，按质量合并并保留 multiple Tool bindings', () => {
  const searchSummary: ResearchEvidenceUpgradeCandidate = {
    evidence: {
      evidenceId: 'evidence-1',
      normalizedUrl: 'https://public.example/article',
      metadata: {
        url: 'https://public.example/article', title: '搜索标题', publisher: '测试机构',
        publishedAt: '2026-09-01', snippet: '摘要',
      },
      evidenceType: 'search_summary',
      content: '搜索摘要',
      sourceType: 'professional',
      bindings: [{ queryId: 'query-1', agentRound: 1, acquisitionTool: 'web_search' }],
    },
    quality: { confidence: 0.4, effectiveLength: 100, paragraphCount: 1, linkDensity: 0 },
  }
  const http = createHttpFetchEvidenceCandidate(source(), item('partial', 0.8, 800), [{
    queryId: 'query-1',
    agentRound: 1,
    acquisitionTool: 'web_search',
  }], 'ignored-id')!
  assert.ok(http.evidence.bindings.every((binding) => binding.acquisitionTool === 'http_fetch'))
  const upgraded = mergeResearchEvidenceCandidates(searchSummary, http)
  assert.equal(upgraded.evidence.evidenceType, 'partial')
  assert.equal(upgraded.evidence.evidenceId, 'evidence-1')
  assert.deepEqual(
    new Set(upgraded.evidence.bindings.map((binding) => binding.acquisitionTool)),
    new Set(['web_search', 'http_fetch']),
  )

  const weakerEqualType = createHttpFetchEvidenceCandidate(source(), item('full_text', 0.7, 1_100), [{
    queryId: 'query-2', agentRound: 2, acquisitionTool: 'web_search',
  }], 'evidence-http')!
  const preservedReader = mergeResearchEvidenceCandidates(readerCandidate(), weakerEqualType)
  assert.equal(preservedReader.evidence.content, 'Reader stronger content')
  assert.deepEqual(
    new Set(preservedReader.evidence.bindings.map((binding) => binding.acquisitionTool)),
    new Set(['read_webpage', 'http_fetch']),
  )

  const strongerHttp = createHttpFetchEvidenceCandidate(source(), item('full_text', 0.99, 3_000), [{
    queryId: 'query-3', agentRound: 2, acquisitionTool: 'web_search',
  }], 'evidence-http-strong')!
  assert.match(mergeResearchEvidenceCandidates(readerCandidate(), strongerHttp).evidence.content, /HTTP evidence/)
  const readerUpgrade = mergeResearchEvidenceCandidates(weakerEqualType, readerCandidate())
  assert.equal(readerUpgrade.evidence.content, 'Reader stronger content')
  assert.equal(readerUpgrade.evidence.evidenceId, weakerEqualType.evidence.evidenceId)
})

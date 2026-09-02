import { lookup as dnsLookup } from 'node:dns/promises'
import * as http from 'node:http'
import * as https from 'node:https'
import { isIP } from 'node:net'
import { DomUtils, parseDocument } from 'htmlparser2'
import type {
  ResearchAgentEvidenceRecord,
  ResearchEvidenceBinding,
} from '../types/research'
import type {
  HttpFetchExtractionMetrics,
  HttpFetchFailureCode,
  HttpFetchItemResult,
  HttpFetchToolCall,
  HttpFetchToolResult,
  ResearchSearchSource,
} from '../types/researchTool'
import { ResearchToolRuntimeError } from '../types/researchTool'
import {
  addressesMatch,
  assertAllResolvedAddressesPublic,
  HttpFetchItemError,
  isPublicHttpAddress,
  type ResolvedAddress,
  validateHttpFetchUrl,
} from './httpFetchSecurityService'

export const HTTP_FETCH_LIMITS = Object.freeze({
  dnsAndConnectTimeoutMs: 5_000,
  inactivityTimeoutMs: 5_000,
  singleUrlTimeoutMs: 15_000,
  batchTimeoutMs: 30_000,
  maxRedirects: 3,
  maxBodyBytes: 2 * 1024 * 1024,
  maxHeaderBytes: 16 * 1024,
  maxBatchSources: 8,
  concurrency: 3,
  maxEvidenceCharacters: 6_000,
})

type HeaderValue = string | string[] | undefined

export interface HttpFetchTransportRequest {
  url: URL
  pinnedAddress: ResolvedAddress
  signal: AbortSignal
  headers: Readonly<Record<string, string>>
  connectTimeoutMs: number
  inactivityTimeoutMs: number
  maxHeaderBytes: number
}

export interface HttpFetchTransportResponse {
  statusCode: number
  headers: Readonly<Record<string, HeaderValue>>
  body: AsyncIterable<Uint8Array | string>
  remoteAddress: string | null
  destroy: (error?: Error) => void
}

export type HttpFetchDnsResolver = (hostname: string) => Promise<ResolvedAddress[]>
export type HttpFetchTransport = (
  request: HttpFetchTransportRequest,
) => Promise<HttpFetchTransportResponse>

export interface HttpFetchDependencies {
  resolveDns?: HttpFetchDnsResolver
  transport?: HttpFetchTransport
  now?: () => number
}

interface ExtractedContent {
  title?: string
  content: string
  contentLength: number
  metrics: HttpFetchExtractionMetrics
}

interface EvidenceQuality extends HttpFetchExtractionMetrics {
  effectiveLength: number
}

export interface ResearchEvidenceUpgradeCandidate {
  evidence: ResearchAgentEvidenceRecord
  quality: EvidenceQuality
}

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308])
const ALLOWED_CONTENT_TYPES = new Set([
  'text/html',
  'application/xhtml+xml',
  'text/plain',
])
const EXCLUDED_TAGS = new Set([
  'script', 'style', 'noscript', 'template', 'svg', 'canvas', 'form',
  'nav', 'header', 'footer', 'aside',
])
const PARAGRAPH_TAGS = new Set([
  'p', 'li', 'blockquote', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'td',
])

function normalizedWhitespace(value: string) {
  return value.replace(/\u00a0/g, ' ').replace(/[\t\r ]+/g, ' ').trim()
}

function normalizedParagraph(value: string) {
  return normalizedWhitespace(value.replace(/\n+/g, ' '))
}

function effectiveLength(value: string) {
  return value.replace(/\s/g, '').length
}

function firstHeader(value: HeaderValue) {
  return Array.isArray(value) ? value[0] : value
}

function contentTypeMime(value: string | undefined) {
  return value?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
}

function findCharsetInContentType(value: string | undefined) {
  if (!value) return null
  const match = /(?:^|;)\s*charset\s*=\s*["']?([^;\s"']+)/i.exec(value)
  return match?.[1] ?? null
}

function findMetaCharset(buffer: Buffer) {
  const head = buffer.subarray(0, 8 * 1024).toString('latin1')
  const direct = /<meta\b[^>]*\bcharset\s*=\s*["']?\s*([^\s"'/>;]+)/i.exec(head)
  if (direct?.[1]) return direct[1]
  const httpEquiv = /<meta\b[^>]*\bcontent\s*=\s*["'][^"']*charset\s*=\s*([^\s;"']+)/i.exec(head)
  return httpEquiv?.[1] ?? null
}

function supportedCharset(value: string) {
  const normalized = value.trim().toLowerCase().replace(/_/g, '-')
  const aliases: Record<string, string> = {
    utf8: 'utf-8',
    'utf-8': 'utf-8',
    gb18030: 'gb18030',
    gbk: 'gb18030',
    gb2312: 'gb18030',
    big5: 'big5',
    'windows-1252': 'windows-1252',
    'iso-8859-1': 'windows-1252',
    'utf-16le': 'utf-16le',
    'utf-16be': 'utf-16be',
  }
  return aliases[normalized] ?? null
}

function decodeBody(buffer: Buffer, contentType: string | undefined) {
  let offset = 0
  let charset: string | null = null
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    charset = 'utf-8'
    offset = 3
  } else if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    charset = 'utf-16le'
    offset = 2
  } else if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    charset = 'utf-16be'
    offset = 2
  } else {
    const declared = findCharsetInContentType(contentType) ?? findMetaCharset(buffer) ?? 'utf-8'
    charset = supportedCharset(declared)
  }
  if (!charset) {
    throw new HttpFetchItemError('UNSUPPORTED_CHARSET', 'HTTP fetch 字符集不受支持。')
  }
  try {
    return new TextDecoder(charset, { fatal: true }).decode(buffer.subarray(offset))
  } catch {
    throw new HttpFetchItemError('PARSE_FAILED', 'HTTP fetch 正文解码失败。')
  }
}

function bestElement(elements: ReturnType<typeof DomUtils.findAll>) {
  return [...elements].sort((left, right) => (
    effectiveLength(DomUtils.textContent(right)) - effectiveLength(DomUtils.textContent(left))
  ))[0]
}

function extractHtml(html: string): ExtractedContent {
  let document: ReturnType<typeof parseDocument>
  try {
    document = parseDocument(html, { decodeEntities: true })
  } catch {
    throw new HttpFetchItemError('PARSE_FAILED', 'HTTP fetch HTML 解析失败。')
  }
  const titleElement = DomUtils.findOne((element) => element.name === 'title', document.children)
  const ogTitleElement = DomUtils.findOne((element) => (
    element.name === 'meta' && element.attribs.property?.toLowerCase() === 'og:title'
  ), document.children)
  const h1Element = DomUtils.findOne((element) => element.name === 'h1', document.children)
  const title = normalizedWhitespace(titleElement ? DomUtils.textContent(titleElement) : '')
    || normalizedWhitespace(ogTitleElement?.attribs.content ?? '')
    || normalizedWhitespace(h1Element ? DomUtils.textContent(h1Element) : '')
    || undefined

  DomUtils.findAll((element) => EXCLUDED_TAGS.has(element.name), document.children)
    .forEach((element) => DomUtils.removeElement(element))

  const article = bestElement(DomUtils.findAll((element) => element.name === 'article', document.children))
  const main = bestElement(DomUtils.findAll((element) => element.name === 'main', document.children))
  const roleMain = bestElement(DomUtils.findAll((element) => (
    element.attribs.role?.toLowerCase() === 'main'
  ), document.children))
  const commonContainer = bestElement(DomUtils.findAll((element) => {
    const marker = `${element.attribs.id ?? ''} ${element.attribs.class ?? ''}`.toLowerCase()
    return /(?:^|[\s_-])(article|content|post|story)(?:[\s_-]|$)/.test(marker)
  }, document.children))
  const body = bestElement(DomUtils.findAll((element) => element.name === 'body', document.children))
  const root = article ?? main ?? roleMain ?? commonContainer ?? body
  if (!root) throw new HttpFetchItemError('EMPTY_CONTENT', 'HTTP fetch 页面没有正文。')

  const tierConfidence = article ? 0.92 : main ? 0.86 : roleMain ? 0.82 : commonContainer ? 0.74 : 0.55
  const rootText = normalizedParagraph(DomUtils.textContent(root))
  const rootLength = Math.max(1, effectiveLength(rootText))
  const linkedText = DomUtils.findAll((element) => element.name === 'a', root.children)
    .reduce((total, element) => total + effectiveLength(DomUtils.textContent(element)), 0)
  const linkDensity = Math.min(1, linkedText / rootLength)
  const blocks = DomUtils.findAll((element) => PARAGRAPH_TAGS.has(element.name), root.children)
    .map((element) => normalizedParagraph(DomUtils.textContent(element)))
    .filter((paragraph) => effectiveLength(paragraph) >= 20)
  const paragraphs = blocks.length > 0 ? blocks : [rootText].filter(Boolean)
  const fullContent = paragraphs.join('\n\n')
  const contentLength = effectiveLength(fullContent)
  const paragraphCount = paragraphs.length
  const confidence = Math.max(0.1, Math.min(1,
    tierConfidence
      + (paragraphCount >= 3 ? 0.05 : -0.12)
      - (linkDensity > 0.5 ? 0.25 : linkDensity > 0.3 ? 0.12 : 0),
  ))
  return {
    title,
    content: fullContent.slice(0, HTTP_FETCH_LIMITS.maxEvidenceCharacters),
    contentLength,
    metrics: { paragraphCount, linkDensity, confidence },
  }
}

function extractPlainText(text: string): ExtractedContent {
  const paragraphs = text
    .split(/(?:\r?\n){2,}|\r?\n/)
    .map(normalizedParagraph)
    .filter((paragraph) => effectiveLength(paragraph) >= 20)
  const fullContent = paragraphs.join('\n\n')
  return {
    content: fullContent.slice(0, HTTP_FETCH_LIMITS.maxEvidenceCharacters),
    contentLength: effectiveLength(fullContent),
    metrics: {
      paragraphCount: paragraphs.length,
      linkDensity: 0,
      confidence: paragraphs.length >= 3 ? 0.9 : 0.68,
    },
  }
}

function classifyExtractedContent(extracted: ExtractedContent) {
  const qualityReached = extracted.metrics.confidence >= 0.65
    && extracted.metrics.linkDensity <= 0.5
  if (
    extracted.contentLength >= 1_000
    && extracted.metrics.paragraphCount >= 3
    && qualityReached
  ) return 'full_text' as const
  if (extracted.contentLength >= 300) return 'partial' as const
  throw new HttpFetchItemError('EMPTY_CONTENT', 'HTTP fetch 正文不足。')
}

async function defaultResolveDns(hostname: string): Promise<ResolvedAddress[]> {
  if (isIP(hostname) === 4) return [{ address: hostname, family: 4 }]
  if (isIP(hostname) === 6) return [{ address: hostname, family: 6 }]
  try {
    const addresses = await dnsLookup(hostname, { all: true, order: 'verbatim' })
    return addresses.map((entry) => ({ address: entry.address, family: entry.family as 4 | 6 }))
  } catch {
    throw new HttpFetchItemError('DNS_RESOLUTION_FAILED', 'HTTP fetch DNS 解析失败。')
  }
}

function defaultTransport(input: HttpFetchTransportRequest): Promise<HttpFetchTransportResponse> {
  return new Promise((resolve, reject) => {
    const client = input.url.protocol === 'https:' ? https : http
    const lookup = createPinnedLookup(input.pinnedAddress)
    const request = client.request(input.url, {
      method: 'GET',
      agent: false,
      signal: input.signal,
      lookup,
      maxHeaderSize: input.maxHeaderBytes,
      headers: input.headers,
    }, (response) => {
      resolve({
        statusCode: response.statusCode ?? 0,
        headers: response.headers,
        body: response,
        remoteAddress: response.socket.remoteAddress ?? null,
        destroy: (error?: Error) => response.destroy(error),
      })
    })
    request.setTimeout(input.inactivityTimeoutMs, () => {
      request.destroy(new HttpFetchItemError('TIMEOUT', 'HTTP fetch 响应超时。'))
    })
    request.once('socket', (socket) => {
      if (!socket.connecting) return
      const timer = setTimeout(() => {
        socket.destroy(new HttpFetchItemError('TIMEOUT', 'HTTP fetch 连接超时。'))
      }, input.connectTimeoutMs)
      const clear = () => clearTimeout(timer)
      socket.once('connect', clear)
      socket.once('secureConnect', clear)
      socket.once('error', clear)
      socket.once('close', clear)
    })
    request.once('error', reject)
    request.end()
  })
}

function createPinnedLookup(pinnedAddress: ResolvedAddress) {
  return ((_hostname: string, options: unknown, callback?: unknown) => {
    const cb = (typeof options === 'function' ? options : callback) as (...args: unknown[]) => void
    const wantsAll = typeof options === 'object'
      && options !== null
      && Reflect.get(options, 'all') === true
    if (wantsAll) cb(null, [pinnedAddress])
    else cb(null, pinnedAddress.address, pinnedAddress.family)
  }) as NonNullable<http.RequestOptions['lookup']>
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
) {
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      callback()
    }
    const onAbort = () => finish(() => reject(new HttpFetchItemError('TIMEOUT', 'HTTP fetch 已超时。')))
    const timer = setTimeout(onAbort, timeoutMs)
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) onAbort()
    operation.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    )
  })
}

async function resolvePinnedAddress(
  hostname: string,
  resolver: HttpFetchDnsResolver,
  signal: AbortSignal,
) {
  let addresses: ResolvedAddress[]
  try {
    addresses = await withTimeout(
      resolver(hostname),
      HTTP_FETCH_LIMITS.dnsAndConnectTimeoutMs,
      signal,
    )
  } catch (error) {
    if (error instanceof HttpFetchItemError) throw error
    throw new HttpFetchItemError('DNS_RESOLUTION_FAILED', 'HTTP fetch DNS 解析失败。')
  }
  assertAllResolvedAddressesPublic(addresses)
  return addresses[0]!
}

async function readBoundedBody(response: HttpFetchTransportResponse) {
  const declared = firstHeader(response.headers['content-length'])
  if (declared && /^\d+$/.test(declared) && Number(declared) > HTTP_FETCH_LIMITS.maxBodyBytes) {
    response.destroy()
    throw new HttpFetchItemError('RESPONSE_TOO_LARGE', 'HTTP fetch 响应正文过大。')
  }
  const chunks: Buffer[] = []
  let size = 0
  try {
    for await (const chunk of response.body) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buffer.length
      if (size > HTTP_FETCH_LIMITS.maxBodyBytes) {
        response.destroy()
        throw new HttpFetchItemError('RESPONSE_TOO_LARGE', 'HTTP fetch 响应正文过大。')
      }
      chunks.push(buffer)
    }
  } catch (error) {
    if (error instanceof HttpFetchItemError) throw error
    throw new HttpFetchItemError('NETWORK_ERROR', 'HTTP fetch 响应读取失败。')
  }
  return Buffer.concat(chunks, size)
}

function linkAbortSignal(parent: AbortSignal, child: AbortController) {
  const abort = () => child.abort()
  if (parent.aborted) child.abort()
  else parent.addEventListener('abort', abort, { once: true })
  return () => parent.removeEventListener('abort', abort)
}

function failureCode(error: unknown): HttpFetchFailureCode {
  if (error instanceof HttpFetchItemError) return error.code
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return 'TIMEOUT'
  }
  return 'NETWORK_ERROR'
}

async function fetchSource(
  source: ResearchSearchSource,
  batchSignal: AbortSignal,
  dependencies: Required<HttpFetchDependencies>,
): Promise<HttpFetchItemResult> {
  const startedAt = dependencies.now()
  const controller = new AbortController()
  const unlink = linkAbortSignal(batchSignal, controller)
  const timeout = setTimeout(() => controller.abort(), HTTP_FETCH_LIMITS.singleUrlTimeoutMs)
  let redirectCount = 0
  let httpStatus: number | undefined
  try {
    let current = validateHttpFetchUrl(source.url).url
    const visited = new Set<string>()
    while (true) {
      if (controller.signal.aborted) throw new HttpFetchItemError('TIMEOUT', 'HTTP fetch 已超时。')
      const normalized = current.toString()
      if (visited.has(normalized)) {
        throw new HttpFetchItemError('REDIRECT_LOOP', 'HTTP fetch redirect 出现循环。')
      }
      visited.add(normalized)
      const { hostname } = validateHttpFetchUrl(normalized)
      let pinned: ResolvedAddress
      try {
        pinned = await resolvePinnedAddress(hostname, dependencies.resolveDns, controller.signal)
      } catch (error) {
        if (redirectCount > 0 && error instanceof HttpFetchItemError) {
          throw new HttpFetchItemError('REDIRECT_BLOCKED', 'HTTP fetch redirect 目标不安全。')
        }
        throw error
      }
      const response = await dependencies.transport({
        url: current,
        pinnedAddress: pinned,
        signal: controller.signal,
        headers: Object.freeze({
          Accept: 'text/html, application/xhtml+xml, text/plain;q=0.9',
          'Accept-Encoding': 'identity',
          'User-Agent': 'DeepResearch-HttpFetch/1.0',
        }),
        connectTimeoutMs: HTTP_FETCH_LIMITS.dnsAndConnectTimeoutMs,
        inactivityTimeoutMs: HTTP_FETCH_LIMITS.inactivityTimeoutMs,
        maxHeaderBytes: HTTP_FETCH_LIMITS.maxHeaderBytes,
      })
      httpStatus = response.statusCode
      if (
        !response.remoteAddress
        || !isPublicHttpAddress(response.remoteAddress)
        || !addressesMatch(pinned.address, response.remoteAddress)
      ) {
        response.destroy()
        throw new HttpFetchItemError('PRIVATE_ADDRESS_BLOCKED', 'HTTP fetch 连接地址校验失败。')
      }
      if (REDIRECT_STATUS.has(response.statusCode)) {
        response.destroy()
        if (redirectCount >= HTTP_FETCH_LIMITS.maxRedirects) {
          throw new HttpFetchItemError('TOO_MANY_REDIRECTS', 'HTTP fetch redirect 次数过多。')
        }
        const location = firstHeader(response.headers.location)
        if (!location) throw new HttpFetchItemError('REDIRECT_BLOCKED', 'HTTP fetch redirect 无效。')
        let next: URL
        try {
          next = new URL(location, current)
          validateHttpFetchUrl(next.toString())
        } catch {
          throw new HttpFetchItemError('REDIRECT_BLOCKED', 'HTTP fetch redirect 目标不安全。')
        }
        if (current.protocol === 'https:' && next.protocol !== 'https:') {
          throw new HttpFetchItemError('REDIRECT_BLOCKED', 'HTTP fetch 不允许降级 redirect。')
        }
        redirectCount += 1
        current = next
        continue
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.destroy()
        throw new HttpFetchItemError('HTTP_ERROR', 'HTTP fetch 上游返回错误状态。', response.statusCode)
      }
      const contentEncoding = firstHeader(response.headers['content-encoding'])?.trim().toLowerCase()
      if (contentEncoding && contentEncoding !== 'identity') {
        response.destroy()
        throw new HttpFetchItemError(
          'UNSUPPORTED_CONTENT_ENCODING',
          'HTTP fetch 不支持压缩响应。',
          response.statusCode,
        )
      }
      const rawContentType = firstHeader(response.headers['content-type'])
      const mime = contentTypeMime(rawContentType)
      if (!ALLOWED_CONTENT_TYPES.has(mime)) {
        response.destroy()
        throw new HttpFetchItemError(
          'UNSUPPORTED_CONTENT_TYPE',
          'HTTP fetch Content-Type 不受支持。',
          response.statusCode,
        )
      }
      const body = await readBoundedBody(response)
      const decoded = decodeBody(body, rawContentType)
      const extracted = mime === 'text/plain' ? extractPlainText(decoded) : extractHtml(decoded)
      const status = classifyExtractedContent(extracted)
      return {
        candidateId: source.candidateId,
        status,
        finalUrl: current.toString(),
        title: extracted.title,
        content: extracted.content,
        contentLength: extracted.contentLength,
        contentType: mime,
        extraction: extracted.metrics,
        fetchMetadata: {
          httpStatus: response.statusCode,
          redirectCount,
          durationMs: Math.max(0, dependencies.now() - startedAt),
        },
      }
    }
  } catch (error) {
    const code = failureCode(error)
    console.warn('[research:http-fetch] item-failed', {
      candidateId: source.candidateId,
      failureCode: code,
      redirectCount,
    })
    return {
      candidateId: source.candidateId,
      status: 'failed',
      content: '',
      contentLength: 0,
      failureCode: code,
      fetchMetadata: {
        httpStatus: error instanceof HttpFetchItemError ? error.httpStatus ?? httpStatus : httpStatus,
        redirectCount,
        durationMs: Math.max(0, dependencies.now() - startedAt),
      },
    }
  } finally {
    clearTimeout(timeout)
    unlink()
  }
}

function completeDependencies(dependencies: HttpFetchDependencies): Required<HttpFetchDependencies> {
  return {
    resolveDns: dependencies.resolveDns ?? defaultResolveDns,
    transport: dependencies.transport ?? defaultTransport,
    now: dependencies.now ?? Date.now,
  }
}

export async function fetchStaticResearchSources(
  call: HttpFetchToolCall,
  dependencies: HttpFetchDependencies = {},
): Promise<HttpFetchToolResult> {
  if (
    !Array.isArray(call.sources)
    || call.sources.length < 1
    || call.sources.length > HTTP_FETCH_LIMITS.maxBatchSources
  ) {
    throw new ResearchToolRuntimeError(
      'RESEARCH_TOOL_ARGUMENTS_INVALID',
      'http_fetch batch 参数无效。',
    )
  }
  const resolved = completeDependencies(dependencies)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), HTTP_FETCH_LIMITS.batchTimeoutMs)
  const items = new Array<HttpFetchItemResult>(call.sources.length)
  let cursor = 0
  try {
    const workers = Array.from(
      { length: Math.min(HTTP_FETCH_LIMITS.concurrency, call.sources.length) },
      async () => {
        while (cursor < call.sources.length) {
          const index = cursor
          cursor += 1
          items[index] = await fetchSource(call.sources[index]!, controller.signal, resolved)
        }
      },
    )
    await Promise.all(workers)
  } finally {
    clearTimeout(timeout)
  }
  const successfulCount = items.filter((item) => item.status !== 'failed').length
  return {
    executionId: call.executionId,
    tool: 'http_fetch',
    status: successfulCount === items.length ? 'success' : 'partial',
    items,
    successfulCount,
    failedCount: items.length - successfulCount,
    warnings: successfulCount === items.length
      ? []
      : [`HTTP fetch 有 ${items.length - successfulCount} 个来源未获得可用正文。`],
  }
}

function evidenceBindingKey(binding: ResearchEvidenceBinding) {
  return [
    binding.evidenceNeedId ?? '',
    binding.queryId,
    binding.agentRound,
    binding.acquisitionTool,
  ].join('|')
}

function normalizedEvidenceUrl(value: string) {
  const url = new URL(value)
  url.hash = ''
  return url.toString()
}

function evidenceTypeRank(value: ResearchAgentEvidenceRecord['evidenceType']) {
  return value === 'full_text' ? 3 : value === 'partial' ? 2 : 1
}

function qualityScore(value: EvidenceQuality) {
  return value.confidence * 1_000_000
    + Math.min(value.effectiveLength, 100_000) * 10
    + Math.min(value.paragraphCount, 100) * 100
    - Math.round(value.linkDensity * 10_000)
}

export function createHttpFetchEvidenceCandidate(
  source: ResearchSearchSource,
  item: HttpFetchItemResult,
  bindings: readonly ResearchEvidenceBinding[],
  evidenceId: string,
): ResearchEvidenceUpgradeCandidate | null {
  if (item.status === 'failed' || !item.extraction || item.contentLength < 300) return null
  const evidenceType = item.status === 'full_text' ? 'full_text' : 'partial'
  const url = item.finalUrl ?? source.url
  return {
    evidence: {
      evidenceId,
      normalizedUrl: normalizedEvidenceUrl(source.url),
      metadata: {
        url,
        title: item.title ?? source.title,
        publisher: source.publisher,
        publishedAt: source.publishedAt,
        snippet: source.snippet,
      },
      evidenceType,
      content: item.content,
      sourceType: source.sourceCategory,
      bindings: bindings.map((binding) => ({ ...binding, acquisitionTool: 'http_fetch' })),
    },
    quality: {
      ...item.extraction,
      effectiveLength: item.contentLength,
    },
  }
}

export function mergeResearchEvidenceCandidates(
  existing: ResearchEvidenceUpgradeCandidate,
  incoming: ResearchEvidenceUpgradeCandidate,
) {
  if (existing.evidence.normalizedUrl !== incoming.evidence.normalizedUrl) {
    throw new Error('Cannot merge Research Evidence with different URLs')
  }
  const existingRank = evidenceTypeRank(existing.evidence.evidenceType)
  const incomingRank = evidenceTypeRank(incoming.evidence.evidenceType)
  const incomingWins = incomingRank > existingRank
    || (incomingRank === existingRank && qualityScore(incoming.quality) > qualityScore(existing.quality))
  const winner = incomingWins ? incoming : existing
  const bindings = [...existing.evidence.bindings, ...incoming.evidence.bindings]
    .filter((binding, index, all) => all.findIndex(
      (candidate) => evidenceBindingKey(candidate) === evidenceBindingKey(binding),
    ) === index)
  return {
    evidence: {
      ...winner.evidence,
      evidenceId: existing.evidence.evidenceId,
      bindings,
    },
    quality: { ...winner.quality },
  }
}

export const httpFetchTestApi = {
  decodeBody,
  extractHtml,
  extractPlainText,
  classifyExtractedContent,
  defaultTransport,
  defaultResolveDns,
  createPinnedLookup,
  withTimeout,
}

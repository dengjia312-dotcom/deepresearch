import type {
  ResearchEvidenceType,
  ResearchRequest,
  ResearchSynthesisEvidence,
  VerifiedSearchMetadata,
} from '../types/research'
import { ResearchServiceError } from './serviceError'
import { asString, isRecord } from './serviceUtils'
import {
  getAiConcurrencyRetryAfterSeconds,
  tryAcquireGlobalAiSlot,
} from './aiConcurrency'

const DEFAULT_GLM_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4'
const GLM_REQUEST_TIMEOUT_MS = 30_000
const GLM_READER_TIMEOUT_SECONDS = 20
const MAX_SEARCH_CANDIDATES = 12
const MAX_READER_SOURCES = 8
const MAX_EVIDENCE_CONTENT_LENGTH = 6000
const DEFAULT_READER_CONCURRENCY = 3

export const FULL_TEXT_MIN_LENGTH = 1000
export const PARTIAL_TEXT_MIN_LENGTH = 300

interface GlmConfiguration {
  apiKey: string
  baseUrl: string
  configured: boolean
}

interface GlmJsonResponse {
  httpStatus: number
  ok: boolean
  payload: unknown
}

export type GlmReaderStatus = 'full_text' | 'partial' | 'insufficient' | 'unavailable'
export type GlmReaderFailureCategory =
  | 'HTTP_4XX'
  | 'HTTP_5XX'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'INVALID_RESPONSE'
  | 'EMPTY_CONTENT'
  | 'UNKNOWN'

export interface GlmReaderResult {
  status: GlmReaderStatus
  content: string
  contentLength: number
  httpStatus: number | null
  failureCategory?: GlmReaderFailureCategory | null
}

export interface GlmReaderStats {
  attemptedCount: number
  fullTextCount: number
  partialCount: number
  insufficientCount: number
  failedCount: number
  searchSummaryCount: number
  averageContentLength: number
  failureCategories: Record<GlmReaderFailureCategory, number>
  httpStatusCounts: Record<string, number>
}

export interface GlmResearchRetrievalResult {
  actualSourceCount: number
  deduplicatedSourceCount: number
  metadata: VerifiedSearchMetadata[]
  evidenceSources: ResearchSynthesisEvidence[]
  warnings: string[]
  readerStats: GlmReaderStats
}

interface SearchMappingResult {
  actualSourceCount: number
  validSourceCount: number
  deduplicatedMetadata: VerifiedSearchMetadata[]
}

interface ReaderDependencies {
  concurrency?: number
  readSource?: typeof readResearchSourceWithGlm
  onReaderCompleted?: (status: GlmReaderStatus) => Promise<void> | void
}

export interface GlmResearchProgressHooks {
  onSearchCompleted?: (validSourceCount: number) => Promise<void> | void
  onReaderStarted?: (readerTargetCount: number) => Promise<void> | void
  onReaderCompleted?: (status: GlmReaderStatus) => Promise<void> | void
}

function getPositiveInteger(name: string, fallback: number) {
  const value = Number(process.env[name]?.trim())
  return Number.isInteger(value) && value > 0 ? value : fallback
}

export function getGlmConfiguration(): GlmConfiguration {
  const apiKey = process.env.GLM_API_KEY?.trim() || ''
  const baseUrl = (process.env.GLM_BASE_URL?.trim() || DEFAULT_GLM_BASE_URL).replace(/\/$/, '')
  return { apiKey, baseUrl, configured: Boolean(apiKey) }
}

function normalizeHttpUrl(value: string) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

function buildGlmSearchQuery(request: ResearchRequest) {
  const preferences = request.sourcePreferences.join('、').slice(0, 16)
  return [
    request.topic.slice(0, 24),
    request.goal.slice(0, 28),
    preferences,
  ].filter(Boolean).join(' ').slice(0, 70)
}

async function requestGlmJson(
  path: '/web_search' | '/reader',
  body: Record<string, unknown>,
): Promise<GlmJsonResponse> {
  const config = getGlmConfiguration()
  if (!config.configured) {
    throw new ResearchServiceError(
      'RESEARCH_SEARCH_FAILED',
      503,
      'GLM API 尚未配置。',
      undefined,
      'GLM_NOT_CONFIGURED',
    )
  }

  const releaseAiSlot = tryAcquireGlobalAiSlot()
  if (!releaseAiSlot) {
    throw new ResearchServiceError(
      'API_CONCURRENCY_LIMITED',
      503,
      '当前 AI 服务请求较多，请稍后手动重试。',
      getAiConcurrencyRetryAfterSeconds(),
      'LOCAL_CONCURRENCY_LIMITED',
    )
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), GLM_REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    let payload: unknown = null
    try {
      payload = await response.json()
    } catch {
      if (response.ok) {
        throw new ResearchServiceError(
          'RESEARCH_SEARCH_FAILED',
          502,
          'GLM API 返回格式异常。',
          undefined,
          'GLM_RESPONSE_INVALID',
        )
      }
    }
    return { httpStatus: response.status, ok: response.ok, payload }
  } catch (error) {
    if (error instanceof ResearchServiceError) throw error
    const timedOut = error instanceof Error
      && (error.name === 'AbortError' || error.name === 'TimeoutError')
    throw new ResearchServiceError(
      'RESEARCH_SEARCH_FAILED',
      timedOut ? 504 : 502,
      timedOut ? 'GLM API 请求超时。' : '无法连接 GLM API。',
      undefined,
      timedOut ? 'GLM_TIMEOUT' : 'GLM_NETWORK_ERROR',
    )
  } finally {
    clearTimeout(timeout)
    releaseAiSlot()
  }
}

function createGlmSearchHttpError(httpStatus: number) {
  const statusCode = httpStatus === 402 || httpStatus === 429 ? 503 : 502
  const message = httpStatus === 401 || httpStatus === 403
    ? 'GLM Web Search 鉴权或访问权限异常。'
    : httpStatus === 402
      ? 'GLM Web Search 账户额度不足。'
      : httpStatus === 429
        ? 'GLM Web Search 请求过于频繁，请稍后手动重试。'
        : `GLM Web Search 请求失败（${httpStatus}）。`
  return new ResearchServiceError('RESEARCH_SEARCH_FAILED', statusCode, message)
}

function mapGlmSearchResults(payload: unknown): SearchMappingResult | null {
  if (!isRecord(payload) || !Array.isArray(payload.search_result)) return null
  const actualSourceCount = payload.search_result.length
  let validSourceCount = 0
  const unique = new Map<string, VerifiedSearchMetadata>()

  payload.search_result.forEach((item) => {
    if (!isRecord(item)) return
    const url = normalizeHttpUrl(asString(item.link))
    const title = asString(item.title)
    const snippet = asString(item.content)
    if (!url || !title || !snippet) return
    validSourceCount += 1
    if (unique.has(url)) return
    const hostname = new URL(url).hostname
    unique.set(url, {
      url,
      title,
      publisher: asString(item.media) || hostname,
      publishedAt: asString(item.publish_date),
      snippet,
    })
  })

  return {
    actualSourceCount,
    validSourceCount,
    deduplicatedMetadata: [...unique.values()],
  }
}

function prioritizeResearchCandidates(
  metadata: VerifiedSearchMetadata[],
  sourcePreferences: string[],
) {
  const preferences = sourcePreferences.map((item) => item.trim().toLowerCase()).filter(Boolean)
  return metadata
    .map((source, index) => {
      const searchable = `${source.title} ${source.publisher} ${source.snippet}`.toLowerCase()
      const preferenceMatch = preferences.some((preference) => searchable.includes(preference))
      return { source, index, preferenceMatch }
    })
    .sort((left, right) => (
      Number(right.preferenceMatch) - Number(left.preferenceMatch)
      || left.index - right.index
    ))
    .map((item) => item.source)
}

export async function searchResearchSourcesWithGlm(request: ResearchRequest) {
  const maxAttempts = 2
  const searchStartedAt = Date.now()
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const startedAt = Date.now()
    console.info('[research:glm-search] started', { attempt })
    const response = await requestGlmJson('/web_search', {
      search_query: buildGlmSearchQuery(request),
      search_engine: 'search_std',
      search_intent: false,
      count: Math.min(16, Math.max(request.targetSourceCount, 12)),
      search_recency_filter: 'noLimit',
      content_size: 'high',
    })
    if (!response.ok) throw createGlmSearchHttpError(response.httpStatus)

    const mapped = mapGlmSearchResults(response.payload)
    if (!mapped) {
      throw new ResearchServiceError(
        'RESEARCH_SEARCH_FAILED',
        502,
        'GLM Web Search 返回格式异常。',
      )
    }
    console.info('[research:glm-search] completed', {
      attempt,
      resultCount: mapped.actualSourceCount,
      validSourceCount: mapped.validSourceCount,
      deduplicatedSourceCount: mapped.deduplicatedMetadata.length,
      durationMs: Date.now() - startedAt,
    })

    if (mapped.deduplicatedMetadata.length > 0) {
      const maxCandidates = Math.min(MAX_SEARCH_CANDIDATES, request.targetSourceCount)
      return {
        actualSourceCount: mapped.actualSourceCount,
        deduplicatedSourceCount: mapped.deduplicatedMetadata.length,
        metadata: prioritizeResearchCandidates(
          mapped.deduplicatedMetadata,
          request.sourcePreferences,
        ).slice(0, maxCandidates),
      }
    }
    if (attempt < maxAttempts) {
      console.warn('[research:glm-search] empty result, retrying', { attempt })
    }
  }

  console.error('[research:glm-search] failed', {
    attempts: 2,
    errorCode: 'NO_REAL_SOURCES',
    durationMs: Date.now() - searchStartedAt,
  })
  throw new ResearchServiceError(
    'NO_REAL_SOURCES',
    502,
    'GLM Web Search 未返回可验证的真实来源。',
  )
}

function classifyReaderContent(contentLength: number): GlmReaderStatus {
  if (contentLength >= FULL_TEXT_MIN_LENGTH) return 'full_text'
  if (contentLength >= PARTIAL_TEXT_MIN_LENGTH) return 'partial'
  return 'insufficient'
}

function classifyHttpFailure(httpStatus: number): GlmReaderFailureCategory {
  if (httpStatus >= 400 && httpStatus < 500) return 'HTTP_4XX'
  if (httpStatus >= 500) return 'HTTP_5XX'
  return 'UNKNOWN'
}

function classifyReaderException(error: unknown): GlmReaderFailureCategory {
  if (!(error instanceof ResearchServiceError)) return 'UNKNOWN'
  if (error.diagnosticCode === 'GLM_TIMEOUT') return 'TIMEOUT'
  if (error.diagnosticCode === 'GLM_NETWORK_ERROR') return 'NETWORK'
  if (error.diagnosticCode === 'GLM_RESPONSE_INVALID') return 'INVALID_RESPONSE'
  return 'UNKNOWN'
}

export async function readResearchSourceWithGlm(url: string): Promise<GlmReaderResult> {
  try {
    const response = await requestGlmJson('/reader', {
      url,
      timeout: GLM_READER_TIMEOUT_SECONDS,
      return_format: 'text',
      retain_images: false,
      with_images_summary: false,
      with_links_summary: false,
    })
    if (!response.ok) {
      return {
        status: 'unavailable',
        content: '',
        contentLength: 0,
        httpStatus: response.httpStatus,
        failureCategory: classifyHttpFailure(response.httpStatus),
      }
    }
    if (!isRecord(response.payload) || !isRecord(response.payload.reader_result)) {
      return {
        status: 'unavailable',
        content: '',
        contentLength: 0,
        httpStatus: response.httpStatus,
        failureCategory: 'INVALID_RESPONSE',
      }
    }
    const content = asString(response.payload.reader_result.content)
    return {
      status: classifyReaderContent(content.length),
      content,
      contentLength: content.length,
      httpStatus: response.httpStatus,
      failureCategory: content.length === 0 ? 'EMPTY_CONTENT' : null,
    }
  } catch (error) {
    return {
      status: 'unavailable',
      content: '',
      contentLength: 0,
      httpStatus: null,
      failureCategory: classifyReaderException(error),
    }
  }
}

function toEvidenceType(status: GlmReaderStatus): ResearchEvidenceType {
  if (status === 'full_text') return 'full_text'
  if (status === 'partial') return 'partial'
  return 'search_summary'
}

function buildEvidenceContent(source: VerifiedSearchMetadata, reader: GlmReaderResult | undefined) {
  if (reader?.status === 'full_text') return reader.content.slice(0, MAX_EVIDENCE_CONTENT_LENGTH)
  if (reader?.status === 'partial') {
    return `${reader.content}\n\n${source.snippet}`.slice(0, MAX_EVIDENCE_CONTENT_LENGTH)
  }
  return source.snippet.slice(0, MAX_EVIDENCE_CONTENT_LENGTH)
}

export async function enrichResearchSourcesWithGlm(
  metadata: VerifiedSearchMetadata[],
  dependencies: ReaderDependencies = {},
) {
  const startedAt = Date.now()
  const readSource = dependencies.readSource ?? readResearchSourceWithGlm
  const concurrency = Math.min(
    DEFAULT_READER_CONCURRENCY,
    Math.max(
      1,
      Math.floor(dependencies.concurrency ?? getPositiveInteger(
        'GLM_READER_CONCURRENCY',
        DEFAULT_READER_CONCURRENCY,
      )),
    ),
  )
  const readerTargets = metadata.slice(0, MAX_READER_SOURCES)
  const results: GlmReaderResult[] = new Array(readerTargets.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < readerTargets.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      results[currentIndex] = await readSource(readerTargets[currentIndex]!.url)
      await dependencies.onReaderCompleted?.(results[currentIndex]!.status)
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, readerTargets.length) },
      () => worker(),
    ),
  )

  const evidenceSources = metadata.map<ResearchSynthesisEvidence>((source, index) => {
    const reader = results[index]
    return {
      ...source,
      sourceId: `source-${index + 1}`,
      evidenceType: toEvidenceType(reader?.status ?? 'unavailable'),
      content: buildEvidenceContent(source, reader),
    }
  })
  const contentLengths = results.map((result) => result.contentLength)
  const failureCategoryNames: GlmReaderFailureCategory[] = [
    'HTTP_4XX',
    'HTTP_5XX',
    'TIMEOUT',
    'NETWORK',
    'INVALID_RESPONSE',
    'EMPTY_CONTENT',
    'UNKNOWN',
  ]
  const failureCategories = Object.fromEntries(
    failureCategoryNames.map((category) => [
      category,
      results.filter((result) => result.failureCategory === category).length,
    ]),
  ) as Record<GlmReaderFailureCategory, number>
  const httpStatusCounts = results.reduce<Record<string, number>>((counts, result) => {
    if (result.failureCategory && result.httpStatus !== null) {
      const key = String(result.httpStatus)
      counts[key] = (counts[key] ?? 0) + 1
    }
    return counts
  }, {})
  const readerStats: GlmReaderStats = {
    attemptedCount: results.length,
    fullTextCount: results.filter((result) => result.status === 'full_text').length,
    partialCount: results.filter((result) => result.status === 'partial').length,
    insufficientCount: results.filter((result) => result.status === 'insufficient').length,
    failedCount: results.filter((result) => result.status === 'unavailable').length,
    searchSummaryCount: evidenceSources.filter(
      (source) => source.evidenceType === 'search_summary',
    ).length,
    averageContentLength: contentLengths.length > 0
      ? Math.round(contentLengths.reduce((sum, length) => sum + length, 0) / contentLengths.length)
      : 0,
    failureCategories,
    httpStatusCounts,
  }
  const warnings: string[] = []
  if (readerStats.insufficientCount > 0) {
    warnings.push(`有 ${readerStats.insufficientCount} 条来源正文不足，已使用搜索摘要继续研究。`)
  }
  if (readerStats.failedCount > 0) {
    warnings.push(`有 ${readerStats.failedCount} 条来源正文读取失败，已使用搜索摘要继续研究。`)
  }

  console.info('[research:glm-reader] completed', {
    attemptedCount: readerStats.attemptedCount,
    fullTextCount: readerStats.fullTextCount,
    partialCount: readerStats.partialCount,
    insufficientCount: readerStats.insufficientCount,
    failedCount: readerStats.failedCount,
    searchSummaryCount: readerStats.searchSummaryCount,
    averageContentLength: readerStats.averageContentLength,
    failureCategories: readerStats.failureCategories,
    httpStatusCounts: readerStats.httpStatusCounts,
    durationMs: Date.now() - startedAt,
  })
  return { evidenceSources, readerStats, warnings }
}

export async function retrieveResearchSourcesWithGlm(
  request: ResearchRequest,
  hooks: GlmResearchProgressHooks = {},
): Promise<GlmResearchRetrievalResult> {
  const search = await searchResearchSourcesWithGlm(request)
  await hooks.onSearchCompleted?.(search.metadata.length)
  await hooks.onReaderStarted?.(Math.min(MAX_READER_SOURCES, search.metadata.length))
  const reader = await enrichResearchSourcesWithGlm(search.metadata, {
    onReaderCompleted: hooks.onReaderCompleted,
  })
  return {
    ...search,
    evidenceSources: reader.evidenceSources,
    warnings: reader.warnings,
    readerStats: reader.readerStats,
  }
}

export const glmResearchRetrievalTestApi = {
  buildGlmSearchQuery,
  classifyReaderContent,
  mapGlmSearchResults,
  maxEvidenceContentLength: MAX_EVIDENCE_CONTENT_LENGTH,
  maxReaderSources: MAX_READER_SOURCES,
  maxSearchCandidates: MAX_SEARCH_CANDIDATES,
}

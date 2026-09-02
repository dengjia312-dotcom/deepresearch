import type {
  ResearchIntent,
  ResearchAgentSourceType,
  ResearchEvidenceType,
  ResearchRequest,
  ResearchStrategy,
  ResearchSynthesisEvidence,
  SearchQuery,
  VerifiedSearchMetadata,
} from '../types/research'
import type {
  ResearchReaderFailureCategory,
  ResearchReaderStats,
  ResearchReaderStatus,
  ResearchSearchRelevance,
  ResearchSearchSource,
} from '../types/researchTool'
import { ResearchServiceError } from './serviceError'
import { asString, isRecord } from './serviceUtils'
import { generateContent, parseGeneratedJson } from './generation/generationService'
import { resolveResearchStrategy } from './researchStrategyService'
import {
  getAiConcurrencyRetryAfterSeconds,
  tryAcquireGlobalAiSlot,
} from './aiConcurrency'

const DEFAULT_GLM_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4'
const GLM_REQUEST_TIMEOUT_MS = 30_000
const GLM_READER_TIMEOUT_SECONDS = 20
const SEARCH_RESULTS_PER_QUERY = 6
const MAX_SEARCH_CANDIDATES = 16
const MAX_READER_SOURCES = 8
const MAX_EVIDENCE_CONTENT_LENGTH = 6000
const DEFAULT_READER_CONCURRENCY = 3
const DEFAULT_SEARCH_QUERY_CONCURRENCY = 2
const MAX_SEARCH_QUERY_CONCURRENCY = 3

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

export type GlmReaderStatus = ResearchReaderStatus
export type GlmReaderFailureCategory = ResearchReaderFailureCategory

export interface GlmReaderResult {
  status: GlmReaderStatus
  content: string
  contentLength: number
  httpStatus: number | null
  failureCategory?: GlmReaderFailureCategory | null
}

export type GlmReaderStats = ResearchReaderStats

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

type SourceRelevance = ResearchSearchRelevance
export type GlmSearchCandidate = ResearchSearchSource

export interface GlmSearchResult {
  actualSourceCount: number
  deduplicatedSourceCount: number
  metadata: GlmSearchCandidate[]
  warnings: string[]
}

export interface GlmReaderBatchResult {
  evidenceSources: ResearchSynthesisEvidence[]
  readerStats: GlmReaderStats
  warnings: string[]
}

interface SearchQueryResult {
  query: SearchQuery
  mapped: SearchMappingResult | null
  error: unknown | null
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
  return resolveResearchStrategy(request).queryPlan.queries[0]!.query
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

function classifySourceCategory(source: VerifiedSearchMetadata): ResearchAgentSourceType {
  const hostname = new URL(source.url).hostname.toLocaleLowerCase()
  const text = `${hostname} ${source.publisher} ${source.title}`.toLocaleLowerCase()
  if (/\.gov\.|\.gov\.cn$|政府|部委|委员会/.test(text)) return 'official'
  if (/招聘|岗位|职位|人才|career|jobs?|zhaopin|liepin|boss/.test(text)) return 'recruitment'
  if (/研究院|研究报告|白皮书|智库|大学|高校|学术|论文|\.edu\.|arxiv/.test(text)) return 'academic'
  if (/论坛|社区|问答|知乎|reddit|community/.test(text)) return 'community'
  if (/协会|专业平台|建筑|设计|开发者/.test(text)) return 'professional'
  if (/公司|集团|企业|inc\.|corp\.|company/.test(text)) return 'company'
  if (/新闻|日报|周刊|news|times|post|media/.test(text)) return 'news'
  return 'general_web'
}

function relevanceByRule(
  source: VerifiedSearchMetadata,
  intent: ResearchIntent,
): SourceRelevance {
  const searchable = `${source.title} ${source.publisher} ${source.snippet.slice(0, 800)}`
    .toLocaleLowerCase()
  const concepts = intent.keyConcepts
    .map((concept) => concept.trim().toLocaleLowerCase())
    .filter((concept) => concept.length >= 2)
  const excluded = intent.excludedMeanings
    .map((meaning) => meaning.trim().toLocaleLowerCase())
    .filter((meaning) => meaning.length >= 2)
  const positiveMatches = concepts.filter((concept) => searchable.includes(concept)).length
  const excludedMatch = excluded.some((meaning) => searchable.includes(meaning))
  if (excludedMatch && positiveMatches === 0) return 'low'
  if (excludedMatch) return 'uncertain'
  if (positiveMatches >= 2) return 'high'
  if (positiveMatches === 1) return 'medium'
  return intent.ambiguityDetected ? 'uncertain' : 'medium'
}

async function classifyUncertainCandidatesWithFlash(
  candidates: GlmSearchCandidate[],
  intent: ResearchIntent,
) {
  if (candidates.length === 0) return new Map<string, Exclude<SourceRelevance, 'uncertain'>>()
  const compactSources = candidates.map((source) => ({
    sourceId: source.candidateId,
    title: source.title.slice(0, 240),
    snippet: source.snippet.slice(0, 500),
    publisher: source.publisher.slice(0, 120),
  }))
  try {
    const result = await generateContent('relevance', {
      messages: [
        {
          role: 'system',
          content: '你是研究资料相关度分类器。只判断候选来源是否直接服务于给定研究对象，不得联网，不得补充来源。',
        },
        {
          role: 'user',
          content: `研究对象：${intent.researchObject}\n用户意图：${intent.userIntent}\n关键概念：${intent.keyConcepts.join('、')}\n需要排除的含义：${intent.excludedMeanings.join('、') || '无'}\n候选来源：${JSON.stringify(compactSources)}\n\n仅输出 JSON：{"classifications":[{"sourceId":"candidate-1","relevance":"high|medium|low","reason":"简短原因"}]}`,
        },
      ],
      maxCompletionTokens: 2400,
      temperature: 0.1,
    })
    const parsed = parseGeneratedJson(result.content)
    const values = Array.isArray(parsed.classifications) ? parsed.classifications : []
    const allowedIds = new Set(candidates.map((candidate) => candidate.candidateId))
    const classifications = new Map<string, Exclude<SourceRelevance, 'uncertain'>>()
    values.forEach((value) => {
      if (!isRecord(value)) return
      const sourceId = asString(value.sourceId)
      const relevance = asString(value.relevance)
      if (
        allowedIds.has(sourceId)
        && (relevance === 'high' || relevance === 'medium' || relevance === 'low')
      ) classifications.set(sourceId, relevance)
    })
    return classifications
  } catch (error) {
    console.warn('[research:relevance] classification failed', {
      candidateCount: candidates.length,
      errorCode: error instanceof ResearchServiceError ? error.code : 'INTERNAL_ERROR',
    })
    return new Map<string, Exclude<SourceRelevance, 'uncertain'>>()
  }
}

function sourcePreferenceScore(category: ResearchAgentSourceType, preferences: string[]) {
  const joined = preferences.join(' ')
  if (category === 'official' && /权威|官方/.test(joined)) return 1
  if (category === 'academic' && /报告|研究|学术/.test(joined)) return 1
  if (category === 'company' && /企业|案例/.test(joined)) return 1
  if ((category === 'news' || category === 'professional') && /媒体|行业/.test(joined)) return 1
  if (category === 'community' && /用户/.test(joined)) return 1
  return 0
}

function selectDiverseCandidates(
  candidates: GlmSearchCandidate[],
  sourcePreferences: string[],
  limit: number,
) {
  const sorted = candidates.slice().sort((left, right) => (
    Number(right.relevance === 'high') - Number(left.relevance === 'high')
    || sourcePreferenceScore(right.sourceCategory, sourcePreferences)
      - sourcePreferenceScore(left.sourceCategory, sourcePreferences)
    || right.matchedQueryIds.length - left.matchedQueryIds.length
  ))
  const selected: GlmSearchCandidate[] = []
  const selectedIds = new Set<string>()
  const categories = [...new Set(sorted.map((source) => source.sourceCategory))]
  categories.forEach((category) => {
    const source = sorted.find((candidate) => candidate.sourceCategory === category)
    if (source && selected.length < limit) {
      selected.push(source)
      selectedIds.add(source.candidateId)
    }
  })
  sorted.forEach((source) => {
    if (selected.length < limit && !selectedIds.has(source.candidateId)) {
      selected.push(source)
      selectedIds.add(source.candidateId)
    }
  })
  return selected
}

async function executeSearchQuery(query: SearchQuery): Promise<SearchQueryResult> {
  const startedAt = Date.now()
  console.info('[research:glm-search] started', { queryId: query.id })
  try {
    const response = await requestGlmJson('/web_search', {
      search_query: query.query,
      search_engine: 'search_std',
      search_intent: false,
      count: SEARCH_RESULTS_PER_QUERY,
      search_recency_filter: 'noLimit',
      content_size: 'high',
    })
    if (!response.ok) throw createGlmSearchHttpError(response.httpStatus)
    const rawMapped = mapGlmSearchResults(response.payload)
    if (!rawMapped) {
      throw new ResearchServiceError(
        'RESEARCH_SEARCH_FAILED',
        502,
        'GLM Web Search 返回格式异常。',
      )
    }
    const mapped = {
      ...rawMapped,
      deduplicatedMetadata: rawMapped.deduplicatedMetadata.slice(
        0,
        SEARCH_RESULTS_PER_QUERY,
      ),
    }
    console.info('[research:glm-search] completed', {
      queryId: query.id,
      resultCount: mapped.actualSourceCount,
      validSourceCount: mapped.validSourceCount,
      durationMs: Date.now() - startedAt,
    })
    return { query, mapped, error: null }
  } catch (error) {
    console.warn('[research:glm-search] query failed', {
      queryId: query.id,
      errorCode: error instanceof ResearchServiceError ? error.code : 'INTERNAL_ERROR',
      durationMs: Date.now() - startedAt,
    })
    return { query, mapped: null, error }
  }
}

async function executeSearchQueries(queries: SearchQuery[], concurrency: number) {
  const results: SearchQueryResult[] = new Array(queries.length)
  let nextIndex = 0
  async function worker() {
    while (nextIndex < queries.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await executeSearchQuery(queries[index]!)
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(concurrency, queries.length) },
    () => worker(),
  ))
  return results
}

export async function searchResearchSourcesWithGlm(
  request: ResearchRequest,
  strategy: ResearchStrategy = resolveResearchStrategy(request),
  queriesOverride?: SearchQuery[],
): Promise<GlmSearchResult> {
  const startedAt = Date.now()
  const queries = (queriesOverride ?? strategy.queryPlan.queries).slice(0, 4)
  const concurrency = Math.min(
    MAX_SEARCH_QUERY_CONCURRENCY,
    getPositiveInteger('GLM_SEARCH_QUERY_CONCURRENCY', DEFAULT_SEARCH_QUERY_CONCURRENCY),
  )
  const results = await executeSearchQueries(queries, concurrency)
  const successful = results.filter((result) => !result.error && result.mapped)
  const failedCount = results.length - successful.length
  if (successful.length === 0) {
    throw new ResearchServiceError(
      'RESEARCH_SEARCH_FAILED',
      502,
      '全部联网检索请求均失败，请稍后手动重试当前研究步骤。',
    )
  }

  const actualSourceCount = successful.reduce(
    (sum, result) => sum + result.mapped!.actualSourceCount,
    0,
  )
  const validUrlCount = successful.reduce(
    (sum, result) => sum + result.mapped!.validSourceCount,
    0,
  )
  const unique = new Map<string, Omit<GlmSearchCandidate, 'candidateId' | 'relevance'>>()
  successful.forEach(({ query, mapped }) => {
    mapped!.deduplicatedMetadata.forEach((source) => {
      const existing = unique.get(source.url)
      if (existing) {
        existing.matchedQueryIds = [...new Set([...existing.matchedQueryIds, query.id])]
        return
      }
      unique.set(source.url, {
        ...source,
        matchedQueryIds: [query.id],
        sourceCategory: classifySourceCategory(source),
      })
    })
  })
  if (unique.size === 0) {
    throw new ResearchServiceError(
      'NO_REAL_SOURCES',
      502,
      'GLM Web Search 未返回可验证的真实来源。',
    )
  }

  const candidates = [...unique.values()].map<GlmSearchCandidate>((source, index) => ({
    ...source,
    candidateId: `candidate-${index + 1}`,
    relevance: relevanceByRule(source, strategy.intent),
  }))
  const uncertain = candidates.filter((source) => source.relevance === 'uncertain')
  const semanticClassifications = await classifyUncertainCandidatesWithFlash(
    uncertain,
    strategy.intent,
  )
  uncertain.forEach((source) => {
    source.relevance = semanticClassifications.get(source.candidateId) ?? 'low'
  })
  const accepted = candidates.filter(
    (source) => source.relevance === 'high' || source.relevance === 'medium',
  )
  const rejectedCount = candidates.length - accepted.length
  if (accepted.length === 0) {
    throw new ResearchServiceError(
      'NO_RELEVANT_SOURCES',
      502,
      '联网检索返回了真实网页，但没有与当前研究对象足够相关的来源。',
    )
  }
  const maxCandidates = Math.min(
    MAX_SEARCH_CANDIDATES,
    Math.max(12, request.targetSourceCount),
  )
  const metadata = selectDiverseCandidates(
    accepted,
    request.sourcePreferences,
    maxCandidates,
  )
  console.info('[research:multi-search] completed', {
    queryCount: queries.length,
    rawResultCount: actualSourceCount,
    validUrlCount,
    deduplicatedCount: unique.size,
    relevanceAcceptedCount: accepted.length,
    relevanceRejectedCount: rejectedCount,
    durationMs: Date.now() - startedAt,
  })
  return {
    actualSourceCount,
    deduplicatedSourceCount: unique.size,
    metadata,
    warnings: failedCount > 0
      ? [`${failedCount} 个检索方向暂时失败，已使用其余成功检索结果继续研究。`]
      : [],
  }
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
): Promise<GlmReaderBatchResult> {
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
  strategy: ResearchStrategy = resolveResearchStrategy(request),
  hooks: GlmResearchProgressHooks = {},
): Promise<GlmResearchRetrievalResult> {
  const search = await searchResearchSourcesWithGlm(request, strategy)
  await hooks.onSearchCompleted?.(search.metadata.length)
  await hooks.onReaderStarted?.(Math.min(MAX_READER_SOURCES, search.metadata.length))
  const reader = await enrichResearchSourcesWithGlm(search.metadata, {
    onReaderCompleted: hooks.onReaderCompleted,
  })
  return {
    ...search,
    evidenceSources: reader.evidenceSources,
    warnings: [...search.warnings, ...reader.warnings],
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
  searchResultsPerQuery: SEARCH_RESULTS_PER_QUERY,
  maxSearchQueryConcurrency: MAX_SEARCH_QUERY_CONCURRENCY,
  relevanceByRule,
  classifySourceCategory,
}

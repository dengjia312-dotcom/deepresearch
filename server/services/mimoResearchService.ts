import { createHash } from 'node:crypto'
import type {
  MimoChatCompletionResponse,
  ResearchErrorCode,
  ResearchInsight,
  ResearchRequest,
  ResearchResponse,
  ResearchSource,
  ResearchSynthesisEvidence,
  VerifiedSearchMetadata,
} from '../types/research'
import {
  getAiConcurrencyRetryAfterSeconds,
  tryAcquireGlobalAiSlot,
} from './aiConcurrency'

const DEFAULT_BASE_URL = 'https://api.xiaomimimo.com/v1'
const DEFAULT_MODEL = 'mimo-v2.5'
const DEFAULT_REQUEST_TIMEOUT_MS = 45_000
const DEFAULT_RESEARCH_REQUEST_TIMEOUT_MS = 120_000
const SOURCE_SUMMARY_MAX_LENGTH = 600

interface MimoRequestOptions {
  timeoutMs?: number
  operation?: 'research'
}

interface MimoConfiguration {
  apiKey: string
  baseUrl: string
  model: string
  configured: boolean
}

interface ModelInsight {
  title: string
  content: string
  sourceUrls: string[]
}

interface ModelResearchPayload {
  summary: string
  insights: ModelInsight[]
  warnings: string[]
}

function getPositiveIntegerEnvironmentValue(
  primaryName: string,
  legacyName: string,
  fallback: number,
) {
  const configured = Number(
    process.env[primaryName]?.trim()
    || process.env[legacyName]?.trim(),
  )
  return Number.isInteger(configured) && configured > 0
    ? configured
    : fallback
}

function getDefaultRequestTimeoutMs() {
  return getPositiveIntegerEnvironmentValue(
    'AI_DEFAULT_TIMEOUT_MS',
    'MIMO_DEFAULT_TIMEOUT_MS',
    DEFAULT_REQUEST_TIMEOUT_MS,
  )
}

function getResearchRequestTimeoutMs() {
  return getPositiveIntegerEnvironmentValue(
    'AI_RESEARCH_TIMEOUT_MS',
    'MIMO_RESEARCH_TIMEOUT_MS',
    DEFAULT_RESEARCH_REQUEST_TIMEOUT_MS,
  )
}

export class MimoServiceError extends Error {
  constructor(
    public readonly code: ResearchErrorCode,
    public readonly statusCode: number,
    public readonly publicMessage: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(publicMessage)
    this.name = 'MimoServiceError'
  }
}

export function getMimoConfiguration(): MimoConfiguration {
  const apiKey = process.env.AI_API_KEY?.trim()
    || process.env.MIMO_API_KEY?.trim()
    || ''
  const baseUrl = (
    process.env.AI_BASE_URL?.trim()
    || process.env.MIMO_BASE_URL?.trim()
    || DEFAULT_BASE_URL
  ).replace(/\/$/, '')
  const model = process.env.AI_MODEL?.trim()
    || process.env.MIMO_MODEL?.trim()
    || DEFAULT_MODEL
  return { apiKey, baseUrl, model, configured: Boolean(apiKey) }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function asString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeUrl(value: string) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

function firstString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = asString(record[key])
    if (value) return value
  }
  return ''
}

function toVerifiedSearchMetadata(record: Record<string, unknown>) {
  const rawUrl = firstString(record, ['url', 'page_url', 'link'])
  const url = rawUrl ? normalizeUrl(rawUrl) : null
  if (!url) return null

  const parsedUrl = new URL(url)
  const title = firstString(record, ['title', 'name', 'page_title'])
  const publisher = firstString(record, ['site_name', 'publisher', 'source_name'])
  const snippet = firstString(record, ['snippet', 'summary', 'description', 'text', 'content'])
  const publishedAt = firstString(record, ['publish_time', 'published_at', 'publishedAt', 'date'])
  if (!title && !publisher && !snippet) return null

  return {
    url,
    title: title || parsedUrl.hostname,
    publisher: publisher || parsedUrl.hostname,
    publishedAt,
    snippet,
  } satisfies VerifiedSearchMetadata
}

function getFirstMessage(payload: unknown) {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) return null
  const firstChoice = payload.choices[0]
  if (!isRecord(firstChoice) || !isRecord(firstChoice.message)) return null
  return firstChoice.message
}

function extractOfficialUrlCitations(payload: unknown) {
  const message = getFirstMessage(payload)
  if (!message || !Array.isArray(message.annotations)) return []

  return message.annotations.flatMap<VerifiedSearchMetadata>((annotation) => {
    if (!isRecord(annotation) || asString(annotation.type) !== 'url_citation') return []
    const metadata = toVerifiedSearchMetadata(annotation)
    return metadata ? [metadata] : []
  })
}

function extractSearchMetadataRecursively(payload: unknown) {
  const candidates: VerifiedSearchMetadata[] = []
  const visited = new Set<unknown>()

  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object' || visited.has(value)) return
    visited.add(value)

    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }

    const record = value as Record<string, unknown>
    const metadata = toVerifiedSearchMetadata(record)
    if (metadata) candidates.push(metadata)

    Object.entries(record).forEach(([key, child]) => {
      if (key === 'content' && typeof child === 'string') return
      if (/logo|icon|avatar/i.test(key)) return
      visit(child)
    })
  }

  visit(payload)
  return candidates
}

export function extractVerifiedSearchMetadata(payload: unknown) {
  const officialCitations = extractOfficialUrlCitations(payload)
  const candidates = officialCitations.length > 0
    ? officialCitations
    : extractSearchMetadataRecursively(payload)

  const unique = new Map<string, VerifiedSearchMetadata>()
  candidates.forEach((candidate) => {
    const key = normalizeUrl(candidate.url)
    if (key && !unique.has(key)) unique.set(key, candidate)
  })
  return {
    actualSourceCount: candidates.length,
    deduplicatedMetadata: [...unique.values()],
  }
}

function summarizeResearchResponseShape(payload: Record<string, unknown>) {
  const hasChoices = Array.isArray(payload.choices)
  const message = getFirstMessage(payload)
  const annotations = message && Array.isArray(message.annotations)
    ? message.annotations
    : []
  const annotationTypes = [...new Set(annotations.flatMap((annotation) => {
    if (!isRecord(annotation)) return []
    const type = asString(annotation.type)
    return type ? [type] : []
  }))]
  const annotationFields = annotations.map((annotation) => {
    const record = isRecord(annotation) ? annotation : {}
    return {
      type: asString(record.type) || null,
      hasUrl: Boolean(asString(record.url)),
      hasTitle: Boolean(asString(record.title)),
      hasSummary: Boolean(asString(record.summary)),
      hasSiteName: Boolean(asString(record.site_name)),
      hasPublishTime: Boolean(asString(record.publish_time)),
    }
  })
  const toolCalls = message?.tool_calls
  const usage = isRecord(payload.usage) ? payload.usage : null
  const webSearchUsage = usage && isRecord(usage.web_search_usage)
    ? usage.web_search_usage
    : null

  return {
    hasChoices,
    hasMessage: Boolean(message),
    hasAnnotations: Boolean(message && Array.isArray(message.annotations)),
    annotationCount: annotations.length,
    annotationTypes,
    annotationFields,
    hasToolCalls: Array.isArray(toolCalls) ? toolCalls.length > 0 : Boolean(toolCalls),
    usageWebSearch: webSearchUsage
      ? {
          toolUsage: typeof webSearchUsage.tool_usage === 'number'
            ? webSearchUsage.tool_usage
            : null,
          pageUsage: typeof webSearchUsage.page_usage === 'number'
            ? webSearchUsage.page_usage
            : null,
        }
      : null,
    topLevelKeys: Object.keys(payload).sort(),
  }
}

function summarizeResearchRequestShape(
  model: string,
  body: Record<string, unknown>,
  bodyFingerprint: string,
) {
  const tools = Array.isArray(body.tools) ? body.tools : []
  const toolRecords = tools.filter(isRecord)
  const webSearchTool = toolRecords.find((tool) => asString(tool.type) === 'web_search')
  const thinking = isRecord(body.thinking) ? body.thinking : null

  return {
    model,
    hasTools: tools.length > 0,
    toolTypes: toolRecords.map((tool) => asString(tool.type)).filter(Boolean),
    forceSearch: webSearchTool?.force_search === true,
    toolChoice: asString(body.tool_choice) || null,
    stream: typeof body.stream === 'boolean' ? body.stream : null,
    thinkingType: thinking ? asString(thinking.type) || null : null,
    bodyFingerprint,
  }
}

export function parseJsonObject(content: string): unknown {
  const withoutFence = content
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()
  const firstBrace = withoutFence.indexOf('{')
  const lastBrace = withoutFence.lastIndexOf('}')
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    throw new MimoServiceError(
      'MIMO_RESPONSE_INVALID',
      502,
      'MiMo 返回了无法解析的研究结果。',
    )
  }

  try {
    return JSON.parse(withoutFence.slice(firstBrace, lastBrace + 1)) as unknown
  } catch {
    throw new MimoServiceError(
      'MIMO_RESPONSE_INVALID',
      502,
      'MiMo 返回了格式异常的研究结果。',
    )
  }
}

function parseModelResearchPayload(content: string): ModelResearchPayload {
  const parsed = parseJsonObject(content)
  if (!isRecord(parsed)) {
    throw new MimoServiceError('MIMO_RESPONSE_INVALID', 502, 'MiMo 返回的研究结果结构无效。')
  }

  const summary = asString(parsed.summary)
  const rawInsights = Array.isArray(parsed.insights) ? parsed.insights : []
  const insights = rawInsights.flatMap<ModelInsight>((item) => {
    if (!isRecord(item)) return []
    const title = asString(item.title)
    const insightContent = asString(item.content)
    const sourceUrls = Array.isArray(item.sourceUrls)
      ? item.sourceUrls.map(asString).filter(Boolean)
      : []
    return title && insightContent ? [{ title, content: insightContent, sourceUrls }] : []
  })
  const warnings = Array.isArray(parsed.warnings)
    ? parsed.warnings.map(asString).filter(Boolean)
    : []

  if (!summary || insights.length === 0) {
    throw new MimoServiceError('MIMO_RESPONSE_INVALID', 502, 'MiMo 返回的研究摘要或洞察不完整。')
  }
  return { summary, insights, warnings }
}

function classifySource(metadata: VerifiedSearchMetadata) {
  const host = new URL(metadata.url).hostname.toLowerCase()
  const publisher = metadata.publisher.toLowerCase()
  if (host.endsWith('.gov.cn') || host.includes('.gov.')) return '官方网站'
  if (host.endsWith('.edu.cn') || host.includes('arxiv.org') || publisher.includes('大学')) {
    return '学术论文'
  }
  if (/研究|研究院|报告|协会|机构/.test(metadata.publisher)) return '研究报告'
  return '行业媒体'
}

function buildResearchSources(metadata: VerifiedSearchMetadata[]): ResearchSource[] {
  return metadata.map((item, index) => {
    const fallback = '该来源由联网检索返回，请打开原文核验详细内容。'
    const summary = (item.snippet || fallback).slice(0, SOURCE_SUMMARY_MAX_LENGTH)
    return {
      id: `source-${index + 1}`,
      title: item.title,
      url: item.url,
      publisher: item.publisher,
      publishedAt: item.publishedAt,
      type: classifySource(item),
      credibility: '待评估',
      summary,
      keyInsight: summary,
    }
  })
}

function buildResearchInsights(
  modelInsights: ModelInsight[],
  sources: ResearchSource[],
): { insights: ResearchInsight[]; hasUnlinkedInsight: boolean } {
  const sourceIdByUrl = new Map(
    sources.flatMap((source) => {
      const url = normalizeUrl(source.url)
      return url ? [[url, source.id] as const] : []
    }),
  )
  let hasUnlinkedInsight = false

  const insights = modelInsights.map((insight, index) => {
    const sourceIds = [...new Set(insight.sourceUrls.flatMap((rawUrl) => {
      const url = normalizeUrl(rawUrl)
      const sourceId = url ? sourceIdByUrl.get(url) : undefined
      return sourceId ? [sourceId] : []
    }))]
    if (sourceIds.length === 0) hasUnlinkedInsight = true
    return {
      id: `insight-${index + 1}`,
      title: insight.title,
      content: insight.content,
      sourceIds,
    }
  })

  return { insights, hasUnlinkedInsight }
}

export async function requestMimo(
  body: Record<string, unknown>,
  options: MimoRequestOptions = {},
): Promise<MimoChatCompletionResponse> {
  const config = getMimoConfiguration()
  if (!config.configured) {
    throw new MimoServiceError('MIMO_NOT_CONFIGURED', 503, 'MiMo API 尚未配置。')
  }

  const releaseAiSlot = tryAcquireGlobalAiSlot()
  if (!releaseAiSlot) {
    throw new MimoServiceError(
      'API_CONCURRENCY_LIMITED',
      503,
      '当前 AI 服务请求较多，请稍后手动重试。',
      getAiConcurrencyRetryAfterSeconds(),
    )
  }

  const startedAt = Date.now()
  const timeoutMs = options.timeoutMs ?? getDefaultRequestTimeoutMs()
  const serializedBody = JSON.stringify({ model: config.model, ...body })
  const bodyFingerprint = createHash('sha256')
    .update(serializedBody)
    .digest('hex')
    .slice(0, 12)
  let upstreamHttpStatus: number | null = null
  if (options.operation === 'research') {
    console.info('[mimo:research] request started', {
      startedAt: new Date(startedAt).toISOString(),
      timeoutMs,
    })
    console.info(
      '[mimo:research] request shape',
      summarizeResearchRequestShape(config.model, body, bodyFingerprint),
    )
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': config.apiKey,
      },
      body: serializedBody,
      signal: controller.signal,
    })
    upstreamHttpStatus = response.status

    if (!response.ok) {
      if (response.status === 401) {
        throw new MimoServiceError('MIMO_AUTH_FAILED', 502, 'MiMo API 鉴权失败。')
      }
      if (response.status === 429) {
        throw new MimoServiceError(
          'MIMO_RATE_LIMITED',
          503,
          'MiMo API 请求过于频繁或套餐额度已耗尽，请稍后重试或检查额度。',
        )
      }
      if (response.status === 402) {
        throw new MimoServiceError('MIMO_QUOTA_EXCEEDED', 503, 'MiMo API 账户余额不足。')
      }
      if (response.status === 403) {
        throw new MimoServiceError(
          'MIMO_ACCESS_DENIED',
          502,
          'MiMo API 拒绝访问，请检查地区、风控状态或服务开通情况。',
        )
      }
      throw new MimoServiceError('MIMO_UPSTREAM_ERROR', 502, `MiMo API 请求失败（${response.status}）。`)
    }

    const payload = await response.json() as unknown
    if (!isRecord(payload)) {
      throw new MimoServiceError('MIMO_RESPONSE_INVALID', 502, 'MiMo API 返回格式异常。')
    }
    if (options.operation === 'research') {
      console.info('[mimo:research] request succeeded', {
        durationMs: Date.now() - startedAt,
        upstreamHttpStatus,
      })
      console.info('[mimo:research] response shape', summarizeResearchResponseShape(payload))
    }
    return payload as MimoChatCompletionResponse
  } catch (error) {
    if (options.operation === 'research') {
      const responseStatus = error instanceof MimoServiceError
        ? error.statusCode
        : error instanceof Error && error.name === 'AbortError'
          ? 504
          : 502
      console.error('[mimo:research] request failed', {
        durationMs: Date.now() - startedAt,
        upstreamHttpStatus,
        responseStatus,
      })
    }
    if (error instanceof MimoServiceError) throw error
    if (error instanceof Error && error.name === 'AbortError') {
      throw new MimoServiceError('MIMO_TIMEOUT', 504, 'MiMo API 请求超时。')
    }
    throw new MimoServiceError('MIMO_NETWORK_ERROR', 502, '无法连接 MiMo API。')
  } finally {
    clearTimeout(timeout)
    releaseAiSlot()
  }
}

export function getAssistantContent(payload: MimoChatCompletionResponse) {
  const content = payload.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) {
    throw new MimoServiceError('MIMO_RESPONSE_INVALID', 502, 'MiMo API 未返回有效内容。')
  }
  return content.trim()
}

export async function testMimoConnection() {
  const payload = await requestMimo({
    messages: [
      { role: 'system', content: '请严格按照用户要求，用最短文本回答。' },
      { role: 'user', content: '这是连通性测试，请只回复 OK。' },
    ],
    max_completion_tokens: 16,
    temperature: 0,
    stream: false,
    thinking: { type: 'disabled' },
  })
  return { model: payload.model ?? getMimoConfiguration().model, content: getAssistantContent(payload) }
}

export function buildMimoResearchRequestBody(request: ResearchRequest) {
  const prompt = `请围绕“${request.topic}”执行真实互联网检索。\n研究目标：${request.goal}\n来源偏好：${request.sourcePreferences.join('、') || '官方网站、研究报告、学术论文、行业媒体'}\n目标来源数量：${request.targetSourceCount} 条\n\n请优先查找与主题直接相关的可靠来源。只需简洁确认检索完成，不要生成复杂 JSON，不要自行构造或列出 URL；真实来源仅以 Web Search 返回的 annotations 为准。`

  return {
    messages: [
      {
        role: 'system',
        content: '你是严谨的中文研究检索助手。请执行真实联网搜索，不得编造来源。',
      },
      { role: 'user', content: prompt },
    ],
    tools: [
      {
        type: 'web_search',
        max_keyword: Math.min(8, Math.max(4, Math.ceil(request.targetSourceCount / 4))),
        force_search: true,
        limit: request.targetSourceCount,
      },
    ],
    tool_choice: 'auto',
    max_completion_tokens: 1024,
    temperature: 1.0,
    stream: false,
    thinking: { type: 'disabled' },
  }
}

interface ResearchSearchResult {
  actualSourceCount: number
  deduplicatedMetadata: VerifiedSearchMetadata[]
}

function getAnnotationCount(payload: unknown) {
  const message = getFirstMessage(payload)
  return message && Array.isArray(message.annotations) ? message.annotations.length : 0
}

export async function searchResearchSourcesWithMimo(
  request: ResearchRequest,
): Promise<ResearchSearchResult> {
  const maxAttempts = 2
  const searchStartedAt = Date.now()
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const startedAt = Date.now()
    console.info('[research:search] started', { attempt })
    try {
      const payload = await requestMimo(
        buildMimoResearchRequestBody(request),
        { timeoutMs: getResearchRequestTimeoutMs(), operation: 'research' },
      )
      if (!getFirstMessage(payload)) {
        throw new MimoServiceError('MIMO_RESPONSE_INVALID', 502, 'MiMo API 返回格式异常。')
      }

      const annotationCount = getAnnotationCount(payload)
      const {
        actualSourceCount,
        deduplicatedMetadata,
      } = extractVerifiedSearchMetadata(payload)
      console.info('[research:search] completed', {
        attempt,
        annotationCount,
        actualSourceCount,
        deduplicatedSourceCount: deduplicatedMetadata.length,
        durationMs: Date.now() - startedAt,
      })

      if (deduplicatedMetadata.length > 0) {
        return { actualSourceCount, deduplicatedMetadata }
      }
    } catch (error) {
      console.error('[research:search] failed', {
        attempt,
        errorCode: error instanceof MimoServiceError ? error.code : 'INTERNAL_ERROR',
        durationMs: Date.now() - startedAt,
      })
      throw error
    }
    if (attempt < maxAttempts) {
      console.warn('[research:search] empty result, retrying', { attempt })
    }
  }

  console.error('[research:search] failed', {
    attempts: 2,
    errorCode: 'NO_REAL_SOURCES',
    durationMs: Date.now() - searchStartedAt,
  })
  throw new MimoServiceError('NO_REAL_SOURCES', 502, 'MiMo 未返回可验证的真实联网来源。')
}

export function buildMimoResearchSynthesisRequestBody(
  request: ResearchRequest,
  evidenceSources: ResearchSynthesisEvidence[],
) {
  const sources = evidenceSources.map((source) => ({
    sourceId: source.sourceId,
    title: source.title,
    publisher: source.publisher,
    publishedAt: source.publishedAt,
    url: source.url,
    evidenceType: source.evidenceType,
    content: source.content,
  }))
  const prompt = `请基于以下已经验证的真实来源证据，完成“${request.topic}”的中文研究综合。\n研究目标：${request.goal}\n\n只能使用给定来源，不得联网，不得新增、猜测或改写 URL。每条洞察的 sourceUrls 只能从给定来源的 url 中选择。evidenceType 表示证据来自完整正文、部分正文或搜索摘要。\n\n已验证来源证据：\n${JSON.stringify(sources)}\n\n仅输出 JSON，不要 Markdown，结构为：\n{"summary":"研究摘要","insights":[{"title":"洞察标题","content":"洞察正文","sourceUrls":["给定来源中的URL"]}],"warnings":[]}`

  return {
    messages: [
      {
        role: 'system',
        content: '你是严谨的中文行业研究员。只能使用用户提供的已验证来源，不得新增或猜测 URL。',
      },
      { role: 'user', content: prompt },
    ],
    max_completion_tokens: 4096,
    temperature: 0.2,
    stream: false,
    thinking: { type: 'disabled' },
  }
}

export async function synthesizeResearchWithMimo(
  request: ResearchRequest,
  evidenceSources: ResearchSynthesisEvidence[],
) {
  const startedAt = Date.now()
  console.info('[research:synthesis] started')
  try {
    const payload = await requestMimo(
      buildMimoResearchSynthesisRequestBody(request, evidenceSources),
      { timeoutMs: getResearchRequestTimeoutMs() },
    )
    const result = parseModelResearchPayload(getAssistantContent(payload))
    console.info('[research:synthesis] completed', {
      insightCount: result.insights.length,
      durationMs: Date.now() - startedAt,
    })
    return result
  } catch (error) {
    console.error('[research:synthesis] failed', {
      errorCode: error instanceof MimoServiceError ? error.code : 'INTERNAL_ERROR',
      durationMs: Date.now() - startedAt,
    })
    throw error
  }
}

export async function synthesizeResearchResponseWithMimo(
  request: ResearchRequest,
  metadata: VerifiedSearchMetadata[],
  evidenceSources: ResearchSynthesisEvidence[],
  counts: { actualSourceCount: number; deduplicatedSourceCount: number },
  retrievalWarnings: string[] = [],
): Promise<ResearchResponse> {
  const modelResult = await synthesizeResearchWithMimo(request, evidenceSources)
  const sources = buildResearchSources(metadata)
  const { insights, hasUnlinkedInsight } = buildResearchInsights(modelResult.insights, sources)
  const warnings = [...retrievalWarnings, ...modelResult.warnings]
  if (hasUnlinkedInsight) {
    warnings.push('部分洞察未能与已验证的联网来源建立可靠关联，请打开来源复核。')
  }
  if (sources.length < request.targetSourceCount) {
    warnings.push(
      `目标检索 ${request.targetSourceCount} 条，去重并校验链接后获得 ${sources.length} 条有效来源；实际数量可能受搜索覆盖、URL 去重和链接有效性影响。`,
    )
  }

  return {
    taskId: request.taskId,
    requestId: request.requestId,
    mode: 'live',
    dataSource: 'real',
    topic: request.topic,
    summary: modelResult.summary,
    insights,
    sources,
    warnings: [...new Set(warnings)],
    targetSourceCount: request.targetSourceCount,
    actualSourceCount: counts.actualSourceCount,
    deduplicatedSourceCount: counts.deduplicatedSourceCount,
    validSourceCount: sources.length,
    searchedAt: new Date().toISOString(),
  }
}

export async function researchWithMimo(request: ResearchRequest): Promise<ResearchResponse> {
  const {
    actualSourceCount,
    deduplicatedMetadata,
  } = await searchResearchSourcesWithMimo(request)
  const selectedMetadata = deduplicatedMetadata.slice(0, request.targetSourceCount)
  const evidenceSources = selectedMetadata.map<ResearchSynthesisEvidence>((source, index) => ({
    ...source,
    sourceId: `source-${index + 1}`,
    evidenceType: 'search_summary',
    content: source.snippet.slice(0, 6000),
  }))
  return synthesizeResearchResponseWithMimo(
    request,
    selectedMetadata,
    evidenceSources,
    {
      actualSourceCount,
      deduplicatedSourceCount: deduplicatedMetadata.length,
    },
  )
}

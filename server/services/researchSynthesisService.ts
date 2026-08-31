import type {
  ResearchInsight,
  ResearchRequest,
  ResearchResponse,
  ResearchSource,
  ResearchSynthesisEvidence,
  VerifiedSearchMetadata,
} from '../types/research'
import { generateContent, parseGeneratedJson } from './generation/generationService'
import { ResearchServiceError } from './serviceError'
import { asString, isRecord } from './serviceUtils'

const SOURCE_SUMMARY_MAX_LENGTH = 600

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

export interface ResearchSynthesisHooks {
  onSynthesisParsed?: () => Promise<void> | void
  onResponseBuilt?: () => Promise<void> | void
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

function parseModelResearchPayload(content: string): ModelResearchPayload {
  let parsed: Record<string, unknown>
  try {
    parsed = parseGeneratedJson(content)
  } catch (error) {
    console.error('[research:synthesis] validation', {
      jsonParseSuccess: false,
      schemaValidationSuccess: false,
      validationIssueNames: ['json_parse'],
    })
    throw error
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

  const validationIssueNames = [
    ...(!summary ? ['summary_missing'] : []),
    ...(insights.length === 0 ? ['insights_missing'] : []),
  ]
  if (validationIssueNames.length > 0) {
    console.error('[research:synthesis] validation', {
      jsonParseSuccess: true,
      schemaValidationSuccess: false,
      validationIssueNames,
    })
    throw new ResearchServiceError(
      'AI_GENERATION_RESPONSE_INVALID',
      502,
      'AI 返回的研究摘要或洞察不完整，请重新生成。',
      undefined,
      'QWEN_SYNTHESIS_INVALID',
    )
  }
  console.info('[research:synthesis] validation', {
    jsonParseSuccess: true,
    schemaValidationSuccess: true,
    summaryPresent: true,
    insightCount: insights.length,
    warningCount: warnings.length,
  })
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

function buildResearchInsights(modelInsights: ModelInsight[], sources: ResearchSource[]) {
  const sourceIdByUrl = new Map(
    sources.flatMap((source) => {
      const url = normalizeUrl(source.url)
      return url ? [[url, source.id] as const] : []
    }),
  )
  let hasUnlinkedInsight = false
  const insights = modelInsights.map<ResearchInsight>((insight, index) => {
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

export function buildResearchSynthesisPrompt(
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
  return `请基于以下已经验证的真实来源证据，完成“${request.topic}”的中文研究综合。
研究目标：${request.goal}

只能使用给定来源，不得联网，不得新增、猜测或改写 URL。每条洞察的 sourceUrls 只能从给定来源的 url 中选择。evidenceType 表示证据来自完整正文、部分正文或搜索摘要。

已验证来源证据：
${JSON.stringify(sources)}

仅输出 JSON，不要 Markdown，结构为：
{"summary":"研究摘要","insights":[{"title":"洞察标题","content":"洞察正文","sourceUrls":["给定来源中的URL"]}],"warnings":[]}`
}

export async function synthesizeResearch(
  request: ResearchRequest,
  evidenceSources: ResearchSynthesisEvidence[],
) {
  const result = await generateContent('synthesis', {
    messages: [
      {
        role: 'system',
        content: '你是严谨的中文行业研究员。只能使用用户提供的已验证来源，不得联网，不得新增或猜测 URL。',
      },
      { role: 'user', content: buildResearchSynthesisPrompt(request, evidenceSources) },
    ],
    maxCompletionTokens: 4096,
    temperature: 0.2,
  })
  console.info('[research:synthesis] content', {
    contentLength: result.content.length,
    finishReason: result.finishReason,
    startsWithBrace: result.content.startsWith('{'),
    endsWithBrace: result.content.endsWith('}'),
  })
  return parseModelResearchPayload(result.content)
}

export async function synthesizeResearchResponse(
  request: ResearchRequest,
  metadata: VerifiedSearchMetadata[],
  evidenceSources: ResearchSynthesisEvidence[],
  counts: { actualSourceCount: number; deduplicatedSourceCount: number },
  retrievalWarnings: string[] = [],
  hooks: ResearchSynthesisHooks = {},
): Promise<ResearchResponse> {
  const modelResult = await synthesizeResearch(request, evidenceSources)
  await hooks.onSynthesisParsed?.()
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

  const response: ResearchResponse = {
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
  await hooks.onResponseBuilt?.()
  return response
}

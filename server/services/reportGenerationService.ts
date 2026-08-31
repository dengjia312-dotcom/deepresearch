import {
  generateContent,
  parseGeneratedJson,
} from './generation/generationService'
import { ResearchServiceError } from './serviceError'
import { asString, isRecord } from './serviceUtils'
import type {
  ClaimType,
  ReportRequest,
  ReportResponse,
} from '../types/research'

const claimTypes = new Set<ClaimType>([
  'source_supported',
  'synthesis',
  'uncertain',
])

type LengthAdjustment = 'expand' | 'compress' | null
type ReportContent = ReportResponse['report']
type ReportSection = ReportContent['sections'][number]

export function countChineseWords(text: string) {
  const chineseCharacters = text.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g)?.length ?? 0
  const nonChineseWords = text
    .replace(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g, ' ')
    .match(/[A-Za-z0-9]+(?:[._/-][A-Za-z0-9]+)*/g)?.length ?? 0
  return chineseCharacters + nonChineseWords
}

function countReportWords(report: ReportContent) {
  return countChineseWords([
    report.executiveSummary,
    ...report.sections.flatMap((section) =>
      section.paragraphs.map((paragraph) => paragraph.content)),
    report.conclusion,
    ...report.limitations,
  ].join('\n'))
}

function parseWarnings(value: unknown) {
  return Array.isArray(value)
    ? value.map(asString).filter(Boolean).slice(0, 20).map((item) => item.slice(0, 300))
    : []
}

function normalizedParagraph(content: string) {
  return content
    .normalize('NFKC')
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .toLocaleLowerCase()
}

function parseParagraphs(
  value: unknown,
  sectionId: string,
  allowedSourceIds: Set<string>,
) {
  const rawParagraphs = Array.isArray(value) ? value : []
  if (rawParagraphs.length < 1 || rawParagraphs.length > 12) {
    throw new ResearchServiceError('AI_GENERATION_RESPONSE_INVALID', 502, 'AI 返回了空章节或段落数量异常。')
  }
  return rawParagraphs.map((paragraph, index) => {
    if (!isRecord(paragraph)) {
      throw new ResearchServiceError('AI_GENERATION_RESPONSE_INVALID', 502, 'AI 返回了无效报告段落。')
    }
    const content = asString(paragraph.content)
    const sourceIds = Array.isArray(paragraph.sourceIds)
      ? [...new Set(paragraph.sourceIds.map(asString).filter(Boolean))]
      : []
    const claimType = asString(paragraph.claimType) as ClaimType
    if (!content || content.length > 8000 || !claimTypes.has(claimType)) {
      throw new ResearchServiceError('AI_GENERATION_RESPONSE_INVALID', 502, 'AI 返回了空、过长或类型异常的报告段落。')
    }
    if (sourceIds.some((sourceId) => !allowedSourceIds.has(sourceId))) {
      throw new ResearchServiceError('AI_GENERATION_RESPONSE_INVALID', 502, 'AI 报告包含当前章节之外的引用。')
    }
    if (claimType === 'source_supported' && sourceIds.length === 0) {
      throw new ResearchServiceError('AI_GENERATION_RESPONSE_INVALID', 502, 'AI 将无引用内容错误标记为来源事实。')
    }
    return {
      id: `${sectionId}-paragraph-${index + 1}`,
      content,
      sourceIds,
      claimType,
    }
  })
}

function ensureNoRepeatedParagraphs(sections: ReportSection[]) {
  const seen = new Set<string>()
  for (const paragraph of sections.flatMap((section) => section.paragraphs)) {
    const normalized = normalizedParagraph(paragraph.content)
    if (normalized.length >= 20 && seen.has(normalized)) {
      throw new ResearchServiceError('AI_GENERATION_RESPONSE_INVALID', 502, 'AI 返回了重复段落，已拒绝用重复内容填充字数。')
    }
    seen.add(normalized)
  }
}

async function requestReportJson(prompt: string, maxCompletionTokens: number) {
  const result = await generateContent('report', {
    messages: [
      {
        role: 'system',
        content: '你是严谨的中文研究报告撰稿人。只能使用请求中提供的来源，不调用工具，不编造事实或引用，不得重复段落凑字数。',
      },
      { role: 'user', content: prompt },
    ],
    maxCompletionTokens,
    temperature: 0.2,
  })
  return parseGeneratedJson(result.content)
}

function adjustmentInstruction(adjustment: LengthAdjustment) {
  if (adjustment === 'expand') {
    return '上一次结果明显短于目标。请只基于现有证据补充分析维度、条件、差异和限制；不得重复段落，不得新增无来源结论。'
  }
  if (adjustment === 'compress') {
    return '上一次结果超过目标上限。请合并重复论述、保留证据与关键差异，并压缩到目标范围内。'
  }
  return ''
}

async function generateSinglePassReport(
  request: ReportRequest,
  adjustment: LengthAdjustment,
): Promise<{ report: ReportContent; warnings: string[] }> {
  const allowedSourceIds = new Set(request.sources.map((source) => source.id))
  const sectionById = new Map(request.outline.sections.map((section) => [section.id, section]))
  const prompt = `请仅根据以下研究大纲、来源摘要和关键观点撰写中文简要研究报告。禁止联网搜索，禁止补充未提供的来源。

研究主题：${request.topic}
研究目标：${request.goal}
目标字数：${request.targetMinWords}—${request.targetMaxWords} 字
大纲：${JSON.stringify(request.outline)}
来源：${JSON.stringify(request.sources)}
${adjustmentInstruction(adjustment)}

要求：
1. 每个章节只能使用该章节 sourceIds 中的来源；
2. sourceIds 只能使用给定 id，不得生成不存在的引用；
3. 直接证据标记 source_supported，跨来源归纳标记 synthesis，证据不足标记 uncertain；
4. 不得重复段落凑字数，资料不足时缩小结论而不是强行扩写；
5. 正文总长度尽量落在 ${request.targetMinWords}—${request.targetMaxWords} 字；完整论证、引用和自然结尾优先，不得截断已生成内容；
6. 仅输出 JSON：{"report":{"title":"标题","executiveSummary":"执行摘要","sections":[{"id":"section-1","paragraphs":[{"content":"正文","sourceIds":["source-id"],"claimType":"source_supported|synthesis|uncertain"}]}],"conclusion":"总结","limitations":["研究限制"]},"warnings":[]}`
  const parsed = await requestReportJson(prompt, 6000)
  if (!isRecord(parsed) || !isRecord(parsed.report)) {
    throw new ResearchServiceError('AI_GENERATION_RESPONSE_INVALID', 502, 'AI 返回的报告结构无效。')
  }
  const title = asString(parsed.report.title)
  const executiveSummary = asString(parsed.report.executiveSummary)
  const conclusion = asString(parsed.report.conclusion)
  const limitations = Array.isArray(parsed.report.limitations)
    ? parsed.report.limitations.map(asString).filter(Boolean).slice(0, 12)
    : []
  const rawSections = Array.isArray(parsed.report.sections) ? parsed.report.sections : []
  if (
    !title || title.length > 240
    || !executiveSummary || executiveSummary.length > 4000
    || !conclusion || conclusion.length > 3000
    || limitations.length === 0
    || rawSections.length !== request.outline.sections.length
  ) {
    throw new ResearchServiceError('AI_GENERATION_RESPONSE_INVALID', 502, 'AI 返回的报告字段或章节数量异常。')
  }
  const seenSections = new Set<string>()
  const sections = rawSections.map((item) => {
    if (!isRecord(item)) {
      throw new ResearchServiceError('AI_GENERATION_RESPONSE_INVALID', 502, 'AI 返回了无效报告章节。')
    }
    const id = asString(item.id)
    const outlineSection = sectionById.get(id)
    if (!outlineSection || seenSections.has(id)) {
      throw new ResearchServiceError('AI_GENERATION_RESPONSE_INVALID', 502, 'AI 报告包含未知或重复章节。')
    }
    seenSections.add(id)
    const sectionSourceIds = new Set(outlineSection.sourceIds)
    const paragraphs = parseParagraphs(item.paragraphs, id, sectionSourceIds)
    if (paragraphs.some((paragraph) =>
      paragraph.sourceIds.some((sourceId) => !allowedSourceIds.has(sourceId)))) {
      throw new ResearchServiceError('AI_GENERATION_RESPONSE_INVALID', 502, 'AI 报告包含资料池之外的引用。')
    }
    return { id, title: outlineSection.title, paragraphs }
  })
  ensureNoRepeatedParagraphs(sections)
  return {
    report: {
      title,
      executiveSummary,
      sections,
      conclusion,
      limitations: limitations.map((item) => item.slice(0, 500)),
    },
    warnings: parseWarnings(parsed.warnings),
  }
}

async function generateSection(
  request: ReportRequest,
  section: ReportRequest['outline']['sections'][number],
  targetMinWords: number,
  targetMaxWords: number,
  adjustment: LengthAdjustment,
): Promise<ReportSection> {
  const sectionSources = request.sources.filter((source) =>
    section.sourceIds.includes(source.id))
  if (sectionSources.length === 0) {
    throw new ResearchServiceError('INVALID_REQUEST', 400, `章节“${section.title}”没有可用来源。`)
  }
  const prompt = `请撰写研究报告的一个章节。只能使用本章节提供的来源，禁止联网和引入其他章节来源。

研究主题：${request.topic}
研究目标：${request.goal}
章节：${JSON.stringify(section)}
本章来源：${JSON.stringify(sectionSources)}
本章目标字数：${targetMinWords}—${targetMaxWords} 字
${adjustmentInstruction(adjustment)}

要求：
1. sourceIds 只能使用本章来源 id；
2. 区分来源事实、跨来源综合和不确定判断；
3. 一条来源时明确限制结论强度，不得用重复内容扩写；
4. 本章正文尽量落在 ${targetMinWords}—${targetMaxWords} 字，保持完整结尾，不得截断；
5. 仅输出 JSON：{"section":{"id":"${section.id}","paragraphs":[{"content":"正文","sourceIds":["source-id"],"claimType":"source_supported|synthesis|uncertain"}]}}`
  const parsed = await requestReportJson(
    prompt,
    Math.min(6000, Math.max(1800, targetMaxWords * 2)),
  )
  if (!isRecord(parsed) || !isRecord(parsed.section) || asString(parsed.section.id) !== section.id) {
    throw new ResearchServiceError('AI_GENERATION_RESPONSE_INVALID', 502, 'AI 返回了错误的报告章节。')
  }
  return {
    id: section.id,
    title: section.title,
    paragraphs: parseParagraphs(
      parsed.section.paragraphs,
      section.id,
      new Set(section.sourceIds),
    ),
  }
}

async function generateMergedSummary(
  request: ReportRequest,
  sections: ReportSection[],
  adjustment: LengthAdjustment,
) {
  const adjustmentFactor = adjustment === 'expand'
    ? 1.2
    : adjustment === 'compress'
      ? 0.8
      : 1
  const summaryTarget = Math.max(
    140,
    Math.round(request.targetMaxWords * 0.12 * adjustmentFactor),
  )
  const conclusionTarget = Math.max(
    100,
    Math.round(request.targetMaxWords * 0.08 * adjustmentFactor),
  )
  const prompt = `以下章节已经分别依据各自来源生成。请在不新增事实和引用的前提下合并形成执行摘要、总结和研究限制。

研究主题：${request.topic}
报告标题：${request.outline.title}
章节正文：${JSON.stringify(sections)}
执行摘要目标：约 ${summaryTarget} 字
总结目标：约 ${conclusionTarget} 字
${adjustmentInstruction(adjustment)}

仅输出 JSON：{"title":"报告标题","executiveSummary":"执行摘要","conclusion":"总结","limitations":["研究限制"],"warnings":[]}`
  const parsed = await requestReportJson(prompt, 3000)
  if (!isRecord(parsed)) {
    throw new ResearchServiceError('AI_GENERATION_RESPONSE_INVALID', 502, 'AI 返回的报告汇总结构无效。')
  }
  const title = asString(parsed.title)
  const executiveSummary = asString(parsed.executiveSummary)
  const conclusion = asString(parsed.conclusion)
  const limitations = Array.isArray(parsed.limitations)
    ? parsed.limitations.map(asString).filter(Boolean).slice(0, 12)
    : []
  if (!title || !executiveSummary || !conclusion || limitations.length === 0) {
    throw new ResearchServiceError('AI_GENERATION_RESPONSE_INVALID', 502, 'AI 返回的执行摘要或总结不完整。')
  }
  return {
    title,
    executiveSummary,
    conclusion,
    limitations: limitations.map((item) => item.slice(0, 500)),
    warnings: parseWarnings(parsed.warnings),
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
) {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, items.length) },
      async () => {
        while (nextIndex < items.length) {
          const currentIndex = nextIndex
          nextIndex += 1
          results[currentIndex] = await mapper(items[currentIndex])
        }
      },
    ),
  )
  return results
}

async function generateSectionedReport(
  request: ReportRequest,
  adjustment: LengthAdjustment,
): Promise<{ report: ReportContent; warnings: string[] }> {
  const sectionCount = request.outline.sections.length
  const bodyMin = Math.round(request.targetMinWords * 0.72)
  const bodyMax = Math.round(request.targetMaxWords * 0.78)
  const adjustmentFactor = adjustment === 'expand'
    ? 1.25
    : adjustment === 'compress'
      ? 0.75
      : 1
  const sectionMin = Math.max(
    160,
    Math.floor((bodyMin / sectionCount) * adjustmentFactor),
  )
  const sectionMax = Math.max(
    sectionMin + 80,
    Math.floor((bodyMax / sectionCount) * adjustmentFactor),
  )
  const sections = await mapWithConcurrency(
    request.outline.sections,
    3,
    (section) =>
      generateSection(request, section, sectionMin, sectionMax, adjustment),
  )
  ensureNoRepeatedParagraphs(sections)
  const merged = await generateMergedSummary(request, sections, adjustment)
  return {
    report: {
      title: merged.title,
      executiveSummary: merged.executiveSummary,
      sections,
      conclusion: merged.conclusion,
      limitations: merged.limitations,
    },
    warnings: merged.warnings,
  }
}

async function generateByDepth(
  request: ReportRequest,
  adjustment: LengthAdjustment,
) {
  return request.reportDepth === 'brief'
    ? generateSinglePassReport(request, adjustment)
    : generateSectionedReport(request, adjustment)
}

export async function generateReport(
  request: ReportRequest,
): Promise<ReportResponse> {
  let generated = await generateByDepth(request, null)
  let actualWordCount = countReportWords(generated.report)
  const minimumRetryThreshold = Math.floor(request.targetMinWords * 0.8)
  const adjustment: LengthAdjustment = actualWordCount < minimumRetryThreshold
    ? 'expand'
    : actualWordCount > request.targetMaxWords
      ? 'compress'
      : null
  let adjustmentFailureWarning = ''

  if (adjustment) {
    try {
      const adjusted = await generateByDepth(request, adjustment)
      const adjustedWordCount = countReportWords(adjusted.report)
      const adjustedDistance = adjustedWordCount < minimumRetryThreshold
        ? minimumRetryThreshold - adjustedWordCount
        : adjustedWordCount > request.targetMaxWords
          ? adjustedWordCount - request.targetMaxWords
          : 0
      const originalDistance = actualWordCount < minimumRetryThreshold
        ? minimumRetryThreshold - actualWordCount
        : actualWordCount > request.targetMaxWords
          ? actualWordCount - request.targetMaxWords
          : 0
      if (adjustedDistance <= originalDistance) {
        generated = adjusted
        actualWordCount = adjustedWordCount
      }
    } catch (error) {
      if (!(error instanceof ResearchServiceError)) throw error
      adjustmentFailureWarning = '长度修正请求失败，已保留首次生成的真实内容并标明实际字数。'
    }
  }

  const warnings = [...generated.warnings]
  if (adjustmentFailureWarning) warnings.push(adjustmentFailureWarning)
  if (actualWordCount < minimumRetryThreshold) {
    warnings.push(
      `现有证据不足以安全扩写到目标下限，重试后实际约 ${actualWordCount} 字；系统未使用重复段落或无来源结论凑字数。`,
    )
  } else if (actualWordCount < request.targetMinWords) {
    warnings.push(`实际约 ${actualWordCount} 字，低于目标下限但已达到其 80%，建议补充来源后再扩展。`)
  }
  if (actualWordCount > request.targetMaxWords) {
    warnings.push(`压缩重试后实际约 ${actualWordCount} 字，仍略高于目标上限。`)
  }

  return {
    taskId: request.taskId,
    requestId: request.requestId,
    mode: 'live',
    dataSource: 'real',
    report: generated.report,
    warnings: [...new Set(warnings)],
    reportDepth: request.reportDepth,
    targetMinWords: request.targetMinWords,
    targetMaxWords: request.targetMaxWords,
    actualWordCount,
    generatedAt: new Date().toISOString(),
  }
}

import type { TaskDetailDto } from '../db/types'
import type { OutlineSectionData, ReportDepth, ResearchDepth, Source } from '../../src/types'

export interface ReportDocumentParagraph {
  content: string
  citationIndexes: number[]
}

export interface ReportDocumentSection {
  title: string
  level: 1 | 2 | 3
  paragraphs: ReportDocumentParagraph[]
}

export interface ReportDocumentReference {
  index: number
  title: string
  publisher: string
  publishedAt: string
  url: string
  summary?: string
}

export interface ReportDocument {
  title: string
  subtitle: string
  researchGoal: string
  generatedAt: string
  sourceCount: number
  wordCount: number
  researchDepth: ResearchDepth
  reportDepth: ReportDepth
  executiveSummary: string
  sections: ReportDocumentSection[]
  conclusion: string
  limitations: string[]
  references: ReportDocumentReference[]
  warnings: string[]
}

export class ReportNotReadyError extends Error {
  constructor() {
    super('研究报告尚未生成。')
    this.name = 'ReportNotReadyError'
  }
}

export class ReportDocumentInvalidError extends Error {
  constructor(message = '报告数据不完整，暂时无法导出。') {
    super(message)
    this.name = 'ReportDocumentInvalidError'
  }
}

const REPORT_TIME_ZONE = 'Asia/Shanghai'

export function formatReportDate(value: string, includeTime = false) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
    timeZone: REPORT_TIME_ZONE,
  }).format(date)
}

function reportDateStamp(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10)
  const parts = new Intl.DateTimeFormat('en', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: REPORT_TIME_ZONE,
  }).formatToParts(date)
  const byType = new Map(parts.map((part) => [part.type, part.value]))
  return `${byType.get('year')}-${byType.get('month')}-${byType.get('day')}`
}

function cleanText(value: string) {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim()
}

function outlineLevelById(sections: OutlineSectionData[] | undefined) {
  const levels = new Map<string, 1 | 2 | 3>()
  const visit = (items: OutlineSectionData[], depth: number) => {
    items.forEach((item) => {
      levels.set(item.id, Math.min(3, Math.max(1, depth)) as 1 | 2 | 3)
      visit(item.children ?? [], depth + 1)
    })
  }
  visit(sections ?? [], 1)
  return levels
}

function sourceMapFromTask(detail: TaskDetailDto) {
  return new Map(
    detail.state.poolItems.flatMap((item) => {
      const source = item.sourceSnapshot
      return source && /^https?:\/\//i.test(source.url) ? [[item.sourceId, source] as const] : []
    }),
  )
}

function toReference(index: number, source: Source): ReportDocumentReference {
  return {
    index,
    title: cleanText(source.title) || '未命名来源',
    publisher: cleanText(source.publisher) || '发布方未标注',
    publishedAt: cleanText(source.publishDate),
    url: source.url,
    summary: cleanText(source.summary) || undefined,
  }
}

export function buildReportDocument(detail: TaskDetailDto): ReportDocument {
  const { state } = detail
  const liveReport = state.liveReport
  if (!liveReport) throw new ReportNotReadyError()

  const title = cleanText(liveReport.report.title)
  const executiveSummary = cleanText(liveReport.report.executiveSummary)
  if (
    !title || !executiveSummary || liveReport.report.sections.length === 0
    || Number.isNaN(Date.parse(liveReport.generatedAt))
    || !Number.isFinite(liveReport.actualWordCount)
  ) {
    throw new ReportDocumentInvalidError()
  }

  const sources = sourceMapFromTask(detail)
  const referenceIndexBySourceId = new Map<string, number>()
  const references: ReportDocumentReference[] = []
  const warnings = [...liveReport.warnings.map(cleanText).filter(Boolean)]
  const missingSourceIds = new Set<string>()
  const levels = outlineLevelById(state.liveOutline?.outline.sections)

  const citationIndexes = (sourceIds: string[]) => sourceIds.flatMap((sourceId) => {
    const source = sources.get(sourceId)
    if (!source) {
      missingSourceIds.add(sourceId)
      return []
    }
    let index = referenceIndexBySourceId.get(sourceId)
    if (!index) {
      index = references.length + 1
      referenceIndexBySourceId.set(sourceId, index)
      references.push(toReference(index, source))
    }
    return [index]
  })

  const sections = liveReport.report.sections.map((section) => ({
    title: cleanText(section.title) || '未命名章节',
    level: levels.get(section.id) ?? 1,
    paragraphs: section.paragraphs
      .map((paragraph) => ({
        content: cleanText(paragraph.content),
        citationIndexes: citationIndexes(paragraph.sourceIds),
      }))
      .filter((paragraph) => paragraph.content.length > 0),
  }))

  if (sections.every((section) => section.paragraphs.length === 0)) {
    throw new ReportDocumentInvalidError('报告正文为空，暂时无法导出。')
  }
  if (missingSourceIds.size > 0) {
    warnings.push(`导出时跳过了 ${missingSourceIds.size} 个无法映射到当前任务资料池的引用。`)
  }

  const limitations = liveReport.report.limitations.map(cleanText).filter(Boolean)
  return {
    title,
    subtitle: 'Deep Research Report',
    researchGoal: cleanText(state.researchPlan?.objective ?? state.task.query ?? state.task.title),
    generatedAt: liveReport.generatedAt,
    sourceCount: references.length,
    wordCount: liveReport.actualWordCount,
    researchDepth: state.task.depth,
    reportDepth: liveReport.reportDepth,
    executiveSummary,
    sections,
    conclusion: cleanText(liveReport.report.conclusion),
    limitations: limitations.length > 0
      ? limitations
      : ['本报告基于研究时点可访问的公开来源生成。部分网页可能因访问权限、更新频率或内容解析限制而未完整纳入。'],
    references,
    warnings,
  }
}

export function sanitizeReportFilename(title: string, generatedAt: string, extension: 'pdf' | 'docx') {
  const safeTitle = cleanText(title)
    .replace(/[<>:"：/\\|?*]/g, '_')
    .replace(/[. ]+$/g, '')
    .replace(/_+/g, '_')
    .slice(0, 100)
    || 'Deep_Research_Report'
  const date = reportDateStamp(generatedAt)
  return `${safeTitle}_${date}.${extension}`
}

export const reportDepthLabel = (depth: ReportDepth) => ({
  brief: '简要报告',
  standard: '标准报告',
  deep: '深度报告',
}[depth])

export const researchDepthLabel = (depth: ResearchDepth) => ({
  quick: '快速概览',
  deep: '深度研究',
  professional: '专业分析',
}[depth])

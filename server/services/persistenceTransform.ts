import type {
  LiveOutlineResult,
  LiveReportResult,
  LiveResearchResult,
  ResearchPlan,
  Source,
  SourceKind,
} from '../../src/types'
import type {
  OutlineResponse,
  PlanResponse,
  ReportResponse,
  ResearchResponse,
  ResearchStrategy,
} from '../types/research'

export interface PersistedResearchPlan extends ResearchPlan {
  _researchStrategy?: ResearchStrategy
  _researchStrategyVersion?: 2
}

function normalizeHttpUrl(value: string) {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

function createSourceId(url: string) {
  let hash = 2166136261
  for (const character of url) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return `live-${(hash >>> 0).toString(36)}`
}

function mapLiveSourceKind(type: string): SourceKind {
  const normalized = type.toLocaleLowerCase()
  if (/论文|学术|pdf/.test(normalized)) return 'pdf'
  if (/报告|研究/.test(normalized)) return 'report'
  if (/媒体|新闻/.test(normalized)) return 'news'
  return 'web'
}

export function toPersistedPlan(
  response: PlanResponse,
  usesPrototypeData: boolean,
  researchStrategy?: ResearchStrategy,
): PersistedResearchPlan {
  return {
    objective: response.plan.objective.trim(),
    scope: response.plan.scope.trim(),
    questions: response.plan.questions.map((question) => ({
      id: question.id.trim(),
      text: question.text.trim(),
    })),
    sourcePreferences: [...new Set(response.plan.sourcePreferences)] as ResearchPlan['sourcePreferences'],
    estimatedSourceCount: response.plan.estimatedSourceCount,
    estimatedDurationMinutes: response.plan.estimatedDurationMinutes,
    usesPrototypeData,
    dataSource: 'real',
    updatedAt: response.generatedAt,
    confirmedAt: null,
    ...(researchStrategy ? {
      _researchStrategy: researchStrategy,
      _researchStrategyVersion: 2 as const,
    } : {}),
  }
}

export function toPersistedResearchResult(
  response: ResearchResponse,
  fallbackTopic: string,
): LiveResearchResult {
  const sourceIdMap = new Map<string, string>()
  const seenUrls = new Set<string>()
  const sources = response.sources.flatMap<Source>((candidate, index) => {
    const normalizedUrl = normalizeHttpUrl(candidate.url)
    if (!normalizedUrl || seenUrls.has(normalizedUrl)) return []
    seenUrls.add(normalizedUrl)
    const id = createSourceId(normalizedUrl)
    sourceIdMap.set(candidate.id, id)
    const sourceTypeLabel = candidate.type.trim()
    return [{
      id,
      rank: index + 1,
      title: candidate.title.trim(),
      type: mapLiveSourceKind(sourceTypeLabel),
      publisher: candidate.publisher.trim(),
      url: normalizedUrl,
      publishDate: candidate.publishedAt.trim(),
      freshness: '联网搜索',
      credibility: 'unverified',
      tags: [sourceTypeLabel, candidate.publisher.trim()].filter(Boolean),
      summary: candidate.summary.trim(),
      keyInsight: candidate.keyInsight.trim(),
      addedToPool: false,
      excerpt: candidate.summary.trim() ? [candidate.summary.trim()] : [],
      insights: candidate.keyInsight.trim() ? [candidate.keyInsight.trim()] : [],
      origin: 'real',
      sourceTypeLabel,
    }]
  })
  const insights = response.insights.map((insight) => ({
    id: insight.id,
    title: insight.title.trim(),
    content: insight.content.trim(),
    sourceIds: [...new Set(insight.sourceIds.flatMap((sourceId) => {
      const mapped = sourceIdMap.get(sourceId)
      return mapped ? [mapped] : []
    }))],
  }))
  return {
    mode: 'live',
    dataSource: 'real',
    topic: response.topic.trim() || fallbackTopic,
    summary: response.summary.trim(),
    insights,
    sources,
    warnings: response.warnings.map((warning) => warning.trim()).filter(Boolean),
    targetSourceCount: response.targetSourceCount,
    actualSourceCount: response.actualSourceCount,
    deduplicatedSourceCount: response.deduplicatedSourceCount,
    validSourceCount: response.validSourceCount,
    searchedAt: response.searchedAt,
  }
}

export function toPersistedOutline(response: OutlineResponse): LiveOutlineResult {
  return {
    mode: 'live',
    dataSource: 'real',
    outline: {
      title: response.outline.title.trim(),
      sections: response.outline.sections.map((section) => ({
        id: section.id,
        title: section.title.trim(),
        description: section.description.trim(),
        sourceIds: [...new Set(section.sourceIds)],
        evidenceStatus: section.evidenceStatus,
        children: [],
      })),
    },
    warnings: response.warnings.filter(Boolean),
    generatedAt: response.generatedAt,
  }
}

export function toPersistedReport(response: ReportResponse): LiveReportResult {
  return {
    mode: 'live',
    dataSource: 'real',
    report: {
      title: response.report.title.trim(),
      executiveSummary: response.report.executiveSummary.trim(),
      sections: response.report.sections.map((section) => ({
        id: section.id,
        title: section.title.trim(),
        paragraphs: section.paragraphs.map((paragraph) => ({
          ...paragraph,
          content: paragraph.content.trim(),
          sourceIds: [...new Set(paragraph.sourceIds)],
        })),
      })),
      conclusion: response.report.conclusion.trim(),
      limitations: response.report.limitations.filter(Boolean),
    },
    warnings: response.warnings.filter(Boolean),
    reportDepth: response.reportDepth,
    targetMinWords: response.targetMinWords,
    targetMaxWords: response.targetMaxWords,
    actualWordCount: response.actualWordCount,
    generatedAt: response.generatedAt,
  }
}

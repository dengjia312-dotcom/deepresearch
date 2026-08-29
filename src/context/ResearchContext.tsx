import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  defaultResearchTopic,
  normalizeTopicInput,
  resolveResearchTopic,
  selectResearchTopic,
} from '../data/researchTopics'
import {
  createResearchPlan,
  sourcePreferenceOptions,
} from '../data/researchPlans'
import {
  requestLivePlan,
  requestLiveOutline,
  requestLiveReport,
  requestLiveResearch,
  requestAddPoolItem,
  requestCreateTask,
  requestImportV4,
  requestReportConfig,
  requestSavePlan,
  requestTaskDetail,
  requestTaskList,
  requestUpdatePoolItem,
  requestUseMockStage,
  ResearchApiError,
  type LivePlanResponse,
  type LiveOutlineResponse,
  type LiveReportResponse,
  type LiveResearchResponse,
  type SelectedSourceRequest,
} from '../services/researchApi'
import type {
  GenerationMode,
  GenerationStatus,
  LiveOutlineResult,
  LiveReportResult,
  LiveResearchResult,
  OutlineSectionData,
  ReportSectionData,
  ReportDepth,
  ResearchDepth,
  ResearchPlan,
  ResearchPoolItem,
  ResearchQuestion,
  ResearchTask,
  ResearchTopicData,
  ReviewStatus,
  SearchMode,
  SearchDepth,
  SearchStatus,
  Source,
  SourceKind,
  SourcePreference,
} from '../types'

export type AsyncResearchOperation = 'plan' | 'research' | 'outline' | 'report'

export interface AsyncRequestState {
  requestId: string | null
  status: GenerationStatus
  startedAt: string | null
  lastErrorCode: string | null
  lastErrorStatus: number | null
  failedAt: string | null
}

export type AsyncRequestStates = Record<AsyncResearchOperation, AsyncRequestState>

function createIdleRequestStates(): AsyncRequestStates {
  return {
    plan: createRequestState(),
    research: createRequestState(),
    outline: createRequestState(),
    report: createRequestState(),
  }
}

function createRequestState(
  status: GenerationStatus = 'idle',
  error: Partial<Pick<AsyncRequestState, 'lastErrorCode' | 'lastErrorStatus' | 'failedAt'>> = {},
): AsyncRequestState {
  return {
    requestId: null,
    status,
    startedAt: null,
    lastErrorCode: error.lastErrorCode ?? null,
    lastErrorStatus: error.lastErrorStatus ?? null,
    failedAt: error.failedAt ?? null,
  }
}

function restoreRequestState(
  value: unknown,
  status: GenerationStatus,
  interrupted = false,
): AsyncRequestState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return createRequestState(status, interrupted
      ? {
          lastErrorCode: 'REQUEST_INTERRUPTED',
          lastErrorStatus: null,
          failedAt: new Date().toISOString(),
        }
      : {})
  }
  const candidate = value as Partial<AsyncRequestState>
  return createRequestState(status, {
    lastErrorCode: interrupted
      ? 'REQUEST_INTERRUPTED'
      : typeof candidate.lastErrorCode === 'string'
      ? candidate.lastErrorCode
      : null,
    lastErrorStatus: typeof candidate.lastErrorStatus === 'number'
      ? candidate.lastErrorStatus
      : null,
    failedAt: interrupted
      ? new Date().toISOString()
      : typeof candidate.failedAt === 'string'
        ? candidate.failedAt
        : null,
  })
}

interface FailureActionMetadata {
  errorCode?: string | null
  errorStatus?: number | null
  failedAt?: string
}

export interface ResearchState {
  task: ResearchTask
  researchPlan: ResearchPlan | null
  planMode: GenerationMode
  planStatus: GenerationStatus
  planError: string | null
  searchMode: SearchMode
  searchStatus: SearchStatus
  liveResearchResult: LiveResearchResult | null
  searchError: string | null
  searchedAt: string | null
  outlineMode: GenerationMode
  outlineStatus: GenerationStatus
  outlineError: string | null
  liveOutline: LiveOutlineResult | null
  reportMode: GenerationMode
  reportStatus: GenerationStatus
  reportError: string | null
  liveReport: LiveReportResult | null
  poolItems: ResearchPoolItem[]
  outlineGenerated: boolean
  reportGenerated: boolean
  requests: AsyncRequestStates
  poolVersion: number
  outlineVersion: number
  reportConfigVersion: number
  notice: string | null
}

type ResearchAction =
  | {
      type: 'PREPARE_RESEARCH'
      originalTopic: string
      standardizedTopic: string
      depth: ResearchDepth
      topicId: string
      usesPrototypeData: boolean
      taskId: string
    }
  | { type: 'START_LIVE_PLAN'; taskId: string; requestId: string; startedAt: string }
  | { type: 'LIVE_PLAN_SUCCESS'; taskId: string; requestId: string; researchPlan: ResearchPlan }
  | ({ type: 'LIVE_PLAN_ERROR'; taskId: string; requestId: string; message: string } & FailureActionMetadata)
  | { type: 'USE_MOCK_PLAN'; taskId: string; researchPlan: ResearchPlan }
  | { type: 'UPDATE_PLAN_SCOPE'; scope: string }
  | { type: 'UPDATE_PLAN_QUESTION'; questionId: string; text: string }
  | { type: 'ADD_PLAN_QUESTION'; question: ResearchQuestion }
  | { type: 'REMOVE_PLAN_QUESTION'; questionId: string }
  | { type: 'TOGGLE_SOURCE_PREFERENCE'; preference: SourcePreference }
  | { type: 'SET_SEARCH_CONFIG'; depth: SearchDepth; targetSourceCount: number }
  | {
      type: 'SET_REPORT_DEPTH'
      depth: ReportDepth
      targetMinWords: number
      targetMaxWords: number
    }
  | { type: 'CONFIRM_PLAN'; confirmedAt: string }
  | { type: 'START_LIVE_SEARCH'; taskId: string; requestId: string; startedAt: string }
  | { type: 'LIVE_SEARCH_SUCCESS'; taskId: string; requestId: string; result: LiveResearchResult }
  | ({
      type: 'LIVE_SEARCH_ERROR'
      taskId: string
      requestId: string
      targetSourceCount: number
      message: string
    } & FailureActionMetadata)
  | { type: 'USE_MOCK_SEARCH' }
  | { type: 'START_LIVE_OUTLINE'; taskId: string; requestId: string; startedAt: string; poolVersion: number }
  | { type: 'LIVE_OUTLINE_SUCCESS'; taskId: string; requestId: string; poolVersion: number; result: LiveOutlineResult }
  | ({ type: 'LIVE_OUTLINE_ERROR'; taskId: string; requestId?: string; poolVersion?: number; message: string } & FailureActionMetadata)
  | { type: 'USE_MOCK_OUTLINE' }
  | {
      type: 'START_LIVE_REPORT'
      taskId: string
      requestId: string
      startedAt: string
      poolVersion: number
      outlineVersion: number
      reportConfigVersion: number
    }
  | {
      type: 'LIVE_REPORT_SUCCESS'
      taskId: string
      requestId: string
      poolVersion: number
      outlineVersion: number
      reportConfigVersion: number
      result: LiveReportResult
    }
  | ({
      type: 'LIVE_REPORT_ERROR'
      taskId: string
      requestId?: string
      poolVersion?: number
      outlineVersion?: number
      reportConfigVersion?: number
      reportDepth: ReportDepth
      message: string
    } & FailureActionMetadata)
  | { type: 'USE_MOCK_REPORT' }
  | { type: 'ADD_SOURCE'; source: Source }
  | { type: 'SET_REVIEW_STATUS'; sourceId: string; reviewStatus: ReviewStatus }
  | { type: 'UPDATE_NOTE'; sourceId: string; note: string }
  | { type: 'SET_NOTICE'; notice: string | null }

interface WorkspaceState {
  activeTaskId: string | null
  taskOrder: string[]
  tasksById: Record<string, ResearchState>
}

type WorkspaceAction =
  | { type: 'CREATE_TASK'; action: Extract<ResearchAction, { type: 'PREPARE_RESEARCH' }> }
  | { type: 'SWITCH_TASK'; taskId: string }
  | { type: 'UPDATE_TASK'; taskId: string; action: ResearchAction }
  | { type: 'HYDRATE'; workspace: WorkspaceState }
  | { type: 'REPLACE_TASK'; taskId: string; state: ResearchState }

const WORKSPACE_STORAGE_KEY = 'ai-research-workspace-v4'
const STORAGE_KEY = 'ai-research-workspace-v3'
const LEGACY_STORAGE_KEY = 'ai-research-workspace-v2'
const ACTIVE_TASK_STORAGE_KEY = 'deep-research:active-task-id'
const V4_IMPORT_COMPLETED_KEY = 'deep-research:v4-import-completed'
export const MIN_OUTLINE_SOURCE_COUNT = 2
export const REPORT_DEPTH_RANGES: Record<
  ReportDepth,
  { label: string; min: number; max: number; minimumSources: number }
> = {
  brief: { label: '简要报告', min: 800, max: 1200, minimumSources: 2 },
  standard: { label: '标准报告', min: 1500, max: 2500, minimumSources: 4 },
  deep: { label: '深度报告', min: 3000, max: 5000, minimumSources: 8 },
}

const defaultTask: ResearchTask = {
  id: 'demo-low-code',
  title: defaultResearchTopic.topic,
  query: defaultResearchTopic.topic,
  topicId: defaultResearchTopic.id,
  usesPrototypeData: false,
  dataSource: 'real',
  depth: 'deep',
  searchDepth: 'standard',
  targetSourceCount: 12,
  reportDepth: 'brief',
  reportTargetMinWords: 800,
  reportTargetMaxWords: 1200,
  status: 'draft',
  createdAt: '2024-04-18T10:23:00.000Z',
}

const defaultState: ResearchState = {
  task: defaultTask,
  researchPlan: null,
  planMode: 'idle',
  planStatus: 'idle',
  planError: null,
  searchMode: 'idle',
  searchStatus: 'idle',
  liveResearchResult: null,
  searchError: null,
  searchedAt: null,
  outlineMode: 'idle',
  outlineStatus: 'idle',
  outlineError: null,
  liveOutline: null,
  reportMode: 'idle',
  reportStatus: 'idle',
  reportError: null,
  liveReport: null,
  poolItems: [],
  outlineGenerated: false,
  reportGenerated: false,
  requests: createIdleRequestStates(),
  poolVersion: 0,
  outlineVersion: 0,
  reportConfigVersion: 0,
  notice: null,
}

interface PersistedResearchState {
  version: 3
  task: ResearchTask
  researchPlan: ResearchPlan | null
  planMode?: GenerationMode
  planStatus?: GenerationStatus
  planError?: string | null
  searchMode?: SearchMode
  searchStatus?: SearchStatus
  liveResearchResult?: LiveResearchResult | null
  searchError?: string | null
  searchedAt?: string | null
  outlineMode?: GenerationMode
  outlineStatus?: GenerationStatus
  outlineError?: string | null
  liveOutline?: LiveOutlineResult | null
  reportMode?: GenerationMode
  reportStatus?: GenerationStatus
  reportError?: string | null
  liveReport?: LiveReportResult | null
  poolItems: ResearchPoolItem[]
  outlineGenerated: boolean
  reportGenerated: boolean
  requests?: AsyncRequestStates
  poolVersion?: number
  outlineVersion?: number
  reportConfigVersion?: number
}

interface PersistedWorkspaceState {
  version: 4
  activeTaskId: string | null
  taskOrder: string[]
  tasksById: Record<string, PersistedResearchState>
}

interface LegacyPersistedResearchState {
  version: 2
  task: ResearchTask
  poolItems: ResearchPoolItem[]
  outlineGenerated: boolean
  reportGenerated: boolean
}

function isResearchPlan(value: unknown): value is ResearchPlan {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ResearchPlan>
  return (
    typeof candidate.objective === 'string'
    && typeof candidate.scope === 'string'
    && Array.isArray(candidate.questions)
    && candidate.questions.every(
      (question) => question
        && typeof question.id === 'string'
        && typeof question.text === 'string',
    )
    && Array.isArray(candidate.sourcePreferences)
    && typeof candidate.estimatedSourceCount === 'number'
    && typeof candidate.estimatedDurationMinutes === 'number'
    && typeof candidate.usesPrototypeData === 'boolean'
    && (
      candidate.dataSource === undefined
      || candidate.dataSource === 'real'
      || candidate.dataSource === 'mock'
    )
    && typeof candidate.updatedAt === 'string'
    && (candidate.confirmedAt === null || typeof candidate.confirmedAt === 'string')
  )
}

function sanitizeLivePlan(
  response: LivePlanResponse,
  usesPrototypeData: boolean,
): ResearchPlan | null {
  const allowedSourcePreferences = new Set<string>(sourcePreferenceOptions)
  if (
    response.mode !== 'live'
    || response.dataSource !== 'real'
    || !response.plan
    || typeof response.plan.objective !== 'string'
    || !response.plan.objective.trim()
    || typeof response.plan.scope !== 'string'
    || !response.plan.scope.trim()
    || !Array.isArray(response.plan.questions)
    || response.plan.questions.length < 3
    || response.plan.questions.length > 8
    || response.plan.questions.some((question) =>
      !question
      || typeof question.id !== 'string'
      || !question.id.trim()
      || typeof question.text !== 'string'
      || !question.text.trim())
    || new Set(response.plan.questions.map((question) => question.id)).size
      !== response.plan.questions.length
    || !Array.isArray(response.plan.sourcePreferences)
    || response.plan.sourcePreferences.length < 2
    || response.plan.sourcePreferences.length > 6
    || response.plan.sourcePreferences.some((preference) =>
      typeof preference !== 'string' || !allowedSourcePreferences.has(preference))
    || typeof response.plan.estimatedSourceCount !== 'number'
    || !Number.isFinite(response.plan.estimatedSourceCount)
    || response.plan.estimatedSourceCount <= 0
    || typeof response.plan.estimatedDurationMinutes !== 'number'
    || !Number.isFinite(response.plan.estimatedDurationMinutes)
    || response.plan.estimatedDurationMinutes <= 0
  ) return null

  const generatedAt = typeof response.generatedAt === 'string'
    && !Number.isNaN(Date.parse(response.generatedAt))
    ? response.generatedAt
    : new Date().toISOString()

  return {
    objective: response.plan.objective.trim(),
    scope: response.plan.scope.trim(),
    questions: response.plan.questions.map((question) => ({
      id: question.id.trim(),
      text: question.text.trim(),
    })),
    sourcePreferences: [...new Set(response.plan.sourcePreferences)],
    estimatedSourceCount: response.plan.estimatedSourceCount,
    estimatedDurationMinutes: response.plan.estimatedDurationMinutes,
    usesPrototypeData,
    dataSource: 'real',
    updatedAt: generatedAt,
    confirmedAt: null,
  }
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

function sanitizeLiveResearchResult(
  response: LiveResearchResponse,
  fallbackTopic: string,
): LiveResearchResult | null {
  if (
    response.mode !== 'live'
    || response.dataSource !== 'real'
    || typeof response.summary !== 'string'
    || !Array.isArray(response.sources)
    || !Array.isArray(response.insights)
    || !Number.isInteger(response.targetSourceCount)
    || response.targetSourceCount < 8
    || response.targetSourceCount > 30
    || !Number.isInteger(response.actualSourceCount)
    || !Number.isInteger(response.deduplicatedSourceCount)
    || !Number.isInteger(response.validSourceCount)
    || response.actualSourceCount < response.deduplicatedSourceCount
    || response.deduplicatedSourceCount < response.validSourceCount
  ) {
    return null
  }

  const sourceIdMap = new Map<string, string>()
  const seenUrls = new Set<string>()
  const sources = response.sources.flatMap<Source>((candidate, index) => {
    const title = typeof candidate.title === 'string' ? candidate.title.trim() : ''
    const normalizedUrl = typeof candidate.url === 'string'
      ? normalizeHttpUrl(candidate.url.trim())
      : null
    if (!title || !normalizedUrl || seenUrls.has(normalizedUrl)) return []

    seenUrls.add(normalizedUrl)
    const id = createSourceId(normalizedUrl)
    if (typeof candidate.id === 'string' && candidate.id) {
      sourceIdMap.set(candidate.id, id)
    }
    const sourceTypeLabel = typeof candidate.type === 'string'
      ? candidate.type.trim()
      : ''
    const publisher = typeof candidate.publisher === 'string'
      ? candidate.publisher.trim()
      : ''
    const summary = typeof candidate.summary === 'string'
      ? candidate.summary.trim()
      : ''
    const keyInsight = typeof candidate.keyInsight === 'string'
      ? candidate.keyInsight.trim()
      : ''
    const publishDate = typeof candidate.publishedAt === 'string'
      ? candidate.publishedAt.trim()
      : ''

    return [{
      id,
      rank: index + 1,
      title,
      type: mapLiveSourceKind(sourceTypeLabel),
      publisher,
      url: normalizedUrl,
      publishDate,
      freshness: '联网搜索',
      credibility: 'unverified',
      tags: [sourceTypeLabel, publisher].filter(Boolean),
      summary,
      keyInsight,
      addedToPool: false,
      excerpt: summary ? [summary] : [],
      insights: keyInsight ? [keyInsight] : [],
      origin: 'real',
      sourceTypeLabel,
    }]
  })
  if (sources.length === 0) return null
  if (sources.length !== response.validSourceCount) return null

  const insights = response.insights.flatMap((candidate, index) => {
    const title = typeof candidate.title === 'string' ? candidate.title.trim() : ''
    const content = typeof candidate.content === 'string' ? candidate.content.trim() : ''
    if (!title || !content) return []
    const sourceIds = Array.isArray(candidate.sourceIds)
      ? [...new Set(candidate.sourceIds.flatMap((sourceId) => {
          const mappedId = typeof sourceId === 'string' ? sourceIdMap.get(sourceId) : undefined
          return mappedId ? [mappedId] : []
        }))]
      : []
    return [{
      id: typeof candidate.id === 'string' && candidate.id
        ? candidate.id
        : `insight-${index + 1}`,
      title,
      content,
      sourceIds,
    }]
  })
  if (!response.summary.trim() || insights.length === 0) return null

  const searchedAt = typeof response.searchedAt === 'string'
    && !Number.isNaN(Date.parse(response.searchedAt))
    ? response.searchedAt
    : new Date().toISOString()

  return {
    mode: 'live',
    dataSource: 'real',
    topic: typeof response.topic === 'string' && response.topic.trim()
      ? response.topic.trim()
      : fallbackTopic,
    summary: response.summary.trim(),
    insights,
    sources,
    warnings: Array.isArray(response.warnings)
      ? response.warnings.filter((warning): warning is string =>
          typeof warning === 'string' && Boolean(warning.trim()))
        .map((warning) => warning.trim())
      : [],
    targetSourceCount: response.targetSourceCount,
    actualSourceCount: response.actualSourceCount,
    deduplicatedSourceCount: response.deduplicatedSourceCount,
    validSourceCount: response.validSourceCount,
    searchedAt,
  }
}

function isLiveResearchResult(value: unknown): value is LiveResearchResult {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<LiveResearchResult>
  return candidate.mode === 'live'
    && (candidate.dataSource === undefined || candidate.dataSource === 'real')
    && typeof candidate.topic === 'string'
    && typeof candidate.summary === 'string'
    && typeof candidate.searchedAt === 'string'
    && Array.isArray(candidate.insights)
    && Array.isArray(candidate.sources)
    && candidate.sources.length > 0
    && candidate.sources.every((source) =>
      source
      && typeof source.id === 'string'
      && typeof source.title === 'string'
      && typeof source.url === 'string'
      && Boolean(normalizeHttpUrl(source.url)))
    && Array.isArray(candidate.warnings)
}

function sanitizeLiveOutline(
  response: LiveOutlineResponse,
  allowedSourceIds: Set<string>,
): LiveOutlineResult | null {
  if (
    response.mode !== 'live'
    || response.dataSource !== 'real'
    || !response.outline?.title?.trim()
    || !Array.isArray(response.outline.sections)
    || response.outline.sections.length < 2
  ) return null
  const seenSectionIds = new Set<string>()
  const sections = response.outline.sections.flatMap((section) => {
    const sourceIds = Array.isArray(section.sourceIds)
      ? [...new Set(section.sourceIds)]
      : []
    if (
      !section.id || !section.title?.trim() || !section.description?.trim()
      || seenSectionIds.has(section.id)
      || sourceIds.some((sourceId) => !allowedSourceIds.has(sourceId))
      || !['sufficient', 'limited', 'insufficient'].includes(section.evidenceStatus)
    ) return []
    seenSectionIds.add(section.id)
    return [{
      id: section.id,
      title: section.title.trim(),
      description: section.description.trim(),
      sourceIds,
      evidenceStatus: section.evidenceStatus,
      children: [],
    }]
  })
  if (sections.length !== response.outline.sections.length) return null
  return {
    mode: 'live',
    dataSource: 'real',
    outline: { title: response.outline.title.trim(), sections },
    warnings: Array.isArray(response.warnings) ? response.warnings.filter(Boolean) : [],
    generatedAt: response.generatedAt,
  }
}

function isLiveOutline(value: unknown): value is LiveOutlineResult {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<LiveOutlineResult>
  return candidate.mode === 'live'
    && (candidate.dataSource === undefined || candidate.dataSource === 'real')
    && Boolean(candidate.outline?.title)
    && Array.isArray(candidate.outline?.sections)
    && candidate.outline.sections.length >= 2
    && typeof candidate.generatedAt === 'string'
    && Array.isArray(candidate.warnings)
}

function sanitizeLiveReport(
  response: LiveReportResponse,
  allowedSourceIds: Set<string>,
  allowedSectionIds: Set<string>,
): LiveReportResult | null {
  if (
    response.mode !== 'live'
    || response.dataSource !== 'real'
    || !response.report?.title?.trim()
    || !response.report.executiveSummary?.trim()
    || !response.report.conclusion?.trim()
    || !Array.isArray(response.report.sections)
    || !Array.isArray(response.report.limitations)
    || response.report.limitations.length === 0
    || !['brief', 'standard', 'deep'].includes(response.reportDepth)
    || !Number.isInteger(response.targetMinWords)
    || !Number.isInteger(response.targetMaxWords)
    || !Number.isInteger(response.actualWordCount)
    || response.targetMinWords <= 0
    || response.targetMaxWords < response.targetMinWords
    || response.actualWordCount <= 0
  ) return null
  const seenSections = new Set<string>()
  const sections = response.report.sections.flatMap((section) => {
    if (
      !section.id || !section.title?.trim()
      || !allowedSectionIds.has(section.id)
      || seenSections.has(section.id)
      || !Array.isArray(section.paragraphs)
      || section.paragraphs.length === 0
    ) return []
    seenSections.add(section.id)
    const paragraphs = section.paragraphs.flatMap((paragraph) => {
      const sourceIds = Array.isArray(paragraph.sourceIds)
        ? [...new Set(paragraph.sourceIds)]
        : []
      if (
        !paragraph.id || !paragraph.content?.trim()
        || sourceIds.some((sourceId) => !allowedSourceIds.has(sourceId))
        || !['source_supported', 'synthesis', 'uncertain'].includes(paragraph.claimType)
        || (paragraph.claimType === 'source_supported' && sourceIds.length === 0)
      ) return []
      return [{ ...paragraph, content: paragraph.content.trim(), sourceIds }]
    })
    return paragraphs.length === section.paragraphs.length
      ? [{ id: section.id, title: section.title.trim(), paragraphs }]
      : []
  })
  if (sections.length !== response.report.sections.length) return null
  return {
    mode: 'live',
    dataSource: 'real',
    report: {
      title: response.report.title.trim(),
      executiveSummary: response.report.executiveSummary.trim(),
      sections,
      conclusion: response.report.conclusion.trim(),
      limitations: response.report.limitations.filter(Boolean),
    },
    warnings: Array.isArray(response.warnings) ? response.warnings.filter(Boolean) : [],
    reportDepth: response.reportDepth,
    targetMinWords: response.targetMinWords,
    targetMaxWords: response.targetMaxWords,
    actualWordCount: response.actualWordCount,
    generatedAt: response.generatedAt,
  }
}

function isLiveReport(value: unknown): value is LiveReportResult {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<LiveReportResult>
  return candidate.mode === 'live'
    && (candidate.dataSource === undefined || candidate.dataSource === 'real')
    && Boolean(candidate.report?.title)
    && Array.isArray(candidate.report?.sections)
    && candidate.report.sections.length >= 2
    && typeof candidate.generatedAt === 'string'
    && Array.isArray(candidate.warnings)
}

interface ResearchRequestFailure extends Required<FailureActionMetadata> {
  message: string
}

function createResearchRequestFailure(
  message: string,
  errorCode: string,
  errorStatus: number | null = null,
): ResearchRequestFailure {
  return {
    message,
    errorCode,
    errorStatus,
    failedAt: new Date().toISOString(),
  }
}

function getResearchRequestFailure(error: unknown): ResearchRequestFailure {
  if (!(error instanceof ResearchApiError)) {
    return createResearchRequestFailure(
      '网络连接失败，请检查后端服务后重试。',
      'NETWORK_ERROR',
    )
  }
  const messages: Record<string, string> = {
    API_RATE_LIMITED: '请求过于频繁，请等待提示时间后手动重试。',
    API_CONCURRENCY_LIMITED: '当前服务请求较多，请稍后手动重试。',
    MIMO_NOT_CONFIGURED: 'MiMo API 尚未配置，请联系管理员检查后端环境变量。',
    MIMO_AUTH_FAILED: 'MiMo API 鉴权失败，请联系管理员检查后端配置。',
    MIMO_ACCESS_DENIED: 'MiMo API 拒绝访问，请检查服务开通状态。',
    MIMO_QUOTA_EXCEEDED: 'MiMo API 余额不足，请充值后重试。',
    MIMO_TIMEOUT: 'MiMo 请求超时，请稍后重试。',
    MIMO_RATE_LIMITED: '请求过于频繁或套餐额度已耗尽，请稍后重试。',
    MIMO_NETWORK_ERROR: '后端暂时无法连接 MiMo API，请稍后重试。',
    RESEARCH_SEARCH_FAILED: 'GLM 联网检索暂时失败，请稍后手动重试。',
    NO_REAL_SOURCES: '本次研究没有返回可验证的真实来源，请调整主题后重试。',
    MIMO_RESPONSE_INVALID: 'MiMo 返回的数据结构异常，请重新生成。',
  }
  return createResearchRequestFailure(
    messages[error.code] ?? error.message ?? '联网研究失败，请稍后重试。',
    error.code,
    error.status,
  )
}

function restoreTaskState(
  task: ResearchTask,
  researchPlan: ResearchPlan | null,
  storedPoolItems: ResearchPoolItem[],
  storedOutlineGenerated: boolean,
  storedReportGenerated: boolean,
  storedSearch?: {
    planMode?: GenerationMode
    planStatus?: GenerationStatus
    planError?: string | null
    mode?: SearchMode
    status?: SearchStatus
    result?: LiveResearchResult | null
    error?: string | null
    searchedAt?: string | null
    outlineMode?: GenerationMode
    outlineStatus?: GenerationStatus
    outlineError?: string | null
    liveOutline?: LiveOutlineResult | null
    reportMode?: GenerationMode
    reportStatus?: GenerationStatus
    reportError?: string | null
    liveReport?: LiveReportResult | null
    requests?: AsyncRequestStates
    poolVersion?: number
    outlineVersion?: number
    reportConfigVersion?: number
  },
): ResearchState {
  const topic = resolveResearchTopic(task.topicId, task.title || task.query)
  const targetSourceCount = Number.isInteger(task.targetSourceCount)
    && task.targetSourceCount >= 8
    && task.targetSourceCount <= 30
    ? task.targetSourceCount
    : 12
  const searchDepth: SearchDepth = task.searchDepth === 'concise'
    || task.searchDepth === 'standard'
    || task.searchDepth === 'deep'
    || task.searchDepth === 'custom'
    ? task.searchDepth
    : targetSourceCount === 8
      ? 'concise'
      : targetSourceCount === 16
        ? 'deep'
        : targetSourceCount === 12
          ? 'standard'
          : 'custom'
  const reportDepth: ReportDepth = task.reportDepth === 'standard'
    || task.reportDepth === 'deep'
    || task.reportDepth === 'brief'
    ? task.reportDepth
    : 'brief'
  const reportRange = REPORT_DEPTH_RANGES[reportDepth]
  const validSourceIds = new Set(topic.sources.map((source) => source.id))
  const storedPlanMode = storedSearch?.planMode as string | undefined
  const hasExplicitPlanSource = storedPlanMode === 'real' || storedPlanMode === 'mock'
  const needsPlanMigration = Boolean(researchPlan && !hasExplicitPlanSource)
  const restoredResearchPlan = hasExplicitPlanSource ? researchPlan : null
  const planConfirmed = Boolean(restoredResearchPlan?.confirmedAt)
  const poolItems = planConfirmed
    ? storedPoolItems.filter((item) =>
        item.sourceSnapshot
          ? Boolean(
              item.sourceSnapshot.title
              && normalizeHttpUrl(item.sourceSnapshot.url),
            )
          : validSourceIds.has(item.sourceId))
        .map((item) => ({
          ...item,
          dataSource: item.dataSource
            ?? item.sourceSnapshot?.origin
            ?? 'mock',
          sourceSnapshot: item.sourceSnapshot
            ? {
                ...item.sourceSnapshot,
                origin: item.sourceSnapshot.origin ?? item.dataSource ?? 'mock',
              }
            : undefined,
        }))
    : []
  const usableSourceCount = poolItems.filter(
    (item) => item.reviewStatus !== 'irrelevant',
  ).length
  const outlineGenerated = Boolean(
    planConfirmed
      && storedOutlineGenerated
      && usableSourceCount >= MIN_OUTLINE_SOURCE_COUNT,
  )
  const restoredLiveResult = isLiveResearchResult(storedSearch?.result)
    ? {
        ...storedSearch.result,
        dataSource: 'real' as const,
        targetSourceCount: storedSearch.result.targetSourceCount ?? targetSourceCount,
        actualSourceCount: storedSearch.result.actualSourceCount
          ?? storedSearch.result.sources.length,
        deduplicatedSourceCount: storedSearch.result.deduplicatedSourceCount
          ?? storedSearch.result.sources.length,
        validSourceCount: storedSearch.result.validSourceCount
          ?? storedSearch.result.sources.length,
      }
    : null
  const planMode: GenerationMode = storedPlanMode === 'real'
    ? 'real'
    : storedPlanMode === 'mock'
      ? 'mock'
      : needsPlanMigration
        ? 'real'
        : 'idle'
  const planWasInterrupted = storedSearch?.planStatus === 'loading'
    || storedSearch?.requests?.plan.status === 'loading'
  const searchWasInterrupted = storedSearch?.status === 'loading'
    || storedSearch?.requests?.research.status === 'loading'
  const outlineWasInterrupted = storedSearch?.outlineStatus === 'loading'
    || storedSearch?.requests?.outline.status === 'loading'
  const reportWasInterrupted = storedSearch?.reportStatus === 'loading'
    || storedSearch?.requests?.report.status === 'loading'
  const planStatus: GenerationStatus = needsPlanMigration || planWasInterrupted
    ? 'error'
    : storedSearch?.planStatus === 'error'
    ? 'error'
    : planMode === 'real' || planMode === 'mock'
      ? 'success'
      : 'idle'
  const storedSearchMode = storedSearch?.mode as string | undefined
  const storedOutlineMode = storedSearch?.outlineMode as string | undefined
  const storedReportMode = storedSearch?.reportMode as string | undefined
  const searchMode: SearchMode = storedSearchMode === 'real' || storedSearchMode === 'live'
    ? 'real'
    : storedSearchMode === 'mock'
      ? 'mock'
      : 'idle'
  const searchStatus: SearchStatus = searchWasInterrupted || storedSearch?.status === 'error'
    ? 'error'
    : searchMode === 'real' && restoredLiveResult
      ? 'success'
      : searchMode === 'mock'
      ? 'success'
      : 'idle'
  const restoredOutline = isLiveOutline(storedSearch?.liveOutline)
    ? { ...storedSearch.liveOutline, dataSource: 'real' as const }
    : null
  const restoredReport = isLiveReport(storedSearch?.liveReport)
    ? {
        ...storedSearch.liveReport,
        dataSource: 'real' as const,
        reportDepth: storedSearch.liveReport.reportDepth ?? reportDepth,
        targetMinWords: storedSearch.liveReport.targetMinWords ?? reportRange.min,
        targetMaxWords: storedSearch.liveReport.targetMaxWords ?? reportRange.max,
        actualWordCount: storedSearch.liveReport.actualWordCount ?? 0,
      }
    : null
  const eligiblePoolSourceIds = new Set(
    poolItems
      .filter((item) => item.reviewStatus !== 'irrelevant')
      .map((item) => item.sourceId),
  )
  const validRestoredOutline = restoredOutline
    && restoredOutline.outline.sections.every((section) =>
      section.sourceIds.every((sourceId) => eligiblePoolSourceIds.has(sourceId)))
    ? restoredOutline
    : null
  const outlineMode: GenerationMode = (storedOutlineMode === 'real' || storedOutlineMode === 'live')
    && validRestoredOutline
    ? 'real'
    : storedOutlineMode === 'mock'
      ? 'mock'
      : 'idle'
  const outlineStatus: GenerationStatus = outlineWasInterrupted || storedSearch?.outlineStatus === 'error'
    ? 'error'
    : outlineMode === 'real' || outlineMode === 'mock'
      ? 'success'
      : 'idle'
  const reportSourceIds = new Set(
    restoredReport?.report.sections.flatMap((section) =>
      section.paragraphs.flatMap((paragraph) => paragraph.sourceIds)) ?? [],
  )
  const validRestoredReport = restoredReport
    && [...reportSourceIds].every((sourceId) => eligiblePoolSourceIds.has(sourceId))
    ? restoredReport
    : null
  const reportMode: GenerationMode = (storedReportMode === 'real' || storedReportMode === 'live')
    && validRestoredReport
    ? 'real'
    : storedReportMode === 'mock'
      ? 'mock'
      : 'idle'
  const reportStatus: GenerationStatus = reportWasInterrupted || storedSearch?.reportStatus === 'error'
    ? 'error'
    : reportMode === 'real' || reportMode === 'mock'
      ? 'success'
      : 'idle'
  const restoredOutlineGenerated = Boolean(
    outlineGenerated
    && (outlineMode === 'real' ? validRestoredOutline : outlineMode === 'mock'),
  )
  const restoredReportGenerated = Boolean(
    storedReportGenerated
    && restoredOutlineGenerated
    && (reportMode === 'real' ? validRestoredReport : reportMode === 'mock'),
  )

  return {
    task: {
      ...task,
      dataSource: 'real',
      searchDepth,
      targetSourceCount,
      reportDepth,
      reportTargetMinWords: reportRange.min,
      reportTargetMaxWords: reportRange.max,
      topicId: topic.id,
      title: topic.usesPrototypeData ? task.title : topic.topic,
      usesPrototypeData: topic.usesPrototypeData,
      status: planConfirmed ? task.status : 'draft',
    },
    researchPlan: restoredResearchPlan
      ? {
          ...restoredResearchPlan,
          usesPrototypeData: topic.usesPrototypeData,
          dataSource: planMode === 'real' ? 'real' : 'mock',
        }
      : null,
    planMode,
    planStatus,
    planError: needsPlanMigration
      ? '旧版研究计划未记录真实/演示来源，请重新生成真实计划。'
      : planWasInterrupted
        ? '研究计划生成被刷新中断，请重新生成。'
      : planStatus === 'error' && typeof storedSearch?.planError === 'string'
        ? storedSearch.planError
        : null,
    searchMode,
    searchStatus,
    liveResearchResult: restoredLiveResult,
    searchError: searchWasInterrupted
      ? '联网研究被刷新中断，请重新发起。'
      : searchStatus === 'error' && typeof storedSearch?.error === 'string'
        ? storedSearch.error
        : null,
    searchedAt: searchMode === 'real'
      ? storedSearch?.searchedAt ?? restoredLiveResult?.searchedAt ?? null
      : null,
    outlineMode,
    outlineStatus,
    outlineError: outlineWasInterrupted
      ? '大纲生成被刷新中断，请重新生成。'
      : outlineStatus === 'error' && typeof storedSearch?.outlineError === 'string'
        ? storedSearch.outlineError
        : null,
    liveOutline: validRestoredOutline,
    reportMode,
    reportStatus,
    reportError: reportWasInterrupted
      ? '报告生成被刷新中断，请重新生成。'
      : reportStatus === 'error' && typeof storedSearch?.reportError === 'string'
        ? storedSearch.reportError
        : null,
    liveReport: validRestoredReport,
    poolItems,
    outlineGenerated: restoredOutlineGenerated,
    reportGenerated: restoredReportGenerated,
    requests: {
      plan: restoreRequestState(storedSearch?.requests?.plan, planStatus, planWasInterrupted),
      research: restoreRequestState(storedSearch?.requests?.research, searchStatus, searchWasInterrupted),
      outline: restoreRequestState(storedSearch?.requests?.outline, outlineStatus, outlineWasInterrupted),
      report: restoreRequestState(storedSearch?.requests?.report, reportStatus, reportWasInterrupted),
    },
    poolVersion: Number.isSafeInteger(storedSearch?.poolVersion)
      ? Math.max(0, storedSearch?.poolVersion ?? 0)
      : 0,
    outlineVersion: Number.isSafeInteger(storedSearch?.outlineVersion)
      ? Math.max(0, storedSearch?.outlineVersion ?? 0)
      : 0,
    reportConfigVersion: Number.isSafeInteger(storedSearch?.reportConfigVersion)
      ? Math.max(0, storedSearch?.reportConfigVersion ?? 0)
      : 0,
    notice: null,
  }
}

function restorePersistedResearchState(value: unknown): ResearchState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const parsed = value as Partial<PersistedResearchState>
  if (
    parsed.version !== 3
    || !parsed.task
    || typeof parsed.task.id !== 'string'
    || !parsed.task.id
    || typeof parsed.task.topicId !== 'string'
    || typeof parsed.task.title !== 'string'
    || typeof parsed.task.query !== 'string'
    || !Array.isArray(parsed.poolItems)
    || (parsed.researchPlan !== null && !isResearchPlan(parsed.researchPlan))
  ) return null

  return restoreTaskState(
    parsed.task,
    parsed.researchPlan ?? null,
    parsed.poolItems,
    Boolean(parsed.outlineGenerated),
    Boolean(parsed.reportGenerated),
    {
      planMode: parsed.planMode,
      planStatus: parsed.planStatus,
      planError: typeof parsed.planError === 'string' ? parsed.planError : null,
      mode: parsed.searchMode,
      status: parsed.searchStatus,
      result: isLiveResearchResult(parsed.liveResearchResult)
        ? parsed.liveResearchResult
        : null,
      error: typeof parsed.searchError === 'string' ? parsed.searchError : null,
      searchedAt: typeof parsed.searchedAt === 'string' ? parsed.searchedAt : null,
      outlineMode: parsed.outlineMode,
      outlineStatus: parsed.outlineStatus,
      outlineError: typeof parsed.outlineError === 'string' ? parsed.outlineError : null,
      liveOutline: isLiveOutline(parsed.liveOutline) ? parsed.liveOutline : null,
      reportMode: parsed.reportMode,
      reportStatus: parsed.reportStatus,
      reportError: typeof parsed.reportError === 'string' ? parsed.reportError : null,
      liveReport: isLiveReport(parsed.liveReport) ? parsed.liveReport : null,
      requests: parsed.requests,
      poolVersion: parsed.poolVersion,
      outlineVersion: parsed.outlineVersion,
      reportConfigVersion: parsed.reportConfigVersion,
    },
  )
}

function restoreLegacyResearchState(value: unknown): ResearchState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const legacy = value as Partial<LegacyPersistedResearchState>
  if (
    legacy.version !== 2
    || !legacy.task
    || typeof legacy.task.id !== 'string'
    || !legacy.task.id
    || typeof legacy.task.topicId !== 'string'
    || typeof legacy.task.query !== 'string'
    || !Array.isArray(legacy.poolItems)
  ) return null

  const topic = resolveResearchTopic(legacy.task.topicId, legacy.task.query)
  return restoreTaskState(
    {
      ...legacy.task,
      dataSource: 'real' as const,
      title: topic.usesPrototypeData ? legacy.task.query : topic.topic,
    },
    null,
    legacy.poolItems,
    Boolean(legacy.outlineGenerated),
    Boolean(legacy.reportGenerated),
    {
      planMode: 'real',
      planStatus: 'error',
      planError: '旧版任务需要重新生成真实研究计划。',
    },
  )
}

function createEmptyWorkspaceState(): WorkspaceState {
  return {
    activeTaskId: null,
    taskOrder: [],
    tasksById: {},
  }
}

function initWorkspaceState(): WorkspaceState {
  const emptyWorkspace = createEmptyWorkspaceState()

  try {
    const storedWorkspace = window.localStorage.getItem(WORKSPACE_STORAGE_KEY)
    if (storedWorkspace) {
      const parsed = JSON.parse(storedWorkspace) as Partial<PersistedWorkspaceState>
      if (
        parsed.version === 4
        && Array.isArray(parsed.taskOrder)
        && parsed.tasksById
        && typeof parsed.tasksById === 'object'
        && !Array.isArray(parsed.tasksById)
      ) {
        const tasksById: Record<string, ResearchState> = {}
        const taskOrder = parsed.taskOrder.flatMap((taskId) => {
          if (typeof taskId !== 'string' || tasksById[taskId]) return []
          const restored = restorePersistedResearchState(parsed.tasksById?.[taskId])
          if (!restored || restored.task.id !== taskId) return []
          tasksById[taskId] = restored
          return [taskId]
        })
        if (taskOrder.length > 0) {
          const activeTaskId = typeof parsed.activeTaskId === 'string'
            && tasksById[parsed.activeTaskId]
            ? parsed.activeTaskId
            : taskOrder[0]
          return { activeTaskId, taskOrder, tasksById }
        }
      }
    }

    const stored = window.localStorage.getItem(STORAGE_KEY)
    const restored = stored
      ? restorePersistedResearchState(JSON.parse(stored))
      : null
    if (restored) {
      return {
        activeTaskId: restored.task.id,
        taskOrder: [restored.task.id],
        tasksById: { [restored.task.id]: restored },
      }
    }

    const legacyStored = window.localStorage.getItem(LEGACY_STORAGE_KEY)
    const legacy = legacyStored
      ? restoreLegacyResearchState(JSON.parse(legacyStored))
      : null
    if (legacy) {
      return {
        activeTaskId: legacy.task.id,
        taskOrder: [legacy.task.id],
        tasksById: { [legacy.task.id]: legacy },
      }
    }
  } catch {
    return emptyWorkspace
  }

  return emptyWorkspace
}

function updateResearchPlan(
  state: ResearchState,
  update: (plan: ResearchPlan) => ResearchPlan,
): ResearchState {
  if (!state.researchPlan) return state
  return {
    ...state,
    task: { ...state.task, status: 'draft' },
    researchPlan: {
      ...update(state.researchPlan),
      updatedAt: new Date().toISOString(),
      confirmedAt: null,
    },
    searchMode: 'idle',
    searchStatus: 'idle',
    liveResearchResult: null,
    searchError: null,
    searchedAt: null,
    outlineMode: 'idle',
    outlineStatus: 'idle',
    outlineError: null,
    liveOutline: null,
    reportMode: 'idle',
    reportStatus: 'idle',
    reportError: null,
    liveReport: null,
    poolItems: [],
    outlineGenerated: false,
    reportGenerated: false,
    requests: {
      ...state.requests,
      research: createRequestState(),
      outline: createRequestState(),
      report: createRequestState(),
    },
    poolVersion: state.poolVersion + 1,
    outlineVersion: state.outlineVersion + 1,
    notice: null,
  }
}

function setRequestState(
  requests: AsyncRequestStates,
  operation: AsyncResearchOperation,
  update: Partial<AsyncRequestState>,
): AsyncRequestStates {
  return {
    ...requests,
    [operation]: { ...requests[operation], ...update },
  }
}

function isLatestRequest(
  state: ResearchState,
  operation: AsyncResearchOperation,
  requestId: string,
) {
  return state.requests[operation].requestId === requestId
}

function cancelLoadingRequest(request: AsyncRequestState): AsyncRequestState {
  return request.status === 'loading'
    ? createRequestState()
    : request
}

function setFailedRequestState(
  requests: AsyncRequestStates,
  operation: AsyncResearchOperation,
  action: FailureActionMetadata,
): AsyncRequestStates {
  return setRequestState(requests, operation, {
    status: 'error',
    lastErrorCode: action.errorCode ?? 'UNKNOWN_ERROR',
    lastErrorStatus: action.errorStatus ?? null,
    failedAt: action.failedAt ?? new Date().toISOString(),
  })
}

function researchReducer(state: ResearchState, action: ResearchAction): ResearchState {
  switch (action.type) {
    case 'PREPARE_RESEARCH':
      return {
        task: {
          id: action.taskId,
          title: action.standardizedTopic,
          query: action.originalTopic,
          topicId: action.topicId,
          usesPrototypeData: action.usesPrototypeData,
          dataSource: 'real',
          depth: action.depth,
          searchDepth: 'standard',
          targetSourceCount: 12,
          reportDepth: 'brief',
          reportTargetMinWords: REPORT_DEPTH_RANGES.brief.min,
          reportTargetMaxWords: REPORT_DEPTH_RANGES.brief.max,
          status: 'draft',
          createdAt: new Date().toISOString(),
        },
        researchPlan: null,
        planMode: 'real',
        planStatus: 'idle',
        planError: null,
        searchMode: 'idle',
        searchStatus: 'idle',
        liveResearchResult: null,
        searchError: null,
        searchedAt: null,
        outlineMode: 'idle',
        outlineStatus: 'idle',
        outlineError: null,
        liveOutline: null,
        reportMode: 'idle',
        reportStatus: 'idle',
        reportError: null,
        liveReport: null,
        poolItems: [],
        outlineGenerated: false,
        reportGenerated: false,
        requests: createIdleRequestStates(),
        poolVersion: 0,
        outlineVersion: 0,
        reportConfigVersion: 0,
        notice: null,
      }
    case 'START_LIVE_PLAN':
      if (state.task.id !== action.taskId) return state
      return {
        ...state,
        planMode: 'real',
        planStatus: 'loading',
        planError: null,
        requests: setRequestState(state.requests, 'plan', {
          requestId: action.requestId,
          status: 'loading',
          startedAt: action.startedAt,
          lastErrorCode: null,
          lastErrorStatus: null,
          failedAt: null,
        }),
        notice: null,
      }
    case 'LIVE_PLAN_SUCCESS':
      if (
        state.task.id !== action.taskId
        || !isLatestRequest(state, 'plan', action.requestId)
      ) return state
      return {
        ...state,
        task: { ...state.task, status: 'draft' },
        researchPlan: action.researchPlan,
        planMode: 'real',
        planStatus: 'success',
        planError: null,
        searchMode: 'idle',
        searchStatus: 'idle',
        liveResearchResult: null,
        searchError: null,
        searchedAt: null,
        outlineMode: 'idle',
        outlineStatus: 'idle',
        outlineError: null,
        liveOutline: null,
        reportMode: 'idle',
        reportStatus: 'idle',
        reportError: null,
        liveReport: null,
        poolItems: [],
        outlineGenerated: false,
        reportGenerated: false,
        requests: {
          ...state.requests,
          plan: {
            ...state.requests.plan,
            status: 'success',
            lastErrorCode: null,
            lastErrorStatus: null,
            failedAt: null,
          },
          research: createRequestState(),
          outline: createRequestState(),
          report: createRequestState(),
        },
        poolVersion: state.poolVersion + 1,
        outlineVersion: state.outlineVersion + 1,
        notice: '真实研究计划已生成，请基于新计划重新开始研究。',
      }
    case 'LIVE_PLAN_ERROR':
      if (
        state.task.id !== action.taskId
        || !isLatestRequest(state, 'plan', action.requestId)
      ) return state
      return {
        ...state,
        planMode: 'real',
        planStatus: 'error',
        planError: action.message,
        requests: setFailedRequestState(state.requests, 'plan', action),
        notice: null,
      }
    case 'USE_MOCK_PLAN':
      if (state.task.id !== action.taskId) return state
      return {
        ...state,
        researchPlan: action.researchPlan,
        planMode: 'mock',
        planStatus: 'success',
        planError: null,
        requests: {
          ...state.requests,
          plan: createRequestState('success'),
        },
        notice: '已主动切换为演示研究计划。',
      }
    case 'UPDATE_PLAN_SCOPE':
      return updateResearchPlan(state, (plan) => ({ ...plan, scope: action.scope }))
    case 'UPDATE_PLAN_QUESTION':
      return updateResearchPlan(state, (plan) => ({
        ...plan,
        questions: plan.questions.map((question) =>
          question.id === action.questionId
            ? { ...question, text: action.text }
            : question,
        ),
      }))
    case 'ADD_PLAN_QUESTION':
      return updateResearchPlan(state, (plan) => ({
        ...plan,
        questions: [...plan.questions, action.question],
      }))
    case 'REMOVE_PLAN_QUESTION':
      if (!state.researchPlan || state.researchPlan.questions.length <= 1) {
        return { ...state, notice: '研究计划至少需要保留一个核心问题。' }
      }
      return updateResearchPlan(state, (plan) => ({
        ...plan,
        questions: plan.questions.filter(
          (question) => question.id !== action.questionId,
        ),
      }))
    case 'TOGGLE_SOURCE_PREFERENCE':
      return updateResearchPlan(state, (plan) => ({
        ...plan,
        sourcePreferences: plan.sourcePreferences.includes(action.preference)
          ? plan.sourcePreferences.filter((item) => item !== action.preference)
          : [...plan.sourcePreferences, action.preference],
      }))
    case 'SET_SEARCH_CONFIG': {
      const updatedState = updateResearchPlan(state, (plan) => ({
        ...plan,
        estimatedSourceCount: action.targetSourceCount,
      }))
      return {
        ...updatedState,
        task: {
          ...updatedState.task,
          searchDepth: action.depth,
          targetSourceCount: action.targetSourceCount,
        },
      }
    }
    case 'SET_REPORT_DEPTH':
      return {
        ...state,
        task: {
          ...state.task,
          reportDepth: action.depth,
          reportTargetMinWords: action.targetMinWords,
          reportTargetMaxWords: action.targetMaxWords,
        },
        reportMode: 'idle',
        reportStatus: 'idle',
        reportError: null,
        liveReport: null,
        reportGenerated: false,
        requests: {
          ...state.requests,
          report: createRequestState(),
        },
        reportConfigVersion: state.reportConfigVersion + 1,
        notice: null,
      }
    case 'CONFIRM_PLAN':
      if (!state.researchPlan) return state
      return {
        ...state,
        task: { ...state.task, status: 'searching' },
        researchPlan: {
          ...state.researchPlan,
          updatedAt: action.confirmedAt,
          confirmedAt: action.confirmedAt,
        },
        notice: null,
      }
    case 'START_LIVE_SEARCH':
      if (state.task.id !== action.taskId) return state
      return {
        ...state,
        searchMode: 'real',
        searchStatus: 'loading',
        searchError: null,
        requests: setRequestState(state.requests, 'research', {
          requestId: action.requestId,
          status: 'loading',
          startedAt: action.startedAt,
          lastErrorCode: null,
          lastErrorStatus: null,
          failedAt: null,
        }),
        notice: null,
      }
    case 'LIVE_SEARCH_SUCCESS':
      if (
        state.task.id !== action.taskId
        || !isLatestRequest(state, 'research', action.requestId)
        || state.task.targetSourceCount !== action.result.targetSourceCount
      ) return state
      return {
        ...state,
        searchMode: 'real',
        searchStatus: 'success',
        liveResearchResult: action.result,
        searchError: null,
        searchedAt: action.result.searchedAt,
        requests: setRequestState(state.requests, 'research', {
          status: 'success',
          lastErrorCode: null,
          lastErrorStatus: null,
          failedAt: null,
        }),
        notice: `真实联网研究已完成，共返回 ${action.result.sources.length} 条有效来源。`,
      }
    case 'LIVE_SEARCH_ERROR':
      if (
        state.task.id !== action.taskId
        || !isLatestRequest(state, 'research', action.requestId)
        || state.task.targetSourceCount !== action.targetSourceCount
      ) return state
      return {
        ...state,
        searchMode: 'real',
        searchStatus: 'error',
        searchError: action.message,
        requests: setFailedRequestState(state.requests, 'research', action),
        notice: null,
      }
    case 'USE_MOCK_SEARCH':
      return {
        ...state,
        searchMode: 'mock',
        searchStatus: 'success',
        searchError: null,
        searchedAt: null,
        requests: {
          ...state.requests,
          research: createRequestState('success'),
        },
        notice: '已切换为产品原型演示数据。',
      }
    case 'START_LIVE_OUTLINE':
      if (
        state.task.id !== action.taskId
        || state.poolVersion !== action.poolVersion
      ) return state
      return {
        ...state,
        outlineMode: 'real',
        outlineStatus: 'loading',
        outlineError: null,
        liveOutline: state.outlineMode === 'real' ? state.liveOutline : null,
        outlineGenerated: state.outlineMode === 'real' && Boolean(state.liveOutline),
        requests: {
          ...state.requests,
          outline: {
            requestId: action.requestId,
            status: 'loading',
            startedAt: action.startedAt,
            lastErrorCode: null,
            lastErrorStatus: null,
            failedAt: null,
          },
        },
        notice: null,
      }
    case 'LIVE_OUTLINE_SUCCESS':
      if (
        state.task.id !== action.taskId
        || !isLatestRequest(state, 'outline', action.requestId)
        || state.poolVersion !== action.poolVersion
      ) return state
      return {
        ...state,
        task: { ...state.task, status: 'outlined' },
        outlineMode: 'real',
        outlineStatus: 'success',
        outlineError: null,
        liveOutline: action.result,
        outlineGenerated: true,
        reportMode: 'idle',
        reportStatus: 'idle',
        reportError: null,
        liveReport: null,
        reportGenerated: false,
        requests: {
          ...state.requests,
          outline: {
            ...state.requests.outline,
            status: 'success',
            lastErrorCode: null,
            lastErrorStatus: null,
            failedAt: null,
          },
          report: createRequestState(),
        },
        outlineVersion: state.outlineVersion + 1,
        notice: `真实研究大纲已生成，共 ${action.result.outline.sections.length} 个章节。`,
      }
    case 'LIVE_OUTLINE_ERROR':
      if (
        state.task.id !== action.taskId
        || (action.requestId !== undefined
          && !isLatestRequest(state, 'outline', action.requestId))
        || (action.poolVersion !== undefined
          && state.poolVersion !== action.poolVersion)
      ) return state
      return {
        ...state,
        outlineMode: 'real',
        outlineStatus: 'error',
        outlineError: action.message,
        liveOutline: state.outlineMode === 'real' ? state.liveOutline : null,
        outlineGenerated: state.outlineMode === 'real' && Boolean(state.liveOutline),
        requests: setFailedRequestState(state.requests, 'outline', action),
        notice: null,
      }
    case 'USE_MOCK_OUTLINE':
      return {
        ...state,
        task: { ...state.task, status: 'outlined' },
        outlineMode: 'mock',
        outlineStatus: 'success',
        outlineError: null,
        liveOutline: null,
        outlineGenerated: true,
        reportMode: 'idle',
        reportStatus: 'idle',
        reportError: null,
        liveReport: null,
        reportGenerated: false,
        requests: {
          ...state.requests,
          outline: createRequestState('success'),
          report: createRequestState(),
        },
        outlineVersion: state.outlineVersion + 1,
        notice: '已主动切换为演示大纲。',
      }
    case 'START_LIVE_REPORT':
      if (
        state.task.id !== action.taskId
        || state.poolVersion !== action.poolVersion
        || state.outlineVersion !== action.outlineVersion
        || state.reportConfigVersion !== action.reportConfigVersion
      ) return state
      return {
        ...state,
        reportMode: 'real',
        reportStatus: 'loading',
        reportError: null,
        liveReport: state.reportMode === 'real' ? state.liveReport : null,
        reportGenerated: state.reportMode === 'real' && Boolean(state.liveReport),
        requests: setRequestState(state.requests, 'report', {
          requestId: action.requestId,
          status: 'loading',
          startedAt: action.startedAt,
          lastErrorCode: null,
          lastErrorStatus: null,
          failedAt: null,
        }),
        notice: null,
      }
    case 'LIVE_REPORT_SUCCESS':
      if (
        state.task.id !== action.taskId
        || !isLatestRequest(state, 'report', action.requestId)
        || state.poolVersion !== action.poolVersion
        || state.outlineVersion !== action.outlineVersion
        || state.reportConfigVersion !== action.reportConfigVersion
        || state.task.reportDepth !== action.result.reportDepth
        || state.task.reportTargetMinWords !== action.result.targetMinWords
        || state.task.reportTargetMaxWords !== action.result.targetMaxWords
      ) return state
      return {
        ...state,
        task: { ...state.task, status: 'reported' },
        reportMode: 'real',
        reportStatus: 'success',
        reportError: null,
        liveReport: action.result,
        reportGenerated: true,
        requests: setRequestState(state.requests, 'report', {
          status: 'success',
          lastErrorCode: null,
          lastErrorStatus: null,
          failedAt: null,
        }),
        notice: '真实研究报告已生成，引用已绑定资料池来源。',
      }
    case 'LIVE_REPORT_ERROR':
      if (
        state.task.id !== action.taskId
        || (action.requestId !== undefined
          && !isLatestRequest(state, 'report', action.requestId))
        || (action.poolVersion !== undefined
          && state.poolVersion !== action.poolVersion)
        || (action.outlineVersion !== undefined
          && state.outlineVersion !== action.outlineVersion)
        || (action.reportConfigVersion !== undefined
          && state.reportConfigVersion !== action.reportConfigVersion)
        || state.task.reportDepth !== action.reportDepth
      ) return state
      return {
        ...state,
        reportMode: 'real',
        reportStatus: 'error',
        reportError: action.message,
        liveReport: state.reportMode === 'real' ? state.liveReport : null,
        reportGenerated: state.reportMode === 'real' && Boolean(state.liveReport),
        requests: setFailedRequestState(state.requests, 'report', action),
        notice: null,
      }
    case 'USE_MOCK_REPORT':
      return {
        ...state,
        task: { ...state.task, status: 'reported' },
        reportMode: 'mock',
        reportStatus: 'success',
        reportError: null,
        liveReport: null,
        reportGenerated: true,
        requests: {
          ...state.requests,
          report: createRequestState('success'),
        },
        notice: '已主动切换为演示报告。',
      }
    case 'ADD_SOURCE':
      if (
        state.poolItems.some((item) => {
          if (item.sourceId === action.source.id) return true
          const existingUrl = item.sourceSnapshot
            ? normalizeHttpUrl(item.sourceSnapshot.url)
            : null
          const nextUrl = normalizeHttpUrl(action.source.url)
          return Boolean(existingUrl && nextUrl && existingUrl === nextUrl)
        })
      ) {
        return { ...state, notice: '这条来源已经在资料池中。' }
      }
      return {
        ...state,
        task: { ...state.task, status: 'collecting' },
        poolItems: [
          ...state.poolItems,
          {
            sourceId: action.source.id,
            reviewStatus: 'unreviewed',
            note: '',
            addedAt: new Date().toISOString(),
            sourceSnapshot: action.source,
            dataSource: action.source.origin ?? 'mock',
          },
        ],
        outlineStatus: state.outlineStatus === 'loading' ? 'idle' : state.outlineStatus,
        outlineError: state.outlineStatus === 'loading' ? null : state.outlineError,
        reportStatus: state.reportStatus === 'loading' ? 'idle' : state.reportStatus,
        reportError: state.reportStatus === 'loading' ? null : state.reportError,
        outlineGenerated: state.outlineMode === 'real' ? state.outlineGenerated : false,
        reportGenerated: state.reportMode === 'real' ? state.reportGenerated : false,
        requests: {
          ...state.requests,
          outline: cancelLoadingRequest(state.requests.outline),
          report: cancelLoadingRequest(state.requests.report),
        },
        poolVersion: state.poolVersion + 1,
        notice: '来源已加入资料池。',
      }
    case 'SET_REVIEW_STATUS': {
      const currentPoolItem = state.poolItems.find((item) => item.sourceId === action.sourceId)
      if (!currentPoolItem || currentPoolItem.reviewStatus === action.reviewStatus) return state
      const referencedByOutline = state.liveOutline?.outline.sections.some((section) =>
        section.sourceIds.includes(action.sourceId)) ?? false
      const referencedByReport = state.liveReport?.report.sections.some((section) =>
        section.paragraphs.some((paragraph) => paragraph.sourceIds.includes(action.sourceId))) ?? false
      const invalidatesRealOutline = action.reviewStatus === 'irrelevant'
        && referencedByOutline
      const invalidatesRealReport = action.reviewStatus === 'irrelevant'
        && referencedByReport
      return {
        ...state,
        poolItems: state.poolItems.map((item) =>
          item.sourceId === action.sourceId
            ? { ...item, reviewStatus: action.reviewStatus }
            : item,
        ),
        outlineMode: invalidatesRealOutline ? 'idle' : state.outlineMode,
        outlineStatus: invalidatesRealOutline || state.outlineStatus === 'loading'
          ? 'idle'
          : state.outlineStatus,
        outlineError: invalidatesRealOutline || state.outlineStatus === 'loading'
          ? null
          : state.outlineError,
        liveOutline: invalidatesRealOutline ? null : state.liveOutline,
        outlineGenerated: invalidatesRealOutline ? false : state.outlineGenerated,
        reportMode: invalidatesRealOutline || invalidatesRealReport ? 'idle' : state.reportMode,
        reportStatus: invalidatesRealOutline
          || invalidatesRealReport
          || state.reportStatus === 'loading'
          ? 'idle'
          : state.reportStatus,
        reportError: invalidatesRealOutline
          || invalidatesRealReport
          || state.reportStatus === 'loading'
          ? null
          : state.reportError,
        liveReport: invalidatesRealOutline || invalidatesRealReport ? null : state.liveReport,
        reportGenerated: invalidatesRealOutline || invalidatesRealReport ? false : state.reportGenerated,
        requests: {
          ...state.requests,
          outline: cancelLoadingRequest(state.requests.outline),
          report: cancelLoadingRequest(state.requests.report),
        },
        poolVersion: state.poolVersion + 1,
        outlineVersion: invalidatesRealOutline
          ? state.outlineVersion + 1
          : state.outlineVersion,
        notice:
          action.reviewStatus === 'irrelevant' && (referencedByOutline || referencedByReport)
            ? '该来源已被现有大纲或报告引用，内容可能需要重新生成。'
            : action.reviewStatus === 'irrelevant'
            ? '已标记为无关，生成大纲时将自动排除。'
            : '资料判断已更新。',
      }
    }
    case 'UPDATE_NOTE':
      return {
        ...state,
        poolItems: state.poolItems.map((item) =>
          item.sourceId === action.sourceId ? { ...item, note: action.note } : item,
        ),
      }
    case 'SET_NOTICE':
      return { ...state, notice: action.notice }
    default:
      return state
  }
}

function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  if (action.type === 'HYDRATE') return action.workspace
  if (action.type === 'REPLACE_TASK') {
    const exists = Boolean(state.tasksById[action.taskId])
    return {
      ...state,
      activeTaskId: state.activeTaskId ?? action.taskId,
      taskOrder: exists ? state.taskOrder : [action.taskId, ...state.taskOrder],
      tasksById: { ...state.tasksById, [action.taskId]: action.state },
    }
  }
  if (action.type === 'CREATE_TASK') {
    const taskId = action.action.taskId
    const taskState = researchReducer(defaultState, action.action)
    return {
      activeTaskId: taskId,
      taskOrder: [taskId, ...state.taskOrder.filter((id) => id !== taskId)],
      tasksById: { ...state.tasksById, [taskId]: taskState },
    }
  }

  if (action.type === 'SWITCH_TASK') {
    if (!state.tasksById[action.taskId] || state.activeTaskId === action.taskId) {
      return state
    }
    return { ...state, activeTaskId: action.taskId }
  }

  const currentTaskState = state.tasksById[action.taskId]
  if (!currentTaskState) return state
  const nextTaskState = researchReducer(currentTaskState, action.action)
  if (nextTaskState === currentTaskState) return state
  return {
    ...state,
    tasksById: { ...state.tasksById, [action.taskId]: nextTaskState },
  }
}

function persistResearchState(state: ResearchState): PersistedResearchState {
  const interruptedSearch = state.searchStatus === 'loading'
  const interruptedOutline = state.outlineStatus === 'loading'
  const interruptedReport = state.reportStatus === 'loading'
  const persistedAt = new Date().toISOString()
  return {
    version: 3,
    task: state.task,
    researchPlan: state.researchPlan,
    planMode: state.planMode,
    planStatus: state.planStatus === 'loading' ? 'error' : state.planStatus,
    planError: state.planStatus === 'loading'
      ? '研究计划生成被刷新中断，请重新生成。'
      : state.planError,
    searchMode: state.searchMode,
    searchStatus: interruptedSearch ? 'error' : state.searchStatus,
    liveResearchResult: state.liveResearchResult,
    searchError: interruptedSearch
      ? '联网研究被刷新中断，请重新发起。'
      : state.searchError,
    searchedAt: state.searchedAt,
    outlineMode: state.outlineMode,
    outlineStatus: interruptedOutline ? 'error' : state.outlineStatus,
    outlineError: interruptedOutline
      ? '大纲生成被刷新中断，请重新生成。'
      : state.outlineError,
    liveOutline: state.liveOutline,
    reportMode: state.reportMode,
    reportStatus: interruptedReport ? 'error' : state.reportStatus,
    reportError: interruptedReport
      ? '报告生成被刷新中断，请重新生成。'
      : state.reportError,
    liveReport: state.liveReport,
    poolItems: state.poolItems,
    outlineGenerated: state.outlineGenerated,
    reportGenerated: state.reportGenerated,
    requests: Object.fromEntries(
      (Object.keys(state.requests) as AsyncResearchOperation[]).map((operation) => [
        operation,
        {
          requestId: null,
          status: state.requests[operation].status === 'loading'
            ? 'error'
            : state.requests[operation].status,
          startedAt: null,
          lastErrorCode: state.requests[operation].status === 'loading'
            ? 'REQUEST_INTERRUPTED'
            : state.requests[operation].lastErrorCode,
          lastErrorStatus: state.requests[operation].status === 'loading'
            ? null
            : state.requests[operation].lastErrorStatus,
          failedAt: state.requests[operation].status === 'loading'
            ? persistedAt
            : state.requests[operation].failedAt,
        },
      ]),
    ) as AsyncRequestStates,
    poolVersion: state.poolVersion,
    outlineVersion: state.outlineVersion,
    reportConfigVersion: state.reportConfigVersion,
  }
}

function persistWorkspaceState(workspace: WorkspaceState): PersistedWorkspaceState {
  return {
    version: 4,
    activeTaskId: workspace.activeTaskId,
    taskOrder: workspace.taskOrder,
    tasksById: Object.fromEntries(
      workspace.taskOrder.flatMap((taskId) => {
        const taskState = workspace.tasksById[taskId]
        return taskState ? [[taskId, persistResearchState(taskState)]] : []
      }),
    ),
  }
}

interface PoolSource {
  source: Source
  item: ResearchPoolItem
}

interface ResearchContextValue {
  state: ResearchState
  activeTaskId: string | null
  tasks: ResearchState[]
  isHydrating: boolean
  databaseError: string | null
  hasTask: (taskId: string) => boolean
  switchTask: (taskId: string) => boolean
  currentTopic: ResearchTopicData
  sources: Source[]
  poolSources: PoolSource[]
  eligibleSources: Source[]
  eligibleRealSources: Source[]
  outlineSections: OutlineSectionData[]
  reportSections: ReportSectionData[]
  prepareResearch: (
    originalTopic: string,
    selectedTopic: string,
    depth: ResearchDepth,
  ) => Promise<string | null>
  retryResearchPlan: () => Promise<boolean>
  useMockPlan: () => void
  updatePlanScope: (scope: string) => void
  updatePlanQuestion: (questionId: string, text: string) => void
  addPlanQuestion: (text: string) => boolean
  removePlanQuestion: (questionId: string) => void
  toggleSourcePreference: (preference: SourcePreference) => void
  setSearchConfig: (depth: SearchDepth, targetSourceCount: number) => void
  setReportDepth: (depth: ReportDepth) => void
  confirmResearchPlan: () => Promise<boolean>
  startLiveResearch: () => Promise<boolean>
  useMockResearch: () => void
  addSourceToPool: (sourceId: string) => void
  setReviewStatus: (sourceId: string, reviewStatus: ReviewStatus) => void
  updateNote: (sourceId: string, note: string) => void
  generateOutline: () => Promise<boolean>
  useMockOutline: () => void
  generateReport: () => Promise<boolean>
  useMockReport: () => void
  setNotice: (notice: string) => void
  getSource: (sourceId: string) => Source | undefined
  getPoolItem: (sourceId: string) => ResearchPoolItem | undefined
}

const ResearchContext = createContext<ResearchContextValue | null>(null)

export type ResearchTaskPage = 'plan' | 'search' | 'pool' | 'outline' | 'report'

export function getTaskRoute(taskId: string, page: ResearchTaskPage) {
  return `/tasks/${encodeURIComponent(taskId)}/${page}`
}

export function getTaskSourceRoute(taskId: string, sourceId: string) {
  return `/tasks/${encodeURIComponent(taskId)}/sources/${encodeURIComponent(sourceId)}`
}

function filterOutlineBySources(
  sections: OutlineSectionData[],
  sourceIds: Set<string>,
): OutlineSectionData[] {
  return sections.flatMap((section) => {
    const filteredSourceIds = section.sourceIds.filter((id) => sourceIds.has(id))
    const filteredSection = {
      ...section,
      sourceIds: filteredSourceIds,
      children: filterOutlineBySources(section.children, sourceIds),
      evidenceStatus: filteredSourceIds.length >= 2
        ? 'sufficient' as const
        : filteredSourceIds.length === 1
          ? 'limited' as const
          : 'insufficient' as const,
    }
    return filteredSection.sourceIds.length > 0 || filteredSection.children.length > 0
      ? [filteredSection]
      : []
  })
}

function bindReportToSources(
  sections: ReportSectionData[],
  sourceIds: string[],
): ReportSectionData[] {
  if (sourceIds.length === 0) return []
  const availableSourceIds = new Set(sourceIds)
  let replacementIndex = 0

  return sections.map((section) => ({
    ...section,
    paragraphs: section.paragraphs.map((paragraph) => ({
      ...paragraph,
      segments: paragraph.segments.map((segment) => {
        if (segment.type !== 'citation' || availableSourceIds.has(segment.sourceId)) {
          return segment
        }
        const sourceId = sourceIds[replacementIndex % sourceIds.length]
        replacementIndex += 1
        return { type: 'citation' as const, sourceId }
      }),
    })),
  }))
}

function toSelectedSourceRequest(
  source: Source,
  reviewStatus: ReviewStatus,
): SelectedSourceRequest {
  const credibility = reviewStatus === 'trusted'
    ? '可信'
    : reviewStatus === 'questionable'
      ? '存疑'
      : '待评估'
  return {
    id: source.id,
    title: source.title,
    url: source.url,
    publisher: source.publisher,
    type: source.type,
    summary: source.summary,
    keyInsight: source.keyInsight,
    credibility,
    origin: 'real',
  }
}

function createClientRequestId() {
  return typeof crypto.randomUUID === 'function'
    ? `request-${crypto.randomUUID()}`
    : `request-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function getRequestKey(taskId: string, operation: AsyncResearchOperation) {
  return `${taskId}:${operation}`
}

function shouldNavigateAfterRequest(
  activeTaskId: string | null,
  responseTaskId: string,
  latestRequestId: string | undefined,
  responseRequestId: string,
) {
  return activeTaskId === responseTaskId && latestRequestId === responseRequestId
}

function invalidatedOperations(action: ResearchAction): AsyncResearchOperation[] {
  switch (action.type) {
    case 'USE_MOCK_PLAN':
      return ['plan']
    case 'LIVE_PLAN_SUCCESS':
    case 'UPDATE_PLAN_SCOPE':
    case 'UPDATE_PLAN_QUESTION':
    case 'ADD_PLAN_QUESTION':
    case 'REMOVE_PLAN_QUESTION':
    case 'TOGGLE_SOURCE_PREFERENCE':
    case 'SET_SEARCH_CONFIG':
      return ['research', 'outline', 'report']
    case 'USE_MOCK_SEARCH':
      return ['research']
    case 'ADD_SOURCE':
    case 'SET_REVIEW_STATUS':
      return ['outline', 'report']
    case 'USE_MOCK_OUTLINE':
      return ['outline', 'report']
    case 'SET_REPORT_DEPTH':
    case 'USE_MOCK_REPORT':
      return ['report']
    default:
      return []
  }
}

export function ResearchProvider({ children }: { children: ReactNode }) {
  const [workspace, dispatchWorkspace] = useReducer(
    workspaceReducer,
    undefined,
    createEmptyWorkspaceState,
  )
  const [isHydrating, setIsHydrating] = useState(true)
  const [databaseError, setDatabaseError] = useState<string | null>(null)
  const state = workspace.activeTaskId
    ? workspace.tasksById[workspace.activeTaskId] ?? defaultState
    : defaultState
  const tasks = useMemo(
    () => workspace.taskOrder.flatMap((taskId) => {
      const taskState = workspace.tasksById[taskId]
      return taskState ? [taskState] : []
    }),
    [workspace.taskOrder, workspace.tasksById],
  )
  const latestRequestsRef = useRef(new Map<string, string>())
  const mutationChainsRef = useRef(new Map<string, Promise<void>>())
  const workspaceRef = useRef(workspace)
  workspaceRef.current = workspace
  const activeTaskIdRef = useRef(workspace.activeTaskId)
  activeTaskIdRef.current = workspace.activeTaskId
  const dispatchToTask = useCallback((taskId: string, action: ResearchAction) => {
    invalidatedOperations(action).forEach((operation) => {
      latestRequestsRef.current.delete(getRequestKey(taskId, operation))
    })
    dispatchWorkspace({ type: 'UPDATE_TASK', taskId, action })
  }, [])
  const replaceTaskFromPayload = useCallback((taskId: string, payload: unknown) => {
    const restored = restorePersistedResearchState(payload)
    if (!restored || restored.task.id !== taskId) {
      throw new Error('Task response payload is invalid.')
    }
    dispatchWorkspace({ type: 'REPLACE_TASK', taskId, state: restored })
  }, [])
  const enqueueMutation = useCallback((taskId: string, mutation: () => Promise<void>) => {
    const previous = mutationChainsRef.current.get(taskId) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(mutation)
    mutationChainsRef.current.set(taskId, next)
    void next.finally(() => {
      if (mutationChainsRef.current.get(taskId) === next) mutationChainsRef.current.delete(taskId)
    })
    return next
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const hydrate = async () => {
      setIsHydrating(true)
      setDatabaseError(null)
      try {
        const legacyWorkspace = initWorkspaceState()
        const importCompleted = window.localStorage.getItem(V4_IMPORT_COMPLETED_KEY) === 'true'
        if (!importCompleted && legacyWorkspace.taskOrder.length > 0) {
          await requestImportV4(persistWorkspaceState(legacyWorkspace), controller.signal)
          window.localStorage.setItem(V4_IMPORT_COMPLETED_KEY, 'true')
        }
        const { tasks: summaries } = await requestTaskList(controller.signal)
        const details = await Promise.all(
          summaries.map(({ task }) => requestTaskDetail(task.id, controller.signal)),
        )
        if (controller.signal.aborted) return
        const tasksById: Record<string, ResearchState> = {}
        const taskOrder: string[] = []
        for (const detail of details) {
          const restored = restorePersistedResearchState(detail.state)
          if (!restored || tasksById[restored.task.id]) continue
          tasksById[restored.task.id] = restored
          taskOrder.push(restored.task.id)
        }
        const storedActiveTaskId = window.localStorage.getItem(ACTIVE_TASK_STORAGE_KEY)
        const activeTaskId = storedActiveTaskId && tasksById[storedActiveTaskId]
          ? storedActiveTaskId
          : taskOrder[0] ?? null
        activeTaskIdRef.current = activeTaskId
        dispatchWorkspace({ type: 'HYDRATE', workspace: { activeTaskId, taskOrder, tasksById } })
      } catch (error) {
        if (controller.signal.aborted) return
        setDatabaseError(error instanceof Error ? error.message : '任务数据加载失败，请稍后重试。')
      } finally {
        if (!controller.signal.aborted) setIsHydrating(false)
      }
    }
    void hydrate()
    return () => controller.abort()
  }, [])
  const hasTask = useCallback(
    (taskId: string) => Boolean(workspace.tasksById[taskId]),
    [workspace.tasksById],
  )
  const switchTask = useCallback((taskId: string) => {
    if (!workspace.tasksById[taskId]) return false
    activeTaskIdRef.current = taskId
    dispatchWorkspace({ type: 'SWITCH_TASK', taskId })
    void requestTaskDetail(taskId)
      .then((detail) => {
        replaceTaskFromPayload(taskId, detail.state)
        setDatabaseError(null)
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : '任务刷新失败，请稍后重试。'
        setDatabaseError(message)
        dispatchToTask(taskId, { type: 'SET_NOTICE', notice: message })
      })
    return true
  }, [dispatchToTask, replaceTaskFromPayload, workspace.tasksById])
  const currentTopic = useMemo(
    () => resolveResearchTopic(state.task.topicId, state.task.title),
    [state.task.title, state.task.topicId],
  )

  const poolSourceIds = useMemo(
    () => new Set(state.poolItems.map((item) => item.sourceId)),
    [state.poolItems],
  )

  const sources = useMemo(
    () => {
      const activeSources = state.searchMode === 'real' && state.liveResearchResult
        ? state.liveResearchResult.sources
        : state.searchMode === 'mock'
          ? currentTopic.sources.map((source) => ({ ...source, origin: 'mock' as const }))
          : []
      return activeSources.map((source) => ({
      ...source,
      addedToPool: poolSourceIds.has(source.id),
      }))
    },
    [currentTopic.sources, poolSourceIds, state.liveResearchResult, state.searchMode],
  )

  const poolSources = useMemo(
    () => state.poolItems.flatMap((item) => {
      const source = item.sourceSnapshot
        ?? sources.find((candidate) => candidate.id === item.sourceId)
        ?? currentTopic.sources.find((candidate) => candidate.id === item.sourceId)
      return source
        ? [{
            source: {
              ...source,
              addedToPool: true,
              origin: source.origin ?? item.dataSource,
            },
            item,
          }]
        : []
    }),
    [currentTopic.sources, sources, state.poolItems],
  )

  const eligibleSources = useMemo(
    () => poolSources
      .filter(({ item }) => item.reviewStatus !== 'irrelevant')
      .map(({ source }) => source),
    [poolSources],
  )

  const eligibleRealSources = useMemo(
    () => eligibleSources.filter((source) => source.origin === 'real'),
    [eligibleSources],
  )

  const outlineSections = useMemo(() => {
    if (state.outlineMode === 'real' && state.liveOutline) {
      return state.liveOutline.outline.sections
    }
    if (state.outlineMode !== 'mock') return []
    return filterOutlineBySources(
      currentTopic.outline,
      new Set(currentTopic.sources.map((source) => source.id)),
    )
  }, [currentTopic.outline, currentTopic.sources, state.liveOutline, state.outlineMode])

  const reportSections = useMemo(
    () => state.reportMode === 'mock' ? currentTopic.report.sections : [],
    [currentTopic.report.sections, state.reportMode],
  )

  useEffect(() => {
    try {
      if (workspace.activeTaskId) {
        window.localStorage.setItem(ACTIVE_TASK_STORAGE_KEY, workspace.activeTaskId)
      } else {
        window.localStorage.removeItem(ACTIVE_TASK_STORAGE_KEY)
      }
    } catch {
      // The in-memory projection remains usable when localStorage is unavailable.
    }
  }, [workspace.activeTaskId])

  useEffect(() => {
    if (!state.notice) return
    const taskId = state.task.id
    const timer = window.setTimeout(
      () => dispatchToTask(taskId, { type: 'SET_NOTICE', notice: null }),
      2800,
    )
    return () => window.clearTimeout(timer)
  }, [dispatchToTask, state.notice, state.task.id])

  const requestPlanForTask = useCallback(async (
    taskId: string,
    topic: string,
    depth: ResearchDepth,
    usesPrototypeData: boolean,
  ) => {
    const requestId = createClientRequestId()
    const requestKey = getRequestKey(taskId, 'plan')
    const startedAt = new Date().toISOString()
    latestRequestsRef.current.set(requestKey, requestId)
    dispatchToTask(taskId, { type: 'START_LIVE_PLAN', taskId, requestId, startedAt })
    try {
      const response = await requestLivePlan({ taskId, requestId, topic, depth })
      if (latestRequestsRef.current.get(requestKey) !== requestId) return false
      if (response.taskId !== taskId || response.requestId !== requestId) {
        dispatchToTask(taskId, {
          type: 'LIVE_PLAN_ERROR',
          taskId,
          requestId,
          ...createResearchRequestFailure(
            '研究计划返回的任务或请求标识不匹配，请重新生成。',
            'RESPONSE_ID_MISMATCH',
          ),
        })
        return false
      }
      const researchPlan = sanitizeLivePlan(response, usesPrototypeData)
      if (!researchPlan) {
        dispatchToTask(taskId, {
          type: 'LIVE_PLAN_ERROR',
          taskId,
          requestId,
          ...createResearchRequestFailure(
            '研究计划返回结构异常，请重新生成。',
            'MIMO_RESPONSE_INVALID',
          ),
        })
        return false
      }
      dispatchToTask(taskId, {
        type: 'LIVE_PLAN_SUCCESS',
        taskId,
        requestId,
        researchPlan,
      })
      return shouldNavigateAfterRequest(
        activeTaskIdRef.current,
        taskId,
        latestRequestsRef.current.get(requestKey),
        requestId,
      )
    } catch (error) {
      if (latestRequestsRef.current.get(requestKey) !== requestId) return false
      dispatchToTask(taskId, {
        type: 'LIVE_PLAN_ERROR',
        taskId,
        requestId,
        ...getResearchRequestFailure(error),
      })
      return false
    } finally {
      if (latestRequestsRef.current.get(requestKey) === requestId) {
        latestRequestsRef.current.delete(requestKey)
      }
    }
  }, [dispatchToTask])

  const prepareResearch = useCallback(async (
    originalTopic: string,
    selectedTopic: string,
    depth: ResearchDepth,
  ) => {
    const normalizedOriginalTopic = normalizeTopicInput(originalTopic)
    const requestedTopic = normalizeTopicInput(selectedTopic) || normalizedOriginalTopic
    const topic = selectResearchTopic(requestedTopic)
    const standardizedTopic = topic.usesPrototypeData ? requestedTopic : topic.topic
    const taskId = typeof crypto.randomUUID === 'function'
      ? `task-${crypto.randomUUID()}`
      : `task-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    const action: Extract<ResearchAction, { type: 'PREPARE_RESEARCH' }> = {
      type: 'PREPARE_RESEARCH',
      originalTopic: normalizedOriginalTopic,
      standardizedTopic,
      depth,
      topicId: topic.id,
      usesPrototypeData: topic.usesPrototypeData,
      taskId,
    }
    const preparedState = researchReducer(defaultState, action)
    try {
      const created = await requestCreateTask(preparedState.task)
      const restored = restorePersistedResearchState(created.state)
      if (!restored || restored.task.id !== taskId) throw new Error('创建任务返回的数据无效。')
    } catch (error) {
      setDatabaseError(error instanceof Error ? error.message : '任务创建失败，请稍后重试。')
      return null
    }
    setDatabaseError(null)
    activeTaskIdRef.current = taskId
    dispatchWorkspace({ type: 'CREATE_TASK', action })
    void requestPlanForTask(
      taskId,
      standardizedTopic,
      depth,
      topic.usesPrototypeData,
    )
    return taskId
  }, [requestPlanForTask])

  const retryResearchPlan = useCallback(() => requestPlanForTask(
    state.task.id,
    state.task.title,
    state.task.depth,
    state.task.usesPrototypeData,
  ), [
    requestPlanForTask,
    state.task.depth,
    state.task.id,
    state.task.title,
    state.task.usesPrototypeData,
  ])

  const recoverTaskAfterMutationFailure = useCallback(async (taskId: string, error: unknown) => {
    const message = error instanceof Error ? error.message : '任务保存失败，请稍后重试。'
    setDatabaseError(message)
    try {
      const detail = await requestTaskDetail(taskId)
      replaceTaskFromPayload(taskId, detail.state)
      dispatchToTask(taskId, { type: 'SET_NOTICE', notice: message })
    } catch {
      // Keep the visible in-memory state and surface the database failure.
    }
  }, [dispatchToTask, replaceTaskFromPayload])

  const persistPlanMutation = useCallback((action: ResearchAction) => {
    const taskId = state.task.id
    const nextState = researchReducer(state, action)
    if (!nextState.researchPlan) return
    dispatchToTask(taskId, action)
    void enqueueMutation(taskId, async () => {
      try {
        await requestSavePlan(
          taskId,
          nextState.researchPlan!,
          true,
          nextState.task.searchDepth,
          nextState.task.targetSourceCount,
        )
        setDatabaseError(null)
      } catch (error) {
        await recoverTaskAfterMutationFailure(taskId, error)
      }
    })
  }, [dispatchToTask, enqueueMutation, recoverTaskAfterMutationFailure, state])

  const useMockPlan = useCallback(() => {
    const plan = createResearchPlan(currentTopic, state.task.depth)
    const action: ResearchAction = {
      type: 'USE_MOCK_PLAN',
      taskId: state.task.id,
      researchPlan: { ...plan, dataSource: 'mock' },
    }
    dispatchToTask(state.task.id, action)
    void enqueueMutation(state.task.id, async () => {
      try {
        await requestUseMockStage(state.task.id, 'plan', action.researchPlan)
        setDatabaseError(null)
      } catch (error) {
        await recoverTaskAfterMutationFailure(state.task.id, error)
      }
    })
  }, [currentTopic, dispatchToTask, enqueueMutation, recoverTaskAfterMutationFailure, state.task.depth, state.task.id])

  const updatePlanScope = useCallback((scope: string) => {
    persistPlanMutation({ type: 'UPDATE_PLAN_SCOPE', scope })
  }, [persistPlanMutation])

  const updatePlanQuestion = useCallback((questionId: string, text: string) => {
    persistPlanMutation({ type: 'UPDATE_PLAN_QUESTION', questionId, text })
  }, [persistPlanMutation])

  const addPlanQuestion = useCallback((text: string) => {
    if ((state.researchPlan?.questions.length ?? 0) >= 8) {
      dispatchToTask(state.task.id, { type: 'SET_NOTICE', notice: '核心研究问题最多可添加 8 个。' })
      return false
    }
    persistPlanMutation({
      type: 'ADD_PLAN_QUESTION',
      question: {
        id: `question-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        text: text.trim(),
      },
    })
    return true
  }, [dispatchToTask, persistPlanMutation, state.researchPlan?.questions.length, state.task.id])

  const removePlanQuestion = useCallback((questionId: string) => {
    persistPlanMutation({ type: 'REMOVE_PLAN_QUESTION', questionId })
  }, [persistPlanMutation])

  const toggleSourcePreference = useCallback((preference: SourcePreference) => {
    persistPlanMutation({ type: 'TOGGLE_SOURCE_PREFERENCE', preference })
  }, [persistPlanMutation])

  const setSearchConfig = useCallback((
    depth: SearchDepth,
    targetSourceCount: number,
  ) => {
    const normalizedTarget = Math.min(30, Math.max(8, Math.round(targetSourceCount)))
    persistPlanMutation({
      type: 'SET_SEARCH_CONFIG',
      depth,
      targetSourceCount: normalizedTarget,
    })
  }, [persistPlanMutation])

  const setReportDepth = useCallback((depth: ReportDepth) => {
    const range = REPORT_DEPTH_RANGES[depth]
    dispatchToTask(state.task.id, {
      type: 'SET_REPORT_DEPTH',
      depth,
      targetMinWords: range.min,
      targetMaxWords: range.max,
    })
    void enqueueMutation(state.task.id, async () => {
      try {
        await requestReportConfig(state.task.id, depth, range.min, range.max)
        setDatabaseError(null)
      } catch (error) {
        await recoverTaskAfterMutationFailure(state.task.id, error)
      }
    })
  }, [dispatchToTask, enqueueMutation, recoverTaskAfterMutationFailure, state.task.id])

  const confirmResearchPlan = useCallback(async () => {
    const plan = state.researchPlan
    if (!plan) {
      dispatchToTask(state.task.id, { type: 'SET_NOTICE', notice: '请先创建研究计划。' })
      return false
    }
    if (!plan.scope.trim()) {
      dispatchToTask(state.task.id, { type: 'SET_NOTICE', notice: '请补充研究范围后再开始研究。' })
      return false
    }
    if (
      plan.questions.length === 0
      || plan.questions.some((question) => !question.text.trim())
    ) {
      dispatchToTask(state.task.id, { type: 'SET_NOTICE', notice: '请完善所有核心研究问题。' })
      return false
    }
    if (plan.sourcePreferences.length === 0) {
      dispatchToTask(state.task.id, { type: 'SET_NOTICE', notice: '请至少选择一种来源偏好。' })
      return false
    }
    const action: ResearchAction = { type: 'CONFIRM_PLAN', confirmedAt: new Date().toISOString() }
    const nextState = researchReducer(state, action)
    dispatchToTask(state.task.id, action)
    try {
      await enqueueMutation(state.task.id, async () => {
        await requestSavePlan(
          state.task.id,
          nextState.researchPlan!,
          false,
          nextState.task.searchDepth,
          nextState.task.targetSourceCount,
        )
      })
      setDatabaseError(null)
      return true
    } catch (error) {
      await recoverTaskAfterMutationFailure(state.task.id, error)
      return false
    }
  }, [dispatchToTask, enqueueMutation, recoverTaskAfterMutationFailure, state])

  const startLiveResearch = useCallback(async () => {
    const plan = state.researchPlan
    if (!plan?.confirmedAt) {
      dispatchToTask(state.task.id, { type: 'SET_NOTICE', notice: '请先确认研究计划。' })
      return false
    }

    const taskId = state.task.id
    const requestId = createClientRequestId()
    const requestKey = getRequestKey(taskId, 'research')
    const startedAt = new Date().toISOString()
    latestRequestsRef.current.set(requestKey, requestId)
    dispatchToTask(taskId, {
      type: 'START_LIVE_SEARCH',
      taskId,
      requestId,
      startedAt,
    })
    try {
      const response = await requestLiveResearch({
        taskId,
        requestId,
        topic: state.task.title,
        goal: plan.objective,
        sourcePreferences: plan.sourcePreferences,
        targetSourceCount: state.task.targetSourceCount,
      })
      if (latestRequestsRef.current.get(requestKey) !== requestId) return false
      if (response.taskId !== taskId || response.requestId !== requestId) {
        dispatchToTask(taskId, {
          type: 'LIVE_SEARCH_ERROR',
          taskId,
          requestId,
          targetSourceCount: state.task.targetSourceCount,
          ...createResearchRequestFailure(
            '联网研究返回的任务或请求标识不匹配，请重新发起。',
            'RESPONSE_ID_MISMATCH',
          ),
        })
        return false
      }
      const result = sanitizeLiveResearchResult(response, state.task.title)
      if (!result || result.targetSourceCount !== state.task.targetSourceCount) {
        dispatchToTask(taskId, {
          type: 'LIVE_SEARCH_ERROR',
          taskId,
          requestId,
          targetSourceCount: state.task.targetSourceCount,
          ...createResearchRequestFailure(
            '联网研究没有返回可展示的有效来源或结构化结果。',
            'MIMO_RESPONSE_INVALID',
          ),
        })
        return false
      }
      dispatchToTask(taskId, {
        type: 'LIVE_SEARCH_SUCCESS',
        taskId,
        requestId,
        result,
      })
      return shouldNavigateAfterRequest(
        activeTaskIdRef.current,
        taskId,
        latestRequestsRef.current.get(requestKey),
        requestId,
      )
    } catch (error) {
      if (latestRequestsRef.current.get(requestKey) !== requestId) return false
      dispatchToTask(taskId, {
        type: 'LIVE_SEARCH_ERROR',
        taskId,
        requestId,
        targetSourceCount: state.task.targetSourceCount,
        ...getResearchRequestFailure(error),
      })
      return false
    } finally {
      if (latestRequestsRef.current.get(requestKey) === requestId) {
        latestRequestsRef.current.delete(requestKey)
      }
    }
  }, [dispatchToTask, state.researchPlan, state.task.id, state.task.targetSourceCount, state.task.title])

  const useMockResearch = useCallback(() => {
    dispatchToTask(state.task.id, { type: 'USE_MOCK_SEARCH' })
    void enqueueMutation(state.task.id, async () => {
      try {
        await requestUseMockStage(state.task.id, 'research')
        setDatabaseError(null)
      } catch (error) {
        await recoverTaskAfterMutationFailure(state.task.id, error)
      }
    })
  }, [dispatchToTask, enqueueMutation, recoverTaskAfterMutationFailure, state.task.id])

  const addSourceToPool = useCallback((sourceId: string) => {
    const source = sources.find((candidate) => candidate.id === sourceId)
    if (!source) {
      dispatchToTask(state.task.id, { type: 'SET_NOTICE', notice: '当前研究任务中不存在这条来源。' })
      return
    }
    if (!normalizeHttpUrl(source.url)) {
      dispatchToTask(state.task.id, { type: 'SET_NOTICE', notice: '该来源缺少有效 URL，无法加入资料池。' })
      return
    }
    void enqueueMutation(state.task.id, async () => {
      try {
        const detail = await requestAddPoolItem(state.task.id, source)
        replaceTaskFromPayload(state.task.id, detail.state)
        setDatabaseError(null)
      } catch (error) {
        await recoverTaskAfterMutationFailure(state.task.id, error)
      }
    })
  }, [dispatchToTask, enqueueMutation, recoverTaskAfterMutationFailure, replaceTaskFromPayload, sources, state.task.id])

  const setReviewStatus = useCallback(
    (sourceId: string, reviewStatus: ReviewStatus) => {
      dispatchToTask(state.task.id, { type: 'SET_REVIEW_STATUS', sourceId, reviewStatus })
      void enqueueMutation(state.task.id, async () => {
        try {
          await requestUpdatePoolItem(state.task.id, sourceId, { reviewStatus })
          setDatabaseError(null)
        } catch (error) {
          await recoverTaskAfterMutationFailure(state.task.id, error)
        }
      })
    },
    [dispatchToTask, enqueueMutation, recoverTaskAfterMutationFailure, state.task.id],
  )

  const updateNote = useCallback((sourceId: string, note: string) => {
    dispatchToTask(state.task.id, { type: 'UPDATE_NOTE', sourceId, note })
    void enqueueMutation(state.task.id, async () => {
      try {
        await requestUpdatePoolItem(state.task.id, sourceId, { note })
        setDatabaseError(null)
      } catch (error) {
        await recoverTaskAfterMutationFailure(state.task.id, error)
      }
    })
  }, [dispatchToTask, enqueueMutation, recoverTaskAfterMutationFailure, state.task.id])

  const generateOutline = useCallback(async () => {
    const taskId = state.task.id
    if (eligibleRealSources.length < MIN_OUTLINE_SOURCE_COUNT) {
      dispatchToTask(taskId, {
        type: 'LIVE_OUTLINE_ERROR',
        taskId,
        ...createResearchRequestFailure(
          `真实大纲至少需要 ${MIN_OUTLINE_SOURCE_COUNT} 条当前任务资料池中的真实来源。请返回联网搜索补充来源，或主动选择演示大纲。`,
          'INVALID_STATE',
        ),
      })
      return false
    }
    const selectedSources = poolSources
      .filter(({ source, item }) =>
        item.reviewStatus !== 'irrelevant' && source.origin === 'real')
      .map(({ source, item }) => toSelectedSourceRequest(source, item.reviewStatus))
    const allowedSourceIds = new Set(selectedSources.map((source) => source.id))
    const requestId = createClientRequestId()
    const requestKey = getRequestKey(taskId, 'outline')
    const startedAt = new Date().toISOString()
    const poolVersion = state.poolVersion
    latestRequestsRef.current.set(requestKey, requestId)
    dispatchToTask(taskId, {
      type: 'START_LIVE_OUTLINE',
      taskId,
      requestId,
      startedAt,
      poolVersion,
    })
    try {
      const response = await requestLiveOutline({
        taskId,
        requestId,
        topic: state.task.title,
        goal: state.researchPlan?.objective ?? '行业研究',
        sources: selectedSources,
        poolVersion,
      })
      if (latestRequestsRef.current.get(requestKey) !== requestId) return false
      if (response.taskId !== taskId || response.requestId !== requestId) {
        dispatchToTask(taskId, {
          type: 'LIVE_OUTLINE_ERROR',
          taskId,
          requestId,
          poolVersion,
          ...createResearchRequestFailure(
            '大纲返回的任务或请求标识不匹配，请重新生成。',
            'RESPONSE_ID_MISMATCH',
          ),
        })
        return false
      }
      const result = sanitizeLiveOutline(response, allowedSourceIds)
      if (!result) {
        dispatchToTask(taskId, {
          type: 'LIVE_OUTLINE_ERROR',
          taskId,
          requestId,
          poolVersion,
          ...createResearchRequestFailure(
            '大纲返回结构异常或包含未知来源，请重新生成。',
            'MIMO_RESPONSE_INVALID',
          ),
        })
        return false
      }
      dispatchToTask(taskId, {
        type: 'LIVE_OUTLINE_SUCCESS',
        taskId,
        requestId,
        poolVersion,
        result,
      })
      return shouldNavigateAfterRequest(
        activeTaskIdRef.current,
        taskId,
        latestRequestsRef.current.get(requestKey),
        requestId,
      )
    } catch (error) {
      if (latestRequestsRef.current.get(requestKey) !== requestId) return false
      dispatchToTask(taskId, {
        type: 'LIVE_OUTLINE_ERROR',
        taskId,
        requestId,
        poolVersion,
        ...getResearchRequestFailure(error),
      })
      return false
    } finally {
      if (latestRequestsRef.current.get(requestKey) === requestId) {
        latestRequestsRef.current.delete(requestKey)
      }
    }
  }, [dispatchToTask, eligibleRealSources.length, poolSources, state.poolVersion, state.researchPlan?.objective, state.task.id, state.task.title])

  const useMockOutline = useCallback(() => {
    dispatchToTask(state.task.id, { type: 'USE_MOCK_OUTLINE' })
    void enqueueMutation(state.task.id, async () => {
      try {
        await requestUseMockStage(state.task.id, 'outline')
        setDatabaseError(null)
      } catch (error) {
        await recoverTaskAfterMutationFailure(state.task.id, error)
      }
    })
  }, [dispatchToTask, enqueueMutation, recoverTaskAfterMutationFailure, state.task.id])

  const generateReport = useCallback(async () => {
    const taskId = state.task.id
    const reportRange = REPORT_DEPTH_RANGES[state.task.reportDepth]
    const emptySections = state.liveOutline?.outline.sections.filter(
      (section) => section.sourceIds.length === 0,
    ) ?? []
    if (
      !state.outlineGenerated
      || state.outlineMode !== 'real'
      || !state.liveOutline
      || eligibleRealSources.length < MIN_OUTLINE_SOURCE_COUNT
    ) {
      dispatchToTask(taskId, {
        type: 'LIVE_REPORT_ERROR',
        taskId,
        reportDepth: state.task.reportDepth,
        ...createResearchRequestFailure(
          `真实报告需要先使用至少 ${MIN_OUTLINE_SOURCE_COUNT} 条真实来源生成真实大纲。演示报告只能由你主动选择。`,
          'INVALID_STATE',
        ),
      })
      return false
    }
    if (emptySections.length > 0) {
      dispatchToTask(taskId, {
        type: 'LIVE_REPORT_ERROR',
        taskId,
        reportDepth: state.task.reportDepth,
        ...createResearchRequestFailure(
          `以下章节没有关联来源：${emptySections.map((section) => section.title).join('、')}。请补充资料或删除这些章节后再生成。`,
          'INVALID_STATE',
        ),
      })
      return false
    }
    if (eligibleRealSources.length < reportRange.minimumSources) {
      dispatchToTask(taskId, {
        type: 'LIVE_REPORT_ERROR',
        taskId,
        reportDepth: state.task.reportDepth,
        ...createResearchRequestFailure(
          `${reportRange.label}至少需要 ${reportRange.minimumSources} 条有效真实资料；当前只有 ${eligibleRealSources.length} 条。请返回资料池补充来源或选择更短的报告。`,
          'INVALID_STATE',
        ),
      })
      return false
    }
    const selectedSources = poolSources
      .filter(({ source, item }) =>
        item.reviewStatus !== 'irrelevant' && source.origin === 'real')
      .map(({ source, item }) => toSelectedSourceRequest(source, item.reviewStatus))
    const allowedSourceIds = new Set(selectedSources.map((source) => source.id))
    const outlineSourceIds = state.liveOutline.outline.sections.flatMap((section) => section.sourceIds)
    if (outlineSourceIds.some((sourceId) => !allowedSourceIds.has(sourceId))) {
      dispatchToTask(taskId, {
        type: 'LIVE_REPORT_ERROR',
        taskId,
        reportDepth: state.task.reportDepth,
        ...createResearchRequestFailure(
          '大纲引用的来源已被标记为无关，请先重新生成大纲。',
          'INVALID_STATE',
        ),
      })
      return false
    }
    const requestId = createClientRequestId()
    const requestKey = getRequestKey(taskId, 'report')
    const startedAt = new Date().toISOString()
    const poolVersion = state.poolVersion
    const outlineVersion = state.outlineVersion
    const reportConfigVersion = state.reportConfigVersion
    latestRequestsRef.current.set(requestKey, requestId)
    dispatchToTask(taskId, {
      type: 'START_LIVE_REPORT',
      taskId,
      requestId,
      startedAt,
      poolVersion,
      outlineVersion,
      reportConfigVersion,
    })
    try {
      const response = await requestLiveReport({
        taskId,
        requestId,
        topic: state.task.title,
        goal: state.researchPlan?.objective ?? '行业研究',
        outline: {
          title: state.liveOutline.outline.title,
          sections: state.liveOutline.outline.sections.map((section) => ({
            id: section.id,
            title: section.title,
            description: section.description ?? '',
            sourceIds: section.sourceIds,
            evidenceStatus: section.evidenceStatus ?? 'limited',
          })),
        },
        sources: selectedSources,
        reportDepth: state.task.reportDepth,
        targetMinWords: state.task.reportTargetMinWords,
        targetMaxWords: state.task.reportTargetMaxWords,
        poolVersion,
        outlineVersion,
        reportConfigVersion,
      })
      if (latestRequestsRef.current.get(requestKey) !== requestId) return false
      if (response.taskId !== taskId || response.requestId !== requestId) {
        dispatchToTask(taskId, {
          type: 'LIVE_REPORT_ERROR',
          taskId,
          requestId,
          poolVersion,
          outlineVersion,
          reportConfigVersion,
          reportDepth: state.task.reportDepth,
          ...createResearchRequestFailure(
            '报告返回的任务或请求标识不匹配，请重新生成。',
            'RESPONSE_ID_MISMATCH',
          ),
        })
        return false
      }
      const result = sanitizeLiveReport(
        response,
        allowedSourceIds,
        new Set(state.liveOutline.outline.sections.map((section) => section.id)),
      )
      if (
        !result
        || result.reportDepth !== state.task.reportDepth
        || result.targetMinWords !== state.task.reportTargetMinWords
        || result.targetMaxWords !== state.task.reportTargetMaxWords
      ) {
        dispatchToTask(taskId, {
          type: 'LIVE_REPORT_ERROR',
          taskId,
          requestId,
          poolVersion,
          outlineVersion,
          reportConfigVersion,
          reportDepth: state.task.reportDepth,
          ...createResearchRequestFailure(
            '报告返回结构异常或包含未知来源，请重新生成。',
            'MIMO_RESPONSE_INVALID',
          ),
        })
        return false
      }
      dispatchToTask(taskId, {
        type: 'LIVE_REPORT_SUCCESS',
        taskId,
        requestId,
        poolVersion,
        outlineVersion,
        reportConfigVersion,
        result,
      })
      return shouldNavigateAfterRequest(
        activeTaskIdRef.current,
        taskId,
        latestRequestsRef.current.get(requestKey),
        requestId,
      )
    } catch (error) {
      if (latestRequestsRef.current.get(requestKey) !== requestId) return false
      dispatchToTask(taskId, {
        type: 'LIVE_REPORT_ERROR',
        taskId,
        requestId,
        poolVersion,
        outlineVersion,
        reportConfigVersion,
        reportDepth: state.task.reportDepth,
        ...getResearchRequestFailure(error),
      })
      return false
    } finally {
      if (latestRequestsRef.current.get(requestKey) === requestId) {
        latestRequestsRef.current.delete(requestKey)
      }
    }
  }, [dispatchToTask, eligibleRealSources.length, poolSources, state.liveOutline, state.outlineGenerated, state.outlineMode, state.outlineVersion, state.poolVersion, state.reportConfigVersion, state.researchPlan?.objective, state.task.id, state.task.reportDepth, state.task.reportTargetMaxWords, state.task.reportTargetMinWords, state.task.title])

  const useMockReport = useCallback(() => {
    dispatchToTask(state.task.id, { type: 'USE_MOCK_REPORT' })
    void enqueueMutation(state.task.id, async () => {
      try {
        await requestUseMockStage(state.task.id, 'report')
        setDatabaseError(null)
      } catch (error) {
        await recoverTaskAfterMutationFailure(state.task.id, error)
      }
    })
  }, [dispatchToTask, enqueueMutation, recoverTaskAfterMutationFailure, state.task.id])

  const setNotice = useCallback((notice: string) => {
    if (!workspace.activeTaskId) return
    dispatchToTask(workspace.activeTaskId, { type: 'SET_NOTICE', notice })
  }, [dispatchToTask, workspace.activeTaskId])

  const getSource = useCallback(
    (sourceId: string) => {
      const activeSource = sources.find((source) => source.id === sourceId)
      if (activeSource) return activeSource
      const poolItem = state.poolItems.find((item) => item.sourceId === sourceId)
      if (poolItem?.sourceSnapshot) {
        return {
          ...poolItem.sourceSnapshot,
          origin: poolItem.sourceSnapshot.origin ?? poolItem.dataSource,
        }
      }
      const mockSource = currentTopic.sources.find((source) => source.id === sourceId)
      return mockSource ? { ...mockSource, origin: 'mock' as const } : undefined
    },
    [currentTopic.sources, sources, state.poolItems],
  )

  const getPoolItem = useCallback(
    (sourceId: string) => state.poolItems.find((item) => item.sourceId === sourceId),
    [state.poolItems],
  )

  const value = useMemo<ResearchContextValue>(
    () => ({
      state,
      activeTaskId: workspace.activeTaskId,
      tasks,
      isHydrating,
      databaseError,
      hasTask,
      switchTask,
      currentTopic,
      sources,
      poolSources,
      eligibleSources,
      eligibleRealSources,
      outlineSections,
      reportSections,
      prepareResearch,
      retryResearchPlan,
      useMockPlan,
      updatePlanScope,
      updatePlanQuestion,
      addPlanQuestion,
      removePlanQuestion,
      toggleSourcePreference,
      setSearchConfig,
      setReportDepth,
      confirmResearchPlan,
      startLiveResearch,
      useMockResearch,
      addSourceToPool,
      setReviewStatus,
      updateNote,
      generateOutline,
      useMockOutline,
      generateReport,
      useMockReport,
      setNotice,
      getSource,
      getPoolItem,
    }),
    [
      state,
      workspace.activeTaskId,
      tasks,
      isHydrating,
      databaseError,
      hasTask,
      switchTask,
      currentTopic,
      sources,
      poolSources,
      eligibleSources,
      eligibleRealSources,
      outlineSections,
      reportSections,
      prepareResearch,
      retryResearchPlan,
      useMockPlan,
      updatePlanScope,
      updatePlanQuestion,
      addPlanQuestion,
      removePlanQuestion,
      toggleSourcePreference,
      setSearchConfig,
      setReportDepth,
      confirmResearchPlan,
      startLiveResearch,
      useMockResearch,
      addSourceToPool,
      setReviewStatus,
      updateNote,
      generateOutline,
      useMockOutline,
      generateReport,
      useMockReport,
      setNotice,
      getSource,
      getPoolItem,
    ],
  )

  return <ResearchContext.Provider value={value}>{children}</ResearchContext.Provider>
}

export function useResearch() {
  const context = useContext(ResearchContext)
  if (!context) throw new Error('useResearch must be used inside ResearchProvider')
  return context
}

export const researchWorkspaceTestApi = {
  initWorkspaceState,
  persistWorkspaceState,
  shouldNavigateAfterRequest,
  workspaceReducer,
}

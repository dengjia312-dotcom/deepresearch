import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react'
import {
  defaultResearchTopic,
  normalizeTopicInput,
  resolveResearchTopic,
  selectResearchTopic,
} from '../data/researchTopics'
import { createResearchPlan } from '../data/researchPlans'
import type {
  OutlineSectionData,
  ReportSectionData,
  ResearchDepth,
  ResearchPlan,
  ResearchPoolItem,
  ResearchQuestion,
  ResearchTask,
  ResearchTopicData,
  ReviewStatus,
  Source,
  SourcePreference,
} from '../types'

interface ResearchState {
  task: ResearchTask
  researchPlan: ResearchPlan | null
  poolItems: ResearchPoolItem[]
  outlineGenerated: boolean
  reportGenerated: boolean
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
      researchPlan: ResearchPlan
    }
  | { type: 'UPDATE_PLAN_SCOPE'; scope: string }
  | { type: 'UPDATE_PLAN_QUESTION'; questionId: string; text: string }
  | { type: 'ADD_PLAN_QUESTION'; question: ResearchQuestion }
  | { type: 'REMOVE_PLAN_QUESTION'; questionId: string }
  | { type: 'TOGGLE_SOURCE_PREFERENCE'; preference: SourcePreference }
  | { type: 'CONFIRM_PLAN'; confirmedAt: string }
  | { type: 'ADD_SOURCE'; sourceId: string }
  | { type: 'SET_REVIEW_STATUS'; sourceId: string; reviewStatus: ReviewStatus }
  | { type: 'UPDATE_NOTE'; sourceId: string; note: string }
  | { type: 'GENERATE_OUTLINE' }
  | { type: 'GENERATE_REPORT' }
  | { type: 'SET_NOTICE'; notice: string | null }

const STORAGE_KEY = 'ai-research-workspace-v3'
const LEGACY_STORAGE_KEY = 'ai-research-workspace-v2'

const defaultTask: ResearchTask = {
  id: 'demo-low-code',
  title: defaultResearchTopic.topic,
  query: defaultResearchTopic.topic,
  topicId: defaultResearchTopic.id,
  usesPrototypeData: false,
  depth: 'deep',
  status: 'draft',
  createdAt: '2024-04-18T10:23:00.000Z',
}

const defaultState: ResearchState = {
  task: defaultTask,
  researchPlan: null,
  poolItems: [],
  outlineGenerated: false,
  reportGenerated: false,
  notice: null,
}

interface PersistedResearchState {
  version: 3
  task: ResearchTask
  researchPlan: ResearchPlan | null
  poolItems: ResearchPoolItem[]
  outlineGenerated: boolean
  reportGenerated: boolean
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
    && typeof candidate.updatedAt === 'string'
    && (candidate.confirmedAt === null || typeof candidate.confirmedAt === 'string')
  )
}

function restoreTaskState(
  task: ResearchTask,
  researchPlan: ResearchPlan | null,
  storedPoolItems: ResearchPoolItem[],
  storedOutlineGenerated: boolean,
  storedReportGenerated: boolean,
): ResearchState {
  const topic = resolveResearchTopic(task.topicId, task.title || task.query)
  const validSourceIds = new Set(topic.sources.map((source) => source.id))
  const planConfirmed = Boolean(researchPlan?.confirmedAt)
  const poolItems = planConfirmed
    ? storedPoolItems.filter((item) => validSourceIds.has(item.sourceId))
    : []
  const hasUsableSource = poolItems.some((item) => item.reviewStatus !== 'irrelevant')
  const outlineGenerated = Boolean(
    planConfirmed && storedOutlineGenerated && hasUsableSource,
  )

  return {
    task: {
      ...task,
      topicId: topic.id,
      title: topic.usesPrototypeData ? task.title : topic.topic,
      usesPrototypeData: topic.usesPrototypeData,
      status: planConfirmed ? task.status : 'draft',
    },
    researchPlan: researchPlan
      ? { ...researchPlan, usesPrototypeData: topic.usesPrototypeData }
      : null,
    poolItems,
    outlineGenerated,
    reportGenerated: Boolean(storedReportGenerated && outlineGenerated),
    notice: null,
  }
}

function initState(): ResearchState {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<PersistedResearchState>
      if (
        parsed.version === 3
        && parsed.task
        && typeof parsed.task.topicId === 'string'
        && typeof parsed.task.title === 'string'
        && typeof parsed.task.query === 'string'
        && Array.isArray(parsed.poolItems)
        && (parsed.researchPlan === null || isResearchPlan(parsed.researchPlan))
      ) {
        return restoreTaskState(
          parsed.task,
          parsed.researchPlan ?? null,
          parsed.poolItems,
          Boolean(parsed.outlineGenerated),
          Boolean(parsed.reportGenerated),
        )
      }
    }

    const legacyStored = window.localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!legacyStored) return defaultState
    const legacy = JSON.parse(legacyStored) as Partial<LegacyPersistedResearchState>
    if (
      legacy.version !== 2
      || !legacy.task
      || typeof legacy.task.topicId !== 'string'
      || typeof legacy.task.query !== 'string'
      || !Array.isArray(legacy.poolItems)
    ) {
      return defaultState
    }

    const topic = resolveResearchTopic(legacy.task.topicId, legacy.task.query)
    const researchPlan = createResearchPlan(topic, legacy.task.depth)
    researchPlan.confirmedAt = legacy.task.createdAt
    const standardizedTask = {
      ...legacy.task,
      title: topic.usesPrototypeData ? legacy.task.query : topic.topic,
    }
    return restoreTaskState(
      standardizedTask,
      researchPlan,
      legacy.poolItems,
      Boolean(legacy.outlineGenerated),
      Boolean(legacy.reportGenerated),
    )
  } catch {
    return defaultState
  }
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
    poolItems: [],
    outlineGenerated: false,
    reportGenerated: false,
    notice: null,
  }
}

function researchReducer(state: ResearchState, action: ResearchAction): ResearchState {
  switch (action.type) {
    case 'PREPARE_RESEARCH':
      return {
        task: {
          id: `task-${Date.now()}`,
          title: action.standardizedTopic,
          query: action.originalTopic,
          topicId: action.topicId,
          usesPrototypeData: action.usesPrototypeData,
          depth: action.depth,
          status: 'draft',
          createdAt: new Date().toISOString(),
        },
        researchPlan: action.researchPlan,
        poolItems: [],
        outlineGenerated: false,
        reportGenerated: false,
        notice: null,
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
    case 'ADD_SOURCE':
      if (state.poolItems.some((item) => item.sourceId === action.sourceId)) {
        return { ...state, notice: '这条来源已经在资料池中。' }
      }
      return {
        ...state,
        task: { ...state.task, status: 'collecting' },
        poolItems: [
          ...state.poolItems,
          {
            sourceId: action.sourceId,
            reviewStatus: 'unreviewed',
            note: '',
            addedAt: new Date().toISOString(),
          },
        ],
        outlineGenerated: false,
        reportGenerated: false,
        notice: '来源已加入资料池。',
      }
    case 'SET_REVIEW_STATUS':
      return {
        ...state,
        poolItems: state.poolItems.map((item) =>
          item.sourceId === action.sourceId
            ? { ...item, reviewStatus: action.reviewStatus }
            : item,
        ),
        outlineGenerated: false,
        reportGenerated: false,
        notice:
          action.reviewStatus === 'irrelevant'
            ? '已标记为无关，生成大纲时将自动排除。'
            : '资料判断已更新。',
      }
    case 'UPDATE_NOTE':
      return {
        ...state,
        poolItems: state.poolItems.map((item) =>
          item.sourceId === action.sourceId ? { ...item, note: action.note } : item,
        ),
      }
    case 'GENERATE_OUTLINE':
      return {
        ...state,
        task: { ...state.task, status: 'outlined' },
        outlineGenerated: true,
        reportGenerated: false,
        notice: '研究大纲已根据当前资料池生成。',
      }
    case 'GENERATE_REPORT':
      return {
        ...state,
        task: { ...state.task, status: 'reported' },
        reportGenerated: true,
        notice: '研究报告已生成，引用关系已自动建立。',
      }
    case 'SET_NOTICE':
      return { ...state, notice: action.notice }
    default:
      return state
  }
}

interface PoolSource {
  source: Source
  item: ResearchPoolItem
}

interface ResearchContextValue {
  state: ResearchState
  currentTopic: ResearchTopicData
  sources: Source[]
  poolSources: PoolSource[]
  eligibleSources: Source[]
  outlineSections: OutlineSectionData[]
  reportSections: ReportSectionData[]
  prepareResearch: (
    originalTopic: string,
    selectedTopic: string,
    depth: ResearchDepth,
  ) => void
  updatePlanScope: (scope: string) => void
  updatePlanQuestion: (questionId: string, text: string) => void
  addPlanQuestion: (text: string) => boolean
  removePlanQuestion: (questionId: string) => void
  toggleSourcePreference: (preference: SourcePreference) => void
  confirmResearchPlan: () => boolean
  addSourceToPool: (sourceId: string) => void
  setReviewStatus: (sourceId: string, reviewStatus: ReviewStatus) => void
  updateNote: (sourceId: string, note: string) => void
  generateOutline: () => boolean
  generateReport: () => boolean
  setNotice: (notice: string) => void
  getSource: (sourceId: string) => Source | undefined
  getPoolItem: (sourceId: string) => ResearchPoolItem | undefined
}

const ResearchContext = createContext<ResearchContextValue | null>(null)

function filterOutlineBySources(
  sections: OutlineSectionData[],
  sourceIds: Set<string>,
): OutlineSectionData[] {
  return sections.flatMap((section) => {
    const filteredSection = {
      ...section,
      sourceIds: section.sourceIds.filter((id) => sourceIds.has(id)),
      children: filterOutlineBySources(section.children, sourceIds),
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

export function ResearchProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(researchReducer, defaultState, initState)

  const currentTopic = useMemo(
    () => resolveResearchTopic(state.task.topicId, state.task.title),
    [state.task.title, state.task.topicId],
  )

  const poolSourceIds = useMemo(
    () => new Set(state.poolItems.map((item) => item.sourceId)),
    [state.poolItems],
  )

  const sources = useMemo(
    () => currentTopic.sources.map((source) => ({
      ...source,
      addedToPool: poolSourceIds.has(source.id),
    })),
    [currentTopic.sources, poolSourceIds],
  )

  const poolSources = useMemo(
    () => state.poolItems.flatMap((item) => {
      const source = sources.find((candidate) => candidate.id === item.sourceId)
      return source ? [{ source, item }] : []
    }),
    [sources, state.poolItems],
  )

  const eligibleSources = useMemo(
    () => poolSources
      .filter(({ item }) => item.reviewStatus !== 'irrelevant')
      .map(({ source }) => source),
    [poolSources],
  )

  const outlineSections = useMemo(
    () => filterOutlineBySources(
      currentTopic.outline,
      new Set(eligibleSources.map((source) => source.id)),
    ),
    [currentTopic.outline, eligibleSources],
  )

  const reportSourceIds = useMemo(
    () => eligibleSources.slice(0, 4).map((source) => source.id),
    [eligibleSources],
  )

  const reportSections = useMemo(
    () => bindReportToSources(currentTopic.report.sections, reportSourceIds),
    [currentTopic.report.sections, reportSourceIds],
  )

  useEffect(() => {
    const persisted: PersistedResearchState = {
      version: 3,
      task: state.task,
      researchPlan: state.researchPlan,
      poolItems: state.poolItems,
      outlineGenerated: state.outlineGenerated,
      reportGenerated: state.reportGenerated,
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted))
    } catch {
      // The prototype remains usable when storage is unavailable or full.
    }
  }, [
    state.task,
    state.researchPlan,
    state.poolItems,
    state.outlineGenerated,
    state.reportGenerated,
  ])

  useEffect(() => {
    if (!state.notice) return
    const timer = window.setTimeout(
      () => dispatch({ type: 'SET_NOTICE', notice: null }),
      2800,
    )
    return () => window.clearTimeout(timer)
  }, [state.notice])

  const prepareResearch = useCallback((
    originalTopic: string,
    selectedTopic: string,
    depth: ResearchDepth,
  ) => {
    const normalizedOriginalTopic = normalizeTopicInput(originalTopic)
    const requestedTopic = normalizeTopicInput(selectedTopic) || normalizedOriginalTopic
    const topic = selectResearchTopic(requestedTopic)
    const standardizedTopic = topic.usesPrototypeData ? requestedTopic : topic.topic
    dispatch({
      type: 'PREPARE_RESEARCH',
      originalTopic: normalizedOriginalTopic,
      standardizedTopic,
      depth,
      topicId: topic.id,
      usesPrototypeData: topic.usesPrototypeData,
      researchPlan: createResearchPlan(topic, depth),
    })
  }, [])

  const updatePlanScope = useCallback((scope: string) => {
    dispatch({ type: 'UPDATE_PLAN_SCOPE', scope })
  }, [])

  const updatePlanQuestion = useCallback((questionId: string, text: string) => {
    dispatch({ type: 'UPDATE_PLAN_QUESTION', questionId, text })
  }, [])

  const addPlanQuestion = useCallback((text: string) => {
    if ((state.researchPlan?.questions.length ?? 0) >= 8) {
      dispatch({ type: 'SET_NOTICE', notice: '核心研究问题最多可添加 8 个。' })
      return false
    }
    dispatch({
      type: 'ADD_PLAN_QUESTION',
      question: {
        id: `question-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        text: text.trim(),
      },
    })
    return true
  }, [state.researchPlan?.questions.length])

  const removePlanQuestion = useCallback((questionId: string) => {
    dispatch({ type: 'REMOVE_PLAN_QUESTION', questionId })
  }, [])

  const toggleSourcePreference = useCallback((preference: SourcePreference) => {
    dispatch({ type: 'TOGGLE_SOURCE_PREFERENCE', preference })
  }, [])

  const confirmResearchPlan = useCallback(() => {
    const plan = state.researchPlan
    if (!plan) {
      dispatch({ type: 'SET_NOTICE', notice: '请先创建研究计划。' })
      return false
    }
    if (!plan.scope.trim()) {
      dispatch({ type: 'SET_NOTICE', notice: '请补充研究范围后再开始研究。' })
      return false
    }
    if (
      plan.questions.length === 0
      || plan.questions.some((question) => !question.text.trim())
    ) {
      dispatch({ type: 'SET_NOTICE', notice: '请完善所有核心研究问题。' })
      return false
    }
    if (plan.sourcePreferences.length === 0) {
      dispatch({ type: 'SET_NOTICE', notice: '请至少选择一种来源偏好。' })
      return false
    }
    dispatch({ type: 'CONFIRM_PLAN', confirmedAt: new Date().toISOString() })
    return true
  }, [state.researchPlan])

  const addSourceToPool = useCallback((sourceId: string) => {
    if (!sources.some((source) => source.id === sourceId)) {
      dispatch({ type: 'SET_NOTICE', notice: '当前研究任务中不存在这条来源。' })
      return
    }
    dispatch({ type: 'ADD_SOURCE', sourceId })
  }, [sources])

  const setReviewStatus = useCallback(
    (sourceId: string, reviewStatus: ReviewStatus) => {
      dispatch({ type: 'SET_REVIEW_STATUS', sourceId, reviewStatus })
    },
    [],
  )

  const updateNote = useCallback((sourceId: string, note: string) => {
    dispatch({ type: 'UPDATE_NOTE', sourceId, note })
  }, [])

  const generateOutline = useCallback(() => {
    if (eligibleSources.length === 0) {
      dispatch({ type: 'SET_NOTICE', notice: '请先向资料池加入至少一条可用来源。' })
      return false
    }
    dispatch({ type: 'GENERATE_OUTLINE' })
    return true
  }, [eligibleSources.length])

  const generateReport = useCallback(() => {
    if (!state.outlineGenerated || eligibleSources.length === 0) {
      dispatch({ type: 'SET_NOTICE', notice: '请先生成包含可用来源的研究大纲。' })
      return false
    }
    dispatch({ type: 'GENERATE_REPORT' })
    return true
  }, [eligibleSources.length, state.outlineGenerated])

  const setNotice = useCallback((notice: string) => {
    dispatch({ type: 'SET_NOTICE', notice })
  }, [])

  const getSource = useCallback(
    (sourceId: string) => sources.find((source) => source.id === sourceId),
    [sources],
  )

  const getPoolItem = useCallback(
    (sourceId: string) => state.poolItems.find((item) => item.sourceId === sourceId),
    [state.poolItems],
  )

  const value = useMemo<ResearchContextValue>(
    () => ({
      state,
      currentTopic,
      sources,
      poolSources,
      eligibleSources,
      outlineSections,
      reportSections,
      prepareResearch,
      updatePlanScope,
      updatePlanQuestion,
      addPlanQuestion,
      removePlanQuestion,
      toggleSourcePreference,
      confirmResearchPlan,
      addSourceToPool,
      setReviewStatus,
      updateNote,
      generateOutline,
      generateReport,
      setNotice,
      getSource,
      getPoolItem,
    }),
    [
      state,
      currentTopic,
      sources,
      poolSources,
      eligibleSources,
      outlineSections,
      reportSections,
      prepareResearch,
      updatePlanScope,
      updatePlanQuestion,
      addPlanQuestion,
      removePlanQuestion,
      toggleSourcePreference,
      confirmResearchPlan,
      addSourceToPool,
      setReviewStatus,
      updateNote,
      generateOutline,
      generateReport,
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

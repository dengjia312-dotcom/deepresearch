import type {
  ResearchIntent,
  ResearchRequest,
  ResearchStrategy,
  SearchQuery,
} from '../types/research'
import { asString, isRecord } from './serviceUtils'

const MAX_SCOPE_ITEMS = 8
const MAX_EXCLUDED_MEANINGS = 8
const MAX_KEY_CONCEPTS = 12
const MIN_QUERY_COUNT = 2
const MAX_QUERY_COUNT = 4

interface StrategySeed {
  topic: string
  goal: string
  scope?: string
}

function uniqueStrings(value: unknown, maximum: number, maxLength = 120) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map(asString)
    .map((item) => item.trim())
    .filter((item) => item && item.length <= maxLength))]
    .slice(0, maximum)
}

function normalizeQueries(value: unknown): SearchQuery[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const queries = value.flatMap<SearchQuery>((candidate, index) => {
    if (!isRecord(candidate)) return []
    const query = asString(candidate.query).trim()
    const purpose = asString(candidate.purpose).trim()
    if (!query || query.length > 160 || !purpose || purpose.length > 80) return []
    const normalized = query.toLocaleLowerCase()
    if (seen.has(normalized)) return []
    seen.add(normalized)
    const rawPriority = Number(candidate.priority)
    const priority = Number.isInteger(rawPriority) && rawPriority > 0
      ? rawPriority
      : index + 1
    return [{
      id: asString(candidate.id).trim() || `query-${index + 1}`,
      query,
      purpose,
      priority,
    }]
  })
  return queries
    .sort((left, right) => left.priority - right.priority)
    .slice(0, MAX_QUERY_COUNT)
    .map((query, index) => ({ ...query, id: `query-${index + 1}`, priority: index + 1 }))
}

export function parseResearchStrategy(value: unknown): ResearchStrategy | null {
  if (!isRecord(value)) return null
  const intentValue = isRecord(value.researchIntent)
    ? value.researchIntent
    : isRecord(value.intent)
      ? value.intent
      : null
  const queryPlanValue = isRecord(value.queryPlan) ? value.queryPlan : null
  if (!intentValue || !queryPlanValue) return null

  const normalizedTopic = asString(intentValue.normalizedTopic).trim()
  const researchObject = asString(intentValue.researchObject).trim()
  const userIntent = asString(intentValue.userIntent).trim()
  const scope = uniqueStrings(intentValue.scope, MAX_SCOPE_ITEMS)
  const excludedMeanings = uniqueStrings(
    intentValue.excludedMeanings,
    MAX_EXCLUDED_MEANINGS,
  )
  const keyConcepts = uniqueStrings(intentValue.keyConcepts, MAX_KEY_CONCEPTS, 80)
  const queries = normalizeQueries(queryPlanValue.queries).filter((query) => {
    const text = query.query.toLocaleLowerCase()
    const hasExcludedMeaning = excludedMeanings.some((meaning) => (
      text.includes(meaning.toLocaleLowerCase())
    ))
    const hasKeyConcept = keyConcepts.some((concept) => (
      text.includes(concept.toLocaleLowerCase())
    ))
    return !hasExcludedMeaning || hasKeyConcept
  })
  const purposeCount = new Set(
    queries.map((query) => query.purpose.toLocaleLowerCase()),
  ).size
  if (
    !normalizedTopic || normalizedTopic.length > 300
    || !researchObject || researchObject.length > 300
    || !userIntent || userIntent.length > 500
    || scope.length === 0
    || keyConcepts.length === 0
    || typeof intentValue.ambiguityDetected !== 'boolean'
    || queries.length < MIN_QUERY_COUNT
    || purposeCount < Math.min(3, queries.length)
  ) return null

  return {
    intent: {
      normalizedTopic,
      researchObject,
      userIntent,
      scope,
      excludedMeanings,
      keyConcepts,
      ambiguityDetected: intentValue.ambiguityDetected,
    },
    queryPlan: { queries },
  }
}

function includesAny(text: string, words: string[]) {
  return words.some((word) => text.includes(word))
}

function designStrategy(seed: StrategySeed): ResearchStrategy {
  return {
    intent: {
      normalizedTopic: '环境设计专业与空间设计行业未来发展',
      researchObject: '环境设计专业及其对应的室内、景观与空间设计行业',
      userIntent: seed.goal || '分析专业发展方向、就业前景、行业趋势和未来能力要求',
      scope: ['环境设计专业', '室内设计', '景观设计', '空间设计', '就业市场', 'AI与数字化'],
      excludedMeanings: ['生态环境', '环境科学', '环境治理', '污染治理', '生态安全', '环保工程'],
      keyConcepts: ['环境设计专业', '室内设计', '景观设计', '空间设计', '设计行业', '就业', 'AI', '数字化'],
      ambiguityDetected: true,
    },
    queryPlan: { queries: [
      { id: 'query-1', query: '环境设计专业 就业前景 行业发展趋势', purpose: '就业与行业趋势', priority: 1 },
      { id: 'query-2', query: '室内设计 景观设计 空间设计 未来趋势', purpose: '专业方向与垂直行业', priority: 2 },
      { id: 'query-3', query: 'AI 数字化 环境设计行业 设计师', purpose: '技术变化', priority: 3 },
      { id: 'query-4', query: '环境设计专业 招聘 岗位 能力要求', purpose: '岗位与专业能力', priority: 4 },
    ] },
  }
}

function appleStrategy(seed: StrategySeed): ResearchStrategy {
  return {
    intent: {
      normalizedTopic: 'Apple公司产品生态与AI战略发展',
      researchObject: 'Apple公司及其产品、服务与开发者生态',
      userIntent: seed.goal,
      scope: ['产品生态', 'AI战略', '开发者生态', '市场与商业模式'],
      excludedMeanings: ['水果苹果', '苹果种植', '苹果营养'],
      keyConcepts: ['Apple公司', '产品生态', '人工智能', '开发者', '商业模式'],
      ambiguityDetected: true,
    },
    queryPlan: { queries: [
      { id: 'query-1', query: 'Apple公司 产品生态 发展战略', purpose: '产品生态', priority: 1 },
      { id: 'query-2', query: 'Apple Intelligence AI战略 技术布局', purpose: 'AI与技术', priority: 2 },
      { id: 'query-3', query: 'Apple 开发者生态 服务业务', purpose: '开发者与服务', priority: 3 },
      { id: 'query-4', query: 'Apple 市场竞争 商业模式 趋势', purpose: '市场与商业模式', priority: 4 },
    ] },
  }
}

function pythonStrategy(seed: StrategySeed): ResearchStrategy {
  return {
    intent: {
      normalizedTopic: 'Python编程语言与开发者生态未来发展',
      researchObject: 'Python编程语言、工具链及开发者生态',
      userIntent: seed.goal,
      scope: ['开发者生态', 'AI编程', '工具链', '应用趋势'],
      excludedMeanings: ['蟒蛇', '蛇类动物', '爬行动物'],
      keyConcepts: ['Python编程语言', '开发者', 'AI编程', '软件生态', '工具链'],
      ambiguityDetected: true,
    },
    queryPlan: { queries: [
      { id: 'query-1', query: 'Python编程语言 开发者生态 发展趋势', purpose: '开发者生态', priority: 1 },
      { id: 'query-2', query: 'Python AI编程 人工智能 工具链', purpose: 'AI与技术', priority: 2 },
      { id: 'query-3', query: 'Python 企业应用 数据科学 未来', purpose: '应用场景', priority: 3 },
      { id: 'query-4', query: 'Python 社区 教育 人才需求', purpose: '社区与人才', priority: 4 },
    ] },
  }
}

export function createFallbackResearchStrategy(seed: StrategySeed): ResearchStrategy {
  const combined = `${seed.topic} ${seed.goal} ${seed.scope ?? ''}`.toLocaleLowerCase()
  if (combined.includes('环境设计')) return designStrategy(seed)
  if (
    combined.includes('苹果')
    && includesAny(combined, ['产品', 'ai', '战略', '公司', '生态'])
  ) return appleStrategy(seed)
  if (
    combined.includes('python')
    && includesAny(combined, ['开发', '编程', 'ai', '软件', '生态'])
  ) return pythonStrategy(seed)

  const topic = seed.topic.trim()
  const goal = seed.goal.trim() || `分析${topic}的发展趋势与关键问题`
  const isArchitecture = combined.includes('建筑行业')
  const concepts = isArchitecture
    ? ['建筑行业', '市场', '技术', '企业', '政策']
    : [topic, '市场', '技术', '应用', '趋势']
  return {
    intent: {
      normalizedTopic: topic,
      researchObject: isArchitecture ? '建筑行业及其产业链与市场发展' : topic,
      userIntent: goal,
      scope: isArchitecture ? ['产业链', '市场趋势', '技术变化', '企业与政策'] : [topic, '市场', '技术', '应用'],
      excludedMeanings: [],
      keyConcepts: concepts,
      ambiguityDetected: false,
    },
    queryPlan: { queries: [
      { id: 'query-1', query: `${topic} 行业现状 发展趋势`, purpose: '行业趋势', priority: 1 },
      { id: 'query-2', query: `${topic} 市场 关键参与者`, purpose: '市场格局', priority: 2 },
      { id: 'query-3', query: `${topic} 技术变化 应用案例`, purpose: '技术与应用', priority: 3 },
      { id: 'query-4', query: `${topic} 风险 挑战 未来展望`, purpose: '风险与前景', priority: 4 },
    ] },
  }
}

export function applyResearchStrategyGuardrails(
  strategy: ResearchStrategy,
  seed: StrategySeed,
) {
  const domainStrategy = createFallbackResearchStrategy(seed)
  // Small, explicit topic hints protect known vertical meanings when the model
  // mistakenly treats an ambiguous phrase as generic or environmental science.
  if (domainStrategy.intent.ambiguityDetected) return domainStrategy
  return strategy
}

export function resolveResearchStrategy(
  request: ResearchRequest,
): ResearchStrategy {
  const strategy = parseResearchStrategy(request.researchStrategy)
    ?? createFallbackResearchStrategy({ topic: request.topic, goal: request.goal })
  return {
    ...strategy,
    intent: { ...strategy.intent, userIntent: request.goal },
  }
}

export const researchStrategyTestApi = {
  maxQueryCount: MAX_QUERY_COUNT,
  minQueryCount: MIN_QUERY_COUNT,
  normalizeQueries,
}

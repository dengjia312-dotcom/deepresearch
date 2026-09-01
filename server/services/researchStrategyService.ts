import type {
  ConfirmedIntent,
  IntentCandidate,
  PublicIntentConfirmation,
  ResearchIntent,
  ResearchRequest,
  ResearchStrategy,
  SearchQuery,
} from '../types/research'
import { ResearchServiceError } from './serviceError'
import { asString, isRecord } from './serviceUtils'

const MAX_SCOPE_ITEMS = 8
const MAX_EXCLUDED_MEANINGS = 8
const MAX_KEY_CONCEPTS = 12
const MIN_QUERY_COUNT = 2
const MAX_QUERY_COUNT = 4
const MIN_CANDIDATE_COUNT = 2
const MAX_CANDIDATE_COUNT = 4

export interface StrategySeed {
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

function parseIntent(value: unknown): ResearchIntent | null {
  if (!isRecord(value)) return null
  const normalizedTopic = asString(value.normalizedTopic).trim()
  const researchObject = asString(value.researchObject).trim()
  const userIntent = asString(value.userIntent).trim()
  const scope = uniqueStrings(value.scope, MAX_SCOPE_ITEMS)
  const excludedMeanings = uniqueStrings(value.excludedMeanings, MAX_EXCLUDED_MEANINGS)
  const keyConcepts = uniqueStrings(value.keyConcepts, MAX_KEY_CONCEPTS, 80)
  if (
    !normalizedTopic || normalizedTopic.length > 300
    || !researchObject || researchObject.length > 300
    || !userIntent || userIntent.length > 500
    || scope.length === 0 || keyConcepts.length === 0
    || typeof value.ambiguityDetected !== 'boolean'
  ) return null
  return {
    normalizedTopic,
    researchObject,
    userIntent,
    scope,
    excludedMeanings,
    keyConcepts,
    ambiguityDetected: value.ambiguityDetected,
  }
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
    return [{
      id: `query-${index + 1}`,
      query,
      purpose,
      priority: Number.isInteger(rawPriority) && rawPriority > 0 ? rawPriority : index + 1,
    }]
  })
  return queries
    .sort((left, right) => left.priority - right.priority)
    .slice(0, MAX_QUERY_COUNT)
    .map((query, index) => ({ ...query, id: `query-${index + 1}`, priority: index + 1 }))
}

function hasEnoughQueryDiversity(queries: SearchQuery[]) {
  return queries.length >= MIN_QUERY_COUNT
    && new Set(queries.map((query) => query.purpose.toLocaleLowerCase())).size
      >= Math.min(3, queries.length)
}

function filterExcludedQueries(queries: SearchQuery[], intent: ResearchIntent) {
  return queries.filter((query) => {
    const text = query.query.toLocaleLowerCase()
    const hasExcludedMeaning = intent.excludedMeanings.some((meaning) => (
      text.includes(meaning.toLocaleLowerCase())
    ))
    const hasKeyConcept = intent.keyConcepts.some((concept) => (
      text.includes(concept.toLocaleLowerCase())
    ))
    return !hasExcludedMeaning || hasKeyConcept
  })
}

export function parseExecutableQueryPlan(
  value: unknown,
  intent: ResearchIntent,
): ResearchStrategy['queryPlan'] | null {
  const queryPlanValue = isRecord(value) ? value : null
  const queries = filterExcludedQueries(normalizeQueries(queryPlanValue?.queries), intent)
  return hasEnoughQueryDiversity(queries) ? { queries } : null
}

function parseCandidate(value: unknown, index: number): IntentCandidate | null {
  if (!isRecord(value)) return null
  const label = asString(value.label).trim()
  const description = asString(value.description).trim()
  const researchObject = asString(value.researchObject).trim()
  const scope = uniqueStrings(value.scope, MAX_SCOPE_ITEMS)
  const keyConcepts = uniqueStrings(value.keyConcepts, MAX_KEY_CONCEPTS, 80)
  const excludedMeanings = uniqueStrings(value.excludedMeanings, MAX_EXCLUDED_MEANINGS)
  if (
    !label || label.length > 100
    || !description || description.length > 500
    || !researchObject || researchObject.length > 300
    || scope.length === 0 || keyConcepts.length === 0
  ) return null
  return {
    id: asString(value.id).trim() || `candidate-${index + 1}`,
    label,
    description,
    researchObject,
    scope,
    keyConcepts,
    excludedMeanings,
  }
}

function normalizeSemanticItem(value: string) {
  return value
    .toLocaleLowerCase()
    .replace(/产业|行业|市场/g, '商业领域')
    .replace(/发展趋势|未来发展|行业趋势|产业趋势|市场趋势|发展|趋势|未来/g, '演进')
    .replace(/[\s，、,。；;：:的与和及]/g, '')
}

function candidateSemanticSet(candidate: IntentCandidate) {
  return new Set([
    candidate.researchObject,
    ...candidate.scope,
    ...candidate.keyConcepts,
  ].map(normalizeSemanticItem).filter((item) => item.length >= 2))
}

function candidatesAreDistinct(left: IntentCandidate, right: IntentCandidate) {
  const leftObject = normalizeSemanticItem(left.researchObject)
  const rightObject = normalizeSemanticItem(right.researchObject)
  if (!leftObject || !rightObject || leftObject === rightObject) return false
  const leftSet = candidateSemanticSet(left)
  const rightSet = candidateSemanticSet(right)
  const intersection = [...leftSet].filter((item) => rightSet.has(item)).length
  const union = new Set([...leftSet, ...rightSet]).size
  const similarity = union > 0 ? intersection / union : 1
  const meaningContrast = left.excludedMeanings.some((item) => rightSet.has(normalizeSemanticItem(item)))
    || right.excludedMeanings.some((item) => leftSet.has(normalizeSemanticItem(item)))
  return meaningContrast || similarity < 0.6
}

export function normalizeIntentCandidates(value: unknown) {
  if (!Array.isArray(value)) return []
  const candidates = value
    .slice(0, MAX_CANDIDATE_COUNT)
    .map(parseCandidate)
    .filter((candidate): candidate is IntentCandidate => Boolean(candidate))
    .map((candidate, index) => ({ ...candidate, id: `candidate-${index + 1}` }))
  if (candidates.length < MIN_CANDIDATE_COUNT) return []
  for (let left = 0; left < candidates.length; left += 1) {
    for (let right = left + 1; right < candidates.length; right += 1) {
      if (!candidatesAreDistinct(candidates[left]!, candidates[right]!)) return []
    }
  }
  return candidates
}

function parseConfirmedIntent(value: unknown): ConfirmedIntent | null {
  if (!isRecord(value)) return null
  const source = value.source === 'candidate' || value.source === 'custom' ? value.source : null
  const label = asString(value.label).trim()
  const normalizedTopic = asString(value.normalizedTopic).trim()
  const researchObject = asString(value.researchObject).trim()
  const userIntent = asString(value.userIntent).trim()
  const scope = uniqueStrings(value.scope, MAX_SCOPE_ITEMS)
  const keyConcepts = uniqueStrings(value.keyConcepts, MAX_KEY_CONCEPTS, 80)
  const excludedMeanings = uniqueStrings(value.excludedMeanings, MAX_EXCLUDED_MEANINGS)
  const candidateId = asString(value.candidateId).trim()
  if (
    !source || !label || label.length > 100
    || !normalizedTopic || !researchObject || !userIntent
    || scope.length === 0 || keyConcepts.length === 0
    || (source === 'candidate' && !candidateId)
  ) return null
  return {
    source,
    ...(candidateId ? { candidateId } : {}),
    label,
    normalizedTopic,
    researchObject,
    userIntent,
    scope,
    keyConcepts,
    excludedMeanings,
  }
}

function sameStrings(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function confirmedIntentMatchesIntent(confirmed: ConfirmedIntent, intent: ResearchIntent) {
  return confirmed.normalizedTopic === intent.normalizedTopic
    && confirmed.researchObject === intent.researchObject
    && confirmed.userIntent === intent.userIntent
    && sameStrings(confirmed.scope, intent.scope)
    && sameStrings(confirmed.keyConcepts, intent.keyConcepts)
    && sameStrings(confirmed.excludedMeanings, intent.excludedMeanings)
}

export function parseResearchStrategy(value: unknown): ResearchStrategy | null {
  if (!isRecord(value)) return null
  const intentValue = isRecord(value.researchIntent)
    ? value.researchIntent
    : isRecord(value.intent) ? value.intent : null
  const intent = parseIntent(intentValue)
  const queryPlanValue = isRecord(value.queryPlan) ? value.queryPlan : null
  if (!intent || !queryPlanValue) return null
  const queries = filterExcludedQueries(normalizeQueries(queryPlanValue.queries), intent)
  const confirmationValue = isRecord(value.intentConfirmation) ? value.intentConfirmation : null

  if (value.version !== 2 && !confirmationValue) {
    if (!hasEnoughQueryDiversity(queries)) return null
    return {
      version: 1,
      intent,
      queryPlan: { queries },
      intentConfirmation: { status: 'not_required', candidates: [] },
      queryPlanStatus: 'ready',
    }
  }
  if (!confirmationValue) return null
  const status = confirmationValue.status
  if (status !== 'not_required' && status !== 'pending' && status !== 'confirmed') return null
  const candidates = normalizeIntentCandidates(confirmationValue.candidates)
  const confirmedIntent = parseConfirmedIntent(confirmationValue.confirmedIntent)
  const queryPlanStatus = value.queryPlanStatus === 'stale'
    || value.queryPlanStatus === 'pending_confirmation'
    || value.queryPlanStatus === 'ready'
    ? value.queryPlanStatus
    : status === 'pending' ? 'pending_confirmation' : 'ready'
  if (
    status === 'pending'
    && (
      !intent.ambiguityDetected
      || candidates.length < MIN_CANDIDATE_COUNT
      || confirmedIntent
      || queryPlanStatus !== 'pending_confirmation'
    )
  ) return null
  if (
    status === 'confirmed'
    && (
      intent.ambiguityDetected
      || !confirmedIntent
      || !confirmedIntentMatchesIntent(confirmedIntent, intent)
      || (
        confirmedIntent.source === 'candidate'
        && !candidates.some((candidate) => candidate.id === confirmedIntent.candidateId)
      )
      || (confirmedIntent.source === 'custom' && confirmedIntent.candidateId)
      || queryPlanStatus === 'pending_confirmation'
    )
  ) return null
  if (
    status === 'not_required'
    && (
      intent.ambiguityDetected
      || candidates.length > 0
      || confirmedIntent
      || queryPlanStatus === 'pending_confirmation'
    )
  ) return null
  if (queryPlanStatus === 'ready' && !hasEnoughQueryDiversity(queries)) return null
  return {
    version: 2,
    intent,
    queryPlan: { queries: queryPlanStatus === 'ready' ? queries : [] },
    intentConfirmation: {
      status,
      candidates,
      ...(confirmedIntent ? { confirmedIntent } : {}),
    },
    queryPlanStatus,
  }
}

export function parsePlanResearchStrategy(value: unknown): ResearchStrategy | null {
  if (!isRecord(value)) return null
  const intent = parseIntent(isRecord(value.researchIntent) ? value.researchIntent : value.intent)
  if (!intent) return null
  const candidates = normalizeIntentCandidates(value.intentCandidates)
  if (intent.ambiguityDetected && candidates.length >= MIN_CANDIDATE_COUNT) {
    return {
      version: 2,
      intent,
      queryPlan: { queries: [] },
      intentConfirmation: { status: 'pending', candidates },
      queryPlanStatus: 'pending_confirmation',
    }
  }
  const queryPlan = parseExecutableQueryPlan(value.queryPlan, intent)
  if (!queryPlan) return null
  return {
    version: 2,
    intent: { ...intent, ambiguityDetected: false },
    queryPlan,
    intentConfirmation: { status: 'not_required', candidates: [] },
    queryPlanStatus: 'ready',
  }
}

function includesAny(text: string, words: string[]) {
  return words.some((word) => text.includes(word))
}

function designCandidates(): IntentCandidate[] {
  return [
    {
      id: 'candidate-1',
      label: '环境设计专业与行业发展',
      description: '研究环境设计专业及室内、景观、空间设计行业的未来发展、就业前景、AI 影响和未来能力要求。',
      researchObject: '环境设计专业及室内、景观与空间设计行业',
      scope: ['环境设计专业', '室内设计', '景观设计', '空间设计', '就业', 'AI与数字化'],
      keyConcepts: ['环境设计专业', '室内设计', '景观设计', '空间设计', '就业', 'AI', '数字化'],
      excludedMeanings: ['生态环境治理', '环境科学', '污染治理', '生态安全'],
    },
    {
      id: 'candidate-2',
      label: '自然环境与生态设计发展',
      description: '研究生态环境、可持续设计、绿色基础设施与环境治理等方向的未来发展。',
      researchObject: '自然环境、生态设计与环境治理体系',
      scope: ['生态环境', '可持续设计', '绿色基础设施', '环境治理'],
      keyConcepts: ['生态环境', '可持续设计', '绿色基础设施', '环境治理'],
      excludedMeanings: ['环境设计专业', '室内设计就业', '空间设计岗位'],
    },
  ]
}

function pendingStrategy(seed: StrategySeed, intent: ResearchIntent, candidates: IntentCandidate[]): ResearchStrategy {
  return {
    version: 2,
    intent: { ...intent, userIntent: seed.goal || intent.userIntent, ambiguityDetected: true },
    queryPlan: { queries: [] },
    intentConfirmation: { status: 'pending', candidates },
    queryPlanStatus: 'pending_confirmation',
  }
}

function designStrategy(seed: StrategySeed): ResearchStrategy {
  return pendingStrategy(seed, {
    normalizedTopic: '环境设计的未来（研究方向待确认）',
    researchObject: '可能指环境设计专业与空间设计行业，也可能指自然环境与生态治理',
    userIntent: seed.goal,
    scope: ['环境设计专业与行业', '自然环境与生态设计'],
    excludedMeanings: [],
    keyConcepts: ['环境设计', '空间设计', '生态环境', '可持续设计'],
    ambiguityDetected: true,
  }, designCandidates())
}

function appleStrategy(seed: StrategySeed): ResearchStrategy {
  return pendingStrategy(seed, {
    normalizedTopic: '苹果的发展（研究对象待确认）',
    researchObject: '可能指 Apple 公司，也可能指苹果水果与产业',
    userIntent: seed.goal,
    scope: ['Apple公司与产品生态', '苹果水果与产业'],
    excludedMeanings: [],
    keyConcepts: ['Apple公司', '苹果产业'],
    ambiguityDetected: true,
  }, [
    {
      id: 'candidate-1', label: 'Apple 公司与产品生态',
      description: '研究 Apple 公司的产品生态、iPhone 业务、AI 战略和市场竞争。',
      researchObject: 'Apple公司及其产品、服务与开发者生态',
      scope: ['iPhone业务', '产品生态', 'AI战略', '市场竞争'],
      keyConcepts: ['Apple公司', 'iPhone', 'Apple Intelligence', '产品生态'],
      excludedMeanings: ['水果苹果', '苹果种植', '苹果营养'],
    },
    {
      id: 'candidate-2', label: '苹果水果与产业发展',
      description: '研究苹果种植、品种、供应链、消费和农业产业发展。',
      researchObject: '苹果水果、种植与农业产业链',
      scope: ['苹果种植', '品种', '供应链', '消费市场'],
      keyConcepts: ['苹果水果', '种植', '农业', '供应链'],
      excludedMeanings: ['Apple公司', 'iPhone', '消费电子'],
    },
  ])
}

function pythonStrategy(seed: StrategySeed): ResearchStrategy {
  return pendingStrategy(seed, {
    normalizedTopic: 'Python 的未来（研究对象待确认）',
    researchObject: '可能指 Python 编程语言，也可能指蟒蛇类动物',
    userIntent: seed.goal,
    scope: ['Python编程语言', '蟒蛇类动物'],
    excludedMeanings: [],
    keyConcepts: ['Python', '编程语言', '蟒蛇'],
    ambiguityDetected: true,
  }, [
    {
      id: 'candidate-1', label: 'Python 编程语言与生态',
      description: '研究 Python 编程语言、AI 开发、工具链和开发者生态。',
      researchObject: 'Python编程语言、工具链及开发者生态',
      scope: ['开发者生态', 'AI编程', '工具链', '应用趋势'],
      keyConcepts: ['Python编程语言', '开发者', 'AI编程', '工具链'],
      excludedMeanings: ['蟒蛇', '蛇类动物', '爬行动物'],
    },
    {
      id: 'candidate-2', label: '蟒蛇物种与生态',
      description: '研究蟒蛇物种、栖息地、生态保护和生物学发展。',
      researchObject: '蟒蛇类动物及其自然生态',
      scope: ['物种', '栖息地', '生态保护', '生物学'],
      keyConcepts: ['蟒蛇', '爬行动物', '栖息地', '生态保护'],
      excludedMeanings: ['Python编程语言', '软件开发', 'AI编程'],
    },
  ])
}

function genericExecutableStrategy(seed: StrategySeed, version: 1 | 2): ResearchStrategy {
  const topic = seed.topic.trim()
  const goal = seed.goal.trim() || `分析${topic}的发展趋势与关键问题`
  const combined = `${topic} ${goal} ${seed.scope ?? ''}`.toLocaleLowerCase()
  const isArchitecture = combined.includes('建筑行业')
  const intent: ResearchIntent = {
    normalizedTopic: topic,
    researchObject: isArchitecture ? '建筑行业及其产业链与市场发展' : topic,
    userIntent: goal,
    scope: isArchitecture ? ['产业链', '市场趋势', '技术变化', '企业与政策'] : [topic, '市场', '技术', '应用'],
    excludedMeanings: [],
    keyConcepts: isArchitecture ? ['建筑行业', '市场', '技术', '企业', '政策'] : [topic, '市场', '技术', '应用', '趋势'],
    ambiguityDetected: false,
  }
  return {
    version,
    intent,
    queryPlan: { queries: [
      { id: 'query-1', query: `${topic} 行业现状 发展趋势`, purpose: '行业趋势', priority: 1 },
      { id: 'query-2', query: `${topic} 市场 关键参与者`, purpose: '市场格局', priority: 2 },
      { id: 'query-3', query: `${topic} 技术变化 应用案例`, purpose: '技术与应用', priority: 3 },
      { id: 'query-4', query: `${topic} 风险 挑战 未来展望`, purpose: '风险与前景', priority: 4 },
    ] },
    intentConfirmation: { status: 'not_required', candidates: [] },
    queryPlanStatus: 'ready',
  }
}

export function createFallbackResearchStrategy(seed: StrategySeed): ResearchStrategy {
  const combined = `${seed.topic} ${seed.goal} ${seed.scope ?? ''}`.toLocaleLowerCase()
  if (combined.includes('环境设计')) return designStrategy(seed)
  if (combined.includes('苹果') && includesAny(combined, ['产品', 'iphone', 'ai', '战略', '公司', '生态'])) {
    return appleStrategy(seed)
  }
  if (combined.includes('python') && includesAny(combined, ['开发', '编程', 'ai', '软件', '生态'])) {
    return pythonStrategy(seed)
  }
  return genericExecutableStrategy(seed, 2)
}

export function createLegacyFallbackResearchStrategy(seed: StrategySeed) {
  const current = createFallbackResearchStrategy(seed)
  if (current.intentConfirmation.status !== 'pending') return { ...current, version: 1 as const }
  const candidate = current.intentConfirmation.candidates[0]!
  return {
    ...genericExecutableStrategy({ ...seed, topic: candidate.researchObject }, 1),
    intent: {
      normalizedTopic: candidate.label,
      researchObject: candidate.researchObject,
      userIntent: seed.goal,
      scope: candidate.scope,
      excludedMeanings: candidate.excludedMeanings,
      keyConcepts: candidate.keyConcepts,
      ambiguityDetected: true,
    },
  }
}

export function applyResearchStrategyGuardrails(strategy: ResearchStrategy, seed: StrategySeed) {
  const domainStrategy = createFallbackResearchStrategy(seed)
  if (domainStrategy.intentConfirmation.status === 'pending') return domainStrategy
  return strategy
}

export function invalidateResearchStrategyForPlanEdit(strategy: ResearchStrategy): ResearchStrategy {
  const current = strategy.version === 2 ? strategy : { ...strategy, version: 2 as const }
  const pending = current.intentConfirmation.status === 'pending'
  return {
    ...current,
    queryPlan: { queries: [] },
    queryPlanStatus: pending ? 'pending_confirmation' : 'stale',
  }
}

export function toPublicIntentConfirmation(strategy: ResearchStrategy): PublicIntentConfirmation {
  const confirmation = strategy.intentConfirmation
  return {
    status: confirmation.status,
    ...(confirmation.candidates.length > 0 ? {
      candidates: confirmation.candidates.map(({ id, label, description, scope }) => ({
        id, label, description, scope,
      })),
    } : {}),
    ...(confirmation.confirmedIntent ? {
      confirmed: {
        source: confirmation.confirmedIntent.source,
        label: confirmation.confirmedIntent.label,
      },
    } : {}),
  }
}

export function resolveResearchStrategy(request: ResearchRequest): ResearchStrategy {
  const supplied = parseResearchStrategy(request.researchStrategy)
  if (supplied) {
    if (supplied.queryPlanStatus !== 'ready' || supplied.intentConfirmation.status === 'pending') {
      const pending = supplied.intentConfirmation.status === 'pending'
      throw new ResearchServiceError(
        pending ? 'RESEARCH_INTENT_CONFIRMATION_REQUIRED' : 'INVALID_RESEARCH_INTENT',
        409,
        pending
          ? '请先确认研究方向，再开始联网研究。'
          : '研究检索策略已失效，请重新确认研究计划。',
      )
    }
    return supplied.version === 2
      ? supplied
      : { ...supplied, intent: { ...supplied.intent, userIntent: request.goal } }
  }
  return createLegacyFallbackResearchStrategy({ topic: request.topic, goal: request.goal })
}

export const researchStrategyTestApi = {
  maxQueryCount: MAX_QUERY_COUNT,
  minQueryCount: MIN_QUERY_COUNT,
  normalizeQueries,
  candidatesAreDistinct,
}

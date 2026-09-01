import type { ResearchPlan } from '../../src/types'
import type {
  ConfirmedIntent,
  IntentCandidate,
  ResearchIntent,
  ResearchStrategy,
  SearchQuery,
} from '../types/research'
import { generateContent, parseGeneratedJson } from './generation/generationService'
import { ResearchServiceError } from './serviceError'
import { asString, isRecord } from './serviceUtils'
import {
  parseExecutableQueryPlan,
  parsePlanResearchStrategy,
} from './researchStrategyService'

export type ResearchIntentConfirmationSelection =
  | { source: 'candidate'; candidateId: string }
  | { source: 'custom'; customDirection: string }

interface StrategyGenerationInput {
  topic: string
  plan: ResearchPlan
  strategy: ResearchStrategy
  direction: IntentCandidate | ConfirmedIntent | ResearchIntent | string
}

function unique(values: string[], maximum: number) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, maximum)
}

function isQueryAllowed(query: SearchQuery, intent: ResearchIntent) {
  const text = query.query.toLocaleLowerCase()
  if (/\bsite\s*:|https?:\/\/|\bwww\./i.test(text)) return false
  const excluded = intent.excludedMeanings.some((meaning) => (
    text.includes(meaning.toLocaleLowerCase())
  ))
  const positive = intent.keyConcepts.some((concept) => (
    text.includes(concept.toLocaleLowerCase())
  ))
  return !excluded || positive
}

async function generateFinalIntentAndQueries(input: StrategyGenerationInput) {
  const result = await generateContent('plan', {
    messages: [
      {
        role: 'system',
        content: '你是严谨的中文研究策略规划师。根据用户已确定的研究方向生成最终研究意图和多角度检索计划，不得改变用户选择的研究对象。',
      },
      {
        role: 'user',
        content: `原始主题：${input.topic}
研究目标：${input.plan.objective}
研究范围：${input.plan.scope}
核心问题：${input.plan.questions.map((question) => question.text).join('；')}
来源偏好：${input.plan.sourcePreferences.join('、')}
用户确定的研究方向：${typeof input.direction === 'string' ? input.direction : JSON.stringify(input.direction)}

请规范化最终研究对象，并生成 2 至 4 条角度明显不同的检索语句。不得把被排除的其他语义方向写入 Query，不得使用 site:、URL、域名或硬编码站点列表。仅输出 JSON：
{"label":"简短方向名称","researchIntent":{"normalizedTopic":"规范主题","researchObject":"研究对象","userIntent":"研究意图","scope":["范围"],"excludedMeanings":["排除含义"],"keyConcepts":["关键概念"],"ambiguityDetected":false},"queryPlan":{"queries":[{"query":"检索语句","purpose":"研究角度","priority":1}]}}`,
      },
    ],
    maxCompletionTokens: 2600,
    temperature: 0.15,
  })
  const parsed = parseGeneratedJson(result.content)
  if (!isRecord(parsed.researchIntent)) {
    throw new ResearchServiceError(
      'INVALID_RESEARCH_INTENT',
      502,
      'AI 返回的研究方向结构无效，请重试。',
    )
  }
  const parsedStrategy = parsePlanResearchStrategy({
    ...parsed,
    researchIntent: { ...parsed.researchIntent, ambiguityDetected: false },
    intentCandidates: [],
  })
  if (!parsedStrategy || parsedStrategy.queryPlanStatus !== 'ready') {
    throw new ResearchServiceError(
      'INVALID_RESEARCH_INTENT',
      502,
      'AI 返回的研究方向或检索计划无效，请重试。',
    )
  }
  const queries = parsedStrategy.queryPlan.queries.filter((query) => (
    isQueryAllowed(query, parsedStrategy.intent)
  ))
  if (queries.length < 2) {
    throw new ResearchServiceError(
      'INVALID_RESEARCH_INTENT',
      502,
      'AI 返回的检索计划包含无效的语义方向或站点限制，请重试。',
    )
  }
  return {
    label: asString(parsed.label).trim().slice(0, 100)
      || parsedStrategy.intent.normalizedTopic.slice(0, 100),
    intent: parsedStrategy.intent,
    queryPlan: { queries },
  }
}

function applyCandidateBoundaries(
  generated: Awaited<ReturnType<typeof generateFinalIntentAndQueries>>,
  candidate: IntentCandidate,
) {
  const intent: ResearchIntent = {
    ...generated.intent,
    researchObject: candidate.researchObject,
    scope: unique([...candidate.scope, ...generated.intent.scope], 8),
    keyConcepts: unique([...candidate.keyConcepts, ...generated.intent.keyConcepts], 12),
    excludedMeanings: unique([
      ...candidate.excludedMeanings,
      ...generated.intent.excludedMeanings,
    ], 8),
    ambiguityDetected: false,
  }
  const queries = generated.queryPlan.queries.filter((query) => isQueryAllowed(query, intent))
  if (queries.length < 2) {
    throw new ResearchServiceError(
      'INVALID_RESEARCH_INTENT',
      502,
      'AI 生成的检索计划偏离了所选研究方向，请重试。',
    )
  }
  return { ...generated, intent, queryPlan: { queries } }
}

export async function confirmResearchIntent(
  topic: string,
  plan: ResearchPlan,
  strategy: ResearchStrategy,
  selection: ResearchIntentConfirmationSelection,
): Promise<ResearchStrategy> {
  if (strategy.intentConfirmation.status !== 'pending') {
    throw new ResearchServiceError(
      'INVALID_RESEARCH_INTENT',
      409,
      '当前研究方向状态不允许再次确认。',
    )
  }
  let candidate: IntentCandidate | undefined
  let direction: IntentCandidate | string
  if (selection.source === 'candidate') {
    candidate = strategy.intentConfirmation.candidates.find(
      (item) => item.id === selection.candidateId,
    )
    if (!candidate) {
      throw new ResearchServiceError(
        'INVALID_RESEARCH_INTENT',
        400,
        '所选研究方向不存在或已失效。',
      )
    }
    direction = candidate
  } else {
    direction = selection.customDirection
  }

  const rawGenerated = await generateFinalIntentAndQueries({
    topic,
    plan,
    strategy,
    direction,
  })
  const generated = candidate
    ? applyCandidateBoundaries(rawGenerated, candidate)
    : rawGenerated
  const confirmedIntent: ConfirmedIntent = {
    source: selection.source,
    ...(candidate ? { candidateId: candidate.id } : {}),
    label: candidate?.label ?? generated.label,
    normalizedTopic: generated.intent.normalizedTopic,
    researchObject: generated.intent.researchObject,
    userIntent: generated.intent.userIntent,
    scope: generated.intent.scope,
    keyConcepts: generated.intent.keyConcepts,
    excludedMeanings: generated.intent.excludedMeanings,
  }
  return {
    version: 2,
    intent: generated.intent,
    queryPlan: generated.queryPlan,
    intentConfirmation: {
      status: 'confirmed',
      candidates: strategy.intentConfirmation.candidates,
      confirmedIntent,
    },
    queryPlanStatus: 'ready',
  }
}

async function generateQueryPlanForCanonicalIntent(
  topic: string,
  plan: ResearchPlan,
  intent: ResearchIntent,
) {
  const result = await generateContent('plan', {
    messages: [
      {
        role: 'system',
        content: '你是严谨的中文检索策略规划师。研究对象已经由用户最终确定，只能根据固定研究意图和最新研究计划更新检索语句，不得重新解释或改写研究意图。',
      },
      {
        role: 'user',
        content: `原始主题：${topic}
固定研究意图：${JSON.stringify(intent)}
最新研究目标：${plan.objective}
最新研究范围：${plan.scope}
最新核心问题：${plan.questions.map((question) => question.text).join('；')}
最新来源偏好：${plan.sourcePreferences.join('、')}

请只生成 2 至 4 条角度明显不同的检索语句。不得改变固定研究意图，不得输出新的 researchIntent，不得使用 site:、URL、域名或硬编码站点列表。仅输出 JSON：
{"queryPlan":{"queries":[{"query":"检索语句","purpose":"研究角度","priority":1}]}}`,
      },
    ],
    maxCompletionTokens: 1600,
    temperature: 0.1,
  })
  const parsed = parseGeneratedJson(result.content)
  const queryPlan = parseExecutableQueryPlan(parsed.queryPlan, intent)
  if (!queryPlan || queryPlan.queries.some((query) => !isQueryAllowed(query, intent))) {
    throw new ResearchServiceError(
      'INVALID_RESEARCH_INTENT',
      502,
      'AI 返回的检索计划无效或偏离固定研究方向，请重试。',
    )
  }
  return queryPlan
}

export async function rebuildQueryPlanForPlan(
  topic: string,
  plan: ResearchPlan,
  strategy: ResearchStrategy,
) {
  if (strategy.intentConfirmation.status === 'pending') {
    throw new ResearchServiceError(
      'RESEARCH_INTENT_CONFIRMATION_REQUIRED',
      409,
      '请先确认研究方向，再开始联网研究。',
    )
  }
  const confirmedIntent = strategy.intentConfirmation.confirmedIntent
  const canonicalIntent: ResearchIntent = confirmedIntent
    ? {
        normalizedTopic: confirmedIntent.normalizedTopic,
        researchObject: confirmedIntent.researchObject,
        userIntent: confirmedIntent.userIntent,
        scope: confirmedIntent.scope,
        keyConcepts: confirmedIntent.keyConcepts,
        excludedMeanings: confirmedIntent.excludedMeanings,
        ambiguityDetected: false,
      }
    : strategy.intent
  const queryPlan = await generateQueryPlanForCanonicalIntent(
    topic,
    plan,
    canonicalIntent,
  )
  return {
    ...strategy,
    queryPlan,
    queryPlanStatus: 'ready' as const,
  }
}

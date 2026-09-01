import {
  generateContent,
  parseGeneratedJson,
} from './generation/generationService'
import { ResearchServiceError } from './serviceError'
import { asString, isRecord } from './serviceUtils'
import {
  applyResearchStrategyGuardrails,
  createFallbackResearchStrategy,
  parsePlanResearchStrategy,
  toPublicIntentConfirmation,
} from './researchStrategyService'
import type {
  PlanRequest,
  PlanResponse,
  ResearchDepth,
  ResearchStrategy,
} from '../types/research'

const allowedSourcePreferences = new Set([
  '权威报告',
  '官方资料',
  '行业研究',
  '学术论文',
  '司法案例',
  '企业案例',
  '用户研究',
  '专业媒体',
  '内部资料',
])

const depthEstimates: Record<
  ResearchDepth,
  Pick<
    PlanResponse['plan'],
    'estimatedSourceCount' | 'estimatedDurationMinutes'
  >
> = {
  quick: { estimatedSourceCount: 12, estimatedDurationMinutes: 2 },
  deep: { estimatedSourceCount: 12, estimatedDurationMinutes: 5 },
  professional: { estimatedSourceCount: 12, estimatedDurationMinutes: 15 },
}

export interface PlanGenerationBundle {
  response: PlanResponse
  researchStrategy: ResearchStrategy
}

export async function generatePlanBundle(
  request: PlanRequest,
): Promise<PlanGenerationBundle> {
  const startedAt = Date.now()
  const prompt = `请根据研究主题一次性生成中文研究计划、轻量研究意图和检索计划。

研究主题：${request.topic}
研究深度：${request.depth}

要求：
1. objective 是清晰、具体的研究目标；
2. scope 明确研究对象、地域或场景、时间范围与边界；
3. questions 提供 3 至 8 个互不重复的核心研究问题；
4. sourcePreferences 只能从以下选项选择 2 至 6 项：权威报告、官方资料、行业研究、学术论文、司法案例、企业案例、用户研究、专业媒体、内部资料；
5. 不生成研究结论，不编造来源或数据；
6. researchIntent 必须判断主题是否存在多个明显不同的研究对象或语义方向；只有真实语义歧义才把 ambiguityDetected 设为 true；
7. 若 ambiguityDetected=true，intentCandidates 必须给出 2 至 4 个研究对象明显不同的方向，不得用“市场趋势/产业趋势”这类同义改写凑数；此时 queryPlan.queries 必须为空；
8. 若 ambiguityDetected=false，intentCandidates 必须为空，queryPlan 生成 2 至 4 条角度不同的检索语句，不能只是同一句改写。查询先保证研究对象正确，再自然考虑来源偏好，不得机械拼接全部 sourcePreferences；
9. 对明显垂直领域可使用少量行业关键词，但不要硬编码域名或生成站点列表；
10. Candidate 必须包含 label、description、researchObject、scope、keyConcepts、excludedMeanings；
11. 仅输出 JSON，不要 Markdown：
{"plan":{"objective":"研究目标","scope":"研究范围","questions":["问题1","问题2","问题3"],"sourcePreferences":["官方资料","行业研究"]},"researchIntent":{"normalizedTopic":"规范主题","researchObject":"研究对象或待确认对象","userIntent":"用户意图","scope":["范围"],"excludedMeanings":["排除含义"],"keyConcepts":["关键概念"],"ambiguityDetected":false},"intentCandidates":[],"queryPlan":{"queries":[{"query":"检索语句","purpose":"研究角度","priority":1}]}}`

  const result = await generateContent('plan', {
    messages: [
      {
        role: 'system',
        content: '你是严谨的中文研究规划师。只负责把用户主题拆解为研究目标、范围和问题，不得伪造事实。',
      },
      { role: 'user', content: prompt },
    ],
    maxCompletionTokens: 3200,
    temperature: 0.2,
  })

  const parsed = parseGeneratedJson(result.content)
  if (!isRecord(parsed)) {
    throw new ResearchServiceError('AI_GENERATION_RESPONSE_INVALID', 502, 'AI 返回的研究计划结构无效。')
  }

  const parsedPlan = isRecord(parsed.plan) ? parsed.plan : parsed
  const objective = asString(parsedPlan.objective)
  const scope = asString(parsedPlan.scope)
  const rawQuestions = Array.isArray(parsedPlan.questions) ? parsedPlan.questions : []
  const questions = rawQuestions
    .map(asString)
    .filter(Boolean)
  const sourcePreferences = Array.isArray(parsedPlan.sourcePreferences)
    ? [...new Set(parsedPlan.sourcePreferences.map(asString).filter((item) =>
        allowedSourcePreferences.has(item)))]
    : []

  if (
    !objective
    || objective.length > 1000
    || !scope
    || scope.length > 2000
    || questions.length < 3
    || questions.length > 8
    || questions.some((question) => question.length > 500)
    || new Set(questions.map((question) => question.toLocaleLowerCase())).size
      !== questions.length
    || sourcePreferences.length < 2
    || sourcePreferences.length > 6
  ) {
    throw new ResearchServiceError('AI_GENERATION_RESPONSE_INVALID', 502, 'AI 返回的研究计划字段不完整或格式异常。')
  }

  const response: PlanResponse = {
    taskId: request.taskId,
    requestId: request.requestId,
    mode: 'live',
    dataSource: 'real',
    plan: {
      objective,
      scope,
      questions: questions.map((text, index) => ({
        id: `question-${index + 1}`,
        text,
      })),
      sourcePreferences,
      ...depthEstimates[request.depth],
    },
    generatedAt: new Date().toISOString(),
  }
  const strategySeed = { topic: request.topic, goal: objective, scope }
  const researchStrategy = applyResearchStrategyGuardrails(
    parsePlanResearchStrategy(parsed) ?? createFallbackResearchStrategy(strategySeed),
    strategySeed,
  )
  response.intentConfirmation = toPublicIntentConfirmation(researchStrategy)
  const durationMs = Date.now() - startedAt
  console.info('[research:intent] completed', {
    ambiguityDetected: researchStrategy.intent.ambiguityDetected,
    scopeCount: researchStrategy.intent.scope.length,
    excludedMeaningCount: researchStrategy.intent.excludedMeanings.length,
    durationMs,
  })
  console.info('[research:query-plan] completed', {
    queryCount: researchStrategy.queryPlan.queries.length,
    purposes: researchStrategy.queryPlan.queries.map((query) => query.purpose),
    durationMs,
  })
  if (researchStrategy.intentConfirmation.status === 'pending') {
    console.info('[research:intent] ambiguity-detected', {
      taskId: request.taskId,
      candidateCount: researchStrategy.intentConfirmation.candidates.length,
    })
  }
  return { response, researchStrategy }
}

export async function generatePlan(request: PlanRequest): Promise<PlanResponse> {
  return (await generatePlanBundle(request)).response
}

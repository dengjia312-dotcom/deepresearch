import {
  generateContent,
  parseGeneratedJson,
} from './generation/generationService'
import { ResearchServiceError } from './serviceError'
import { asString, isRecord } from './serviceUtils'
import type {
  PlanRequest,
  PlanResponse,
  ResearchDepth,
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

export async function generatePlan(
  request: PlanRequest,
): Promise<PlanResponse> {
  const prompt = `请根据研究主题生成一份可执行的中文研究计划。

研究主题：${request.topic}
研究深度：${request.depth}

要求：
1. objective 是清晰、具体的研究目标；
2. scope 明确研究对象、地域或场景、时间范围与边界；
3. questions 提供 3 至 8 个互不重复的核心研究问题；
4. sourcePreferences 只能从以下选项选择 2 至 6 项：权威报告、官方资料、行业研究、学术论文、司法案例、企业案例、用户研究、专业媒体、内部资料；
5. 不生成研究结论，不编造来源或数据；
6. 仅输出 JSON：{"objective":"研究目标","scope":"研究范围","questions":["问题1","问题2"],"sourcePreferences":["官方资料","行业研究"]}`

  const result = await generateContent('plan', {
    messages: [
      {
        role: 'system',
        content: '你是严谨的中文研究规划师。只负责把用户主题拆解为研究目标、范围和问题，不得伪造事实。',
      },
      { role: 'user', content: prompt },
    ],
    maxCompletionTokens: 2200,
    temperature: 0.2,
  })

  const parsed = parseGeneratedJson(result.content)
  if (!isRecord(parsed)) {
    throw new ResearchServiceError('AI_GENERATION_RESPONSE_INVALID', 502, 'AI 返回的研究计划结构无效。')
  }

  const objective = asString(parsed.objective)
  const scope = asString(parsed.scope)
  const rawQuestions = Array.isArray(parsed.questions) ? parsed.questions : []
  const questions = rawQuestions
    .map(asString)
    .filter(Boolean)
  const sourcePreferences = Array.isArray(parsed.sourcePreferences)
    ? [...new Set(parsed.sourcePreferences.map(asString).filter((item) =>
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

  return {
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
}

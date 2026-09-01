import type {
  ResearchAgentEvidenceRecord,
  ResearchEvidenceEvaluation,
  ResearchEvidenceNeed,
  ResearchFollowUpQuery,
  ResearchIntent,
  ResearchPlanContext,
  SearchQuery,
} from '../types/research'
import { generateContent, parseGeneratedJson } from './generation/generationService'
import { ResearchServiceError } from './serviceError'
import { asString, isRecord } from './serviceUtils'

const MIN_EVIDENCE_COUNT = 3
const MAX_EVIDENCE_NEEDS = 3
const MAX_FOLLOW_UP_QUERIES = 3
const MAX_EVALUATOR_CONTENT_LENGTH = 700
const QUERY_MAX_LENGTH = 160
const PURPOSE_MAX_LENGTH = 80
const URL_OR_DOMAIN_PATTERN = /\bsite\s*:|https?:\/\/|www\.|(?:[a-z0-9-]+\.)+(?:com|cn|org|net|edu|gov|io|ai)\b/i

export interface ResearchEvidenceEvaluatorInput {
  intent: ResearchIntent
  plan: ResearchPlanContext
  initialQueries: SearchQuery[]
  executedQueries: SearchQuery[]
  evidence: ResearchAgentEvidenceRecord[]
  priorEvidenceNeeds?: ResearchEvidenceNeed[]
  round: 1 | 2
  allowReplan: boolean
}

function uniqueStrings(value: unknown, maximum: number, maxLength: number) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map(asString).map((item) => item.trim()).filter(
    (item) => item && item.length <= maxLength,
  ))].slice(0, maximum)
}

function normalizeQueryText(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

function hasExcludedMeaning(query: string, intent: ResearchIntent) {
  const normalized = query.toLocaleLowerCase()
  return intent.excludedMeanings.some((meaning) => {
    const excluded = meaning.trim().toLocaleLowerCase()
    return excluded.length > 0 && normalized.includes(excluded)
  })
}

function remainsWithinCanonicalIntent(query: string, intent: ResearchIntent) {
  const normalized = query.toLocaleLowerCase()
  const canonicalTerms = [...intent.keyConcepts, ...intent.scope]
    .flatMap((term) => {
      const normalizedTerm = term.trim().toLocaleLowerCase()
      const base = normalizedTerm.replace(/(?:专业|行业|市场|公司|业务|战略|发展)$/u, '').trim()
      return [normalizedTerm, base]
    })
    .filter((term) => term.length >= 2)
  return canonicalTerms.length === 0 || canonicalTerms.some((term) => normalized.includes(term))
}

function parseEvidenceNeeds(
  value: unknown,
  input: ResearchEvidenceEvaluatorInput,
  finalStatus: ResearchEvidenceEvaluation['status'],
) {
  if (!Array.isArray(value)) return { needs: [], idMap: new Map<string, string>() }
  const allowedEvidenceIds = new Set(input.evidence.map((item) => item.evidenceId))
  const allowedQuestionIds = new Set(input.plan.questions.map((question) => question.id))
  const idMap = new Map<string, string>()
  const priorIds = new Set(input.priorEvidenceNeeds?.map((need) => need.id) ?? [])
  const usedIds = new Set<string>()
  const needs: ResearchEvidenceNeed[] = []
  for (const item of value) {
    if (needs.length >= MAX_EVIDENCE_NEEDS) break
    if (!isRecord(item)) continue
    const rawId = asString(item.id).trim()
    const label = asString(item.label).trim()
    const description = asString(item.description).trim()
    if (!rawId || !label || label.length > 100 || !description || description.length > 400) continue
    let id = priorIds.has(rawId) ? rawId : ''
    if (!id) {
      let sequence = needs.length + 1
      do {
        id = `need-${sequence}`
        sequence += 1
      } while (usedIds.has(id))
    }
    if (usedIds.has(id)) continue
    usedIds.add(id)
    idMap.set(rawId, id)
    const supportingEvidenceIds = uniqueStrings(item.supportingEvidenceIds, 16, 100)
      .filter((evidenceId) => allowedEvidenceIds.has(evidenceId))
    needs.push({
      id,
      label,
      description,
      relatedQuestionIds: uniqueStrings(item.relatedQuestionIds, 10, 100)
        .filter((questionId) => allowedQuestionIds.has(questionId)),
      status: finalStatus === 'sufficient'
        ? 'satisfied'
        : input.round === 2 ? 'unresolved' : 'open',
      supportingEvidenceIds,
    })
  }
  return { needs, idMap }
}

function parseFollowUpQueries(
  value: unknown,
  input: ResearchEvidenceEvaluatorInput,
  needIdMap: Map<string, string>,
) {
  if (!input.allowReplan || !Array.isArray(value)) return []
  const executed = new Set(input.executedQueries.map((item) => normalizeQueryText(item.query)))
  const purposes = new Set<string>()
  const queries: ResearchFollowUpQuery[] = []
  for (const item of value) {
    if (queries.length >= MAX_FOLLOW_UP_QUERIES) break
    if (!isRecord(item)) continue
    const query = asString(item.query).trim().replace(/\s+/g, ' ')
    const purpose = asString(item.purpose).trim()
    const normalized = normalizeQueryText(query)
    const normalizedPurpose = purpose.toLocaleLowerCase()
    const evidenceNeedIds = uniqueStrings(item.evidenceNeedIds, MAX_EVIDENCE_NEEDS, 100)
      .flatMap((needId) => {
        const mapped = needIdMap.get(needId)
        return mapped ? [mapped] : []
      })
    if (
      !query || query.length > QUERY_MAX_LENGTH
      || !purpose || purpose.length > PURPOSE_MAX_LENGTH
      || URL_OR_DOMAIN_PATTERN.test(query)
      || hasExcludedMeaning(query, input.intent)
      || !remainsWithinCanonicalIntent(query, input.intent)
      || executed.has(normalized)
      || purposes.has(normalizedPurpose)
      || evidenceNeedIds.length === 0
    ) continue
    executed.add(normalized)
    purposes.add(normalizedPurpose)
    queries.push({
      id: `follow-up-r2-${queries.length + 1}`,
      query,
      purpose,
      priority: queries.length + 1,
      round: 2,
      evidenceNeedIds: [...new Set(evidenceNeedIds)],
    })
  }
  return queries
}

function buildEvaluatorPrompt(input: ResearchEvidenceEvaluatorInput, forceInsufficient: boolean) {
  const evidence = input.evidence.map((item) => ({
    evidenceId: item.evidenceId,
    title: item.metadata.title.slice(0, 200),
    publisher: item.metadata.publisher.slice(0, 100),
    sourceType: item.sourceType,
    evidenceType: item.evidenceType,
    content: item.content.slice(0, MAX_EVALUATOR_CONTENT_LENGTH),
    queryIds: [...new Set(item.bindings.map((binding) => binding.queryId))],
  }))
  return `规范研究主题：${input.intent.normalizedTopic}
固定研究对象：${input.intent.researchObject}
固定用户意图：${input.intent.userIntent}
研究范围：${input.plan.scope}
研究目标：${input.plan.objective}
研究问题：${JSON.stringify(input.plan.questions)}
来源偏好：${input.plan.sourcePreferences.join('、') || '无特别偏好'}
初始检索目的：${input.initialQueries.map((query) => query.purpose).join('、')}
已执行检索：${JSON.stringify(input.executedQueries.map((query) => ({ id: query.id, purpose: query.purpose })))}
需要排除的含义：${input.intent.excludedMeanings.join('、') || '无'}
当前轮次：${input.round}
允许补充检索：${input.allowReplan ? '是' : '否'}
规则判定明显不足：${forceInsufficient ? '是；最终 status 必须为 insufficient' : '否'}
已获取证据：${JSON.stringify(evidence)}
上一轮证据缺口：${JSON.stringify(input.priorEvidenceNeeds ?? [])}

请评估这些证据是否足以回答固定研究方向和研究问题。不得修改、重写或重新解释研究主题、研究对象和用户意图。
若证据不足，给出最多 3 个 Evidence Need。仅在允许补充检索时，为缺口生成 1 至 3 条检索语句；每条必须绑定 evidenceNeedIds，不得包含 URL、域名或 site:。
仅输出 JSON：
{"status":"sufficient|insufficient","evidenceNeeds":[{"id":"need-a","label":"缺口名称","description":"缺失证据","relatedQuestionIds":["q-1"],"supportingEvidenceIds":["evidence-1"]}],"followUpQueries":[{"query":"检索语句","purpose":"补充目的","evidenceNeedIds":["need-a"]}]}`
}

export async function evaluateResearchEvidence(
  input: ResearchEvidenceEvaluatorInput,
): Promise<ResearchEvidenceEvaluation> {
  const hasReaderEvidence = input.evidence.some(
    (item) => item.evidenceType === 'full_text' || item.evidenceType === 'partial',
  )
  const forceInsufficient = input.evidence.length < MIN_EVIDENCE_COUNT || !hasReaderEvidence
  const result = await generateContent('evidence_evaluation', {
    messages: [
      {
        role: 'system',
        content: '你是严格的研究证据完整性评估器。只能评估给定证据并在允许时提出补充检索语句。不得输出或修改 ResearchIntent，不得联网，不得指定工具或 Provider。',
      },
      { role: 'user', content: buildEvaluatorPrompt(input, forceInsufficient) },
    ],
    maxCompletionTokens: 2600,
    temperature: 0.1,
  })
  const parsed = parseGeneratedJson(result.content)
  const modelStatus = parsed.status === 'sufficient' || parsed.status === 'insufficient'
    ? parsed.status
    : null
  if (!modelStatus) {
    throw new ResearchServiceError(
      'AI_GENERATION_RESPONSE_INVALID',
      502,
      'AI 返回的证据完整性评估无效，请重新发起研究。',
    )
  }
  const status: ResearchEvidenceEvaluation['status'] = forceInsufficient
    ? 'insufficient'
    : modelStatus
  let { needs, idMap } = parseEvidenceNeeds(parsed.evidenceNeeds, input, status)
  if (status === 'sufficient' && needs.length === 0 && input.priorEvidenceNeeds?.length) {
    needs = input.priorEvidenceNeeds.map((need) => ({ ...need, status: 'satisfied' }))
    idMap = new Map(needs.map((need) => [need.id, need.id]))
  }
  const followUpQueries = status === 'insufficient'
    ? parseFollowUpQueries(parsed.followUpQueries, input, idMap)
    : []
  if (
    status === 'insufficient'
    && (
      needs.length === 0
      || (input.allowReplan && followUpQueries.length === 0)
    )
  ) {
    throw new ResearchServiceError(
      'AI_GENERATION_RESPONSE_INVALID',
      502,
      'AI 返回的证据缺口或补充检索计划无效，请重新发起研究。',
    )
  }
  console.info('[research:agent] evidence-evaluated', {
    round: input.round,
    status,
    evidenceCount: input.evidence.length,
    evidenceNeedCount: needs.length,
    followUpQueryCount: followUpQueries.length,
  })
  return { status, evidenceNeeds: needs, followUpQueries }
}

export const researchEvidenceEvaluatorTestApi = {
  maxEvidenceNeeds: MAX_EVIDENCE_NEEDS,
  maxFollowUpQueries: MAX_FOLLOW_UP_QUERIES,
  minEvidenceCount: MIN_EVIDENCE_COUNT,
}

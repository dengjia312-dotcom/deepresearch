import { ResearchServiceError } from '../serviceError'
import { isRecord } from '../serviceUtils'
import {
  requestQwenGeneration,
  type GenerationMessage,
  type GenerationModelClass,
  type GenerationReasoningEffort,
  type GenerationTask,
} from './qwenGenerationProvider'

interface GenerationTaskPolicy {
  modelClass: GenerationModelClass
  reasoningEffort: GenerationReasoningEffort
}

const generationPolicyByTask: Record<GenerationTask, GenerationTaskPolicy> = {
  plan: { modelClass: 'fast', reasoningEffort: 'none' },
  outline: { modelClass: 'fast', reasoningEffort: 'none' },
  synthesis: { modelClass: 'strong', reasoningEffort: 'none' },
  report: { modelClass: 'strong', reasoningEffort: 'medium' },
  relevance: { modelClass: 'fast', reasoningEffort: 'none' },
  evidence_evaluation: { modelClass: 'fast', reasoningEffort: 'none' },
}

interface GenerateContentOptions {
  messages: GenerationMessage[]
  maxCompletionTokens: number
  temperature?: number
}

export async function generateContent(
  task: GenerationTask,
  options: GenerateContentOptions,
) {
  const policy = generationPolicyByTask[task]
  return requestQwenGeneration({
    task,
    ...policy,
    ...options,
  })
}

export function parseGeneratedJson(content: string): Record<string, unknown> {
  const withoutFence = content
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()
  const firstBrace = withoutFence.indexOf('{')
  const lastBrace = withoutFence.lastIndexOf('}')
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    throw new ResearchServiceError(
      'AI_GENERATION_RESPONSE_INVALID',
      502,
      'AI 返回的数据结构异常，请重新生成。',
      undefined,
      'QWEN_JSON_INVALID',
    )
  }

  try {
    const parsed = JSON.parse(withoutFence.slice(firstBrace, lastBrace + 1)) as unknown
    if (isRecord(parsed)) return parsed
  } catch {
    // Use the same product-level error for malformed and non-object JSON.
  }
  throw new ResearchServiceError(
    'AI_GENERATION_RESPONSE_INVALID',
    502,
    'AI 返回的数据结构异常，请重新生成。',
    undefined,
    'QWEN_JSON_INVALID',
  )
}

export const generationServiceTestApi = { generationPolicyByTask }

import { ResearchServiceError } from '../serviceError'
import { isRecord } from '../serviceUtils'
import {
  requestQwenGeneration,
  type GenerationMessage,
  type GenerationModelClass,
  type GenerationTask,
} from './qwenGenerationProvider'

const modelClassByTask: Record<GenerationTask, GenerationModelClass> = {
  plan: 'fast',
  outline: 'fast',
  synthesis: 'strong',
  report: 'strong',
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
  return requestQwenGeneration({
    task,
    modelClass: modelClassByTask[task],
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

export const generationServiceTestApi = { modelClassByTask }

import type { ResearchErrorCode } from '../../types/research'
import {
  getAiConcurrencyRetryAfterSeconds,
  tryAcquireGlobalAiSlot,
} from '../aiConcurrency'
import { ResearchServiceError } from '../serviceError'
import { isRecord } from '../serviceUtils'

const DEFAULT_FAST_MODEL = 'qwen3.8-flash'
const DEFAULT_STRONG_MODEL = 'qwen3.8-max'
const DEFAULT_FAST_TIMEOUT_MS = 60_000
const DEFAULT_STRONG_TIMEOUT_MS = 120_000

export type GenerationModelClass = 'fast' | 'strong'
export type GenerationReasoningEffort = 'none' | 'medium' | 'high'
export type GenerationTask = 'plan' | 'outline' | 'synthesis' | 'report'

export interface GenerationMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface QwenGenerationRequest {
  task: GenerationTask
  modelClass: GenerationModelClass
  reasoningEffort: GenerationReasoningEffort
  messages: GenerationMessage[]
  maxCompletionTokens: number
  temperature?: number
}

export interface QwenGenerationResult {
  content: string
  finishReason: string | null
  model: string
  durationMs: number
  inputTokens: number | null
  outputTokens: number | null
  reasoningTokens: number | null
  upstreamHttpStatus: number
}

interface QwenConfiguration {
  apiKey: string
  baseUrl: string
  fastModel: string
  strongModel: string
  configured: boolean
}

function getPositiveInteger(name: string, fallback: number) {
  const value = Number(process.env[name]?.trim())
  return Number.isInteger(value) && value > 0 ? value : fallback
}

export function getQwenConfiguration(): QwenConfiguration {
  const apiKey = process.env.QWEN_API_KEY?.trim() || ''
  const baseUrl = (process.env.QWEN_BASE_URL?.trim() || '').replace(/\/+$/, '')
  const fastModel = process.env.QWEN_FAST_MODEL?.trim() || DEFAULT_FAST_MODEL
  const strongModel = process.env.QWEN_STRONG_MODEL?.trim() || DEFAULT_STRONG_MODEL
  return {
    apiKey,
    baseUrl,
    fastModel,
    strongModel,
    configured: Boolean(apiKey && baseUrl),
  }
}

export function getQwenTimeoutMs(modelClass: GenerationModelClass) {
  return modelClass === 'fast'
    ? getPositiveInteger('QWEN_FAST_TIMEOUT_MS', DEFAULT_FAST_TIMEOUT_MS)
    : getPositiveInteger('QWEN_STRONG_TIMEOUT_MS', DEFAULT_STRONG_TIMEOUT_MS)
}

function getModel(config: QwenConfiguration, modelClass: GenerationModelClass) {
  return modelClass === 'fast' ? config.fastModel : config.strongModel
}

function createUpstreamError(status: number) {
  if (status === 429) {
    return new ResearchServiceError(
      'AI_GENERATION_RATE_LIMITED',
      503,
      '当前生成请求较多，请稍后重试。',
      undefined,
      'QWEN_RATE_LIMITED',
    )
  }

  const diagnosticCode = status >= 500
    ? 'QWEN_UPSTREAM_5XX'
    : status === 401 || status === 403
      ? 'QWEN_AUTH_FAILED'
      : status === 402
        ? 'QWEN_QUOTA_EXCEEDED'
        : 'QWEN_UPSTREAM_ERROR'
  return new ResearchServiceError(
    'AI_GENERATION_FAILED',
    status === 402 ? 503 : 502,
    'AI 生成失败，请稍后重试。',
    undefined,
    diagnosticCode,
  )
}

function readTokenCount(usage: Record<string, unknown> | null, key: string) {
  const value = usage?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export async function requestQwenGeneration(
  request: QwenGenerationRequest,
): Promise<QwenGenerationResult> {
  const config = getQwenConfiguration()
  if (!config.configured) {
    throw new ResearchServiceError(
      'AI_GENERATION_NOT_CONFIGURED',
      503,
      'AI 生成服务尚未配置。',
      undefined,
      'QWEN_NOT_CONFIGURED',
    )
  }

  const releaseAiSlot = tryAcquireGlobalAiSlot()
  if (!releaseAiSlot) {
    throw new ResearchServiceError(
      'API_CONCURRENCY_LIMITED',
      503,
      '当前 AI 服务请求较多，请稍后手动重试。',
      getAiConcurrencyRetryAfterSeconds(),
      'LOCAL_CONCURRENCY_LIMITED',
    )
  }

  const startedAt = Date.now()
  const model = getModel(config, request.modelClass)
  const timeoutMs = getQwenTimeoutMs(request.modelClass)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  let upstreamHttpStatus: number | null = null
  console.info('[ai-generation] started', {
    task: request.task,
    provider: 'qwen',
    modelClass: request.modelClass,
    reasoningEffort: request.reasoningEffort,
  })

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: request.messages,
        stream: false,
        reasoning_effort: request.reasoningEffort,
        temperature: request.temperature ?? 0.2,
        max_tokens: request.maxCompletionTokens,
      }),
      signal: controller.signal,
    })
    upstreamHttpStatus = response.status
    if (!response.ok) throw createUpstreamError(response.status)

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new ResearchServiceError(
        'AI_GENERATION_RESPONSE_INVALID',
        502,
        'AI 返回的数据结构异常，请重新生成。',
        undefined,
        'QWEN_RESPONSE_INVALID',
      )
    }
    if (!isRecord(payload) || !Array.isArray(payload.choices)) {
      throw new ResearchServiceError(
        'AI_GENERATION_RESPONSE_INVALID',
        502,
        'AI 返回的数据结构异常，请重新生成。',
        undefined,
        'QWEN_RESPONSE_INVALID',
      )
    }
    const firstChoice = payload.choices[0]
    const message = isRecord(firstChoice) && isRecord(firstChoice.message)
      ? firstChoice.message
      : null
    const content = typeof message?.content === 'string' ? message.content.trim() : ''
    const finishReason = isRecord(firstChoice) && typeof firstChoice.finish_reason === 'string'
      ? firstChoice.finish_reason
      : null
    if (!content) {
      throw new ResearchServiceError(
        'AI_GENERATION_RESPONSE_INVALID',
        502,
        'AI 未返回有效内容，请重新生成。',
        undefined,
        'QWEN_RESPONSE_INVALID',
      )
    }
    const usage = isRecord(payload.usage) ? payload.usage : null
    const inputTokens = readTokenCount(usage, 'prompt_tokens')
      ?? readTokenCount(usage, 'input_tokens')
    const outputTokens = readTokenCount(usage, 'completion_tokens')
      ?? readTokenCount(usage, 'output_tokens')
    const completionTokenDetails = isRecord(usage?.completion_tokens_details)
      ? usage.completion_tokens_details
      : isRecord(usage?.output_tokens_details)
        ? usage.output_tokens_details
        : null
    const reasoningTokens = readTokenCount(completionTokenDetails, 'reasoning_tokens')
      ?? readTokenCount(usage, 'reasoning_tokens')
    const durationMs = Date.now() - startedAt
    console.info('[ai-generation] completed', {
      task: request.task,
      provider: 'qwen',
      model,
      durationMs,
      upstreamHttpStatus,
      inputTokens,
      outputTokens,
      reasoningTokens,
      finishReason,
    })
    return {
      content,
      finishReason,
      model,
      durationMs,
      inputTokens,
      outputTokens,
      reasoningTokens,
      upstreamHttpStatus: response.status,
    }
  } catch (error) {
    let mappedError: ResearchServiceError
    if (error instanceof ResearchServiceError) {
      mappedError = error
    } else if (error instanceof Error && (
      error.name === 'AbortError' || error.name === 'TimeoutError'
    )) {
      mappedError = new ResearchServiceError(
        'AI_GENERATION_TIMEOUT',
        504,
        'AI 生成超时，请稍后重试。',
        undefined,
        'QWEN_TIMEOUT',
      )
    } else {
      mappedError = new ResearchServiceError(
        'AI_GENERATION_FAILED',
        502,
        'AI 生成失败，请稍后重试。',
        undefined,
        'QWEN_NETWORK_ERROR',
      )
    }
    console.error('[ai-generation] failed', {
      task: request.task,
      provider: 'qwen',
      errorCode: mappedError.diagnosticCode ?? mappedError.code,
      durationMs: Date.now() - startedAt,
      upstreamHttpStatus,
    })
    throw mappedError
  } finally {
    clearTimeout(timeout)
    releaseAiSlot()
  }
}

export const qwenGenerationProviderTestApi = {
  defaultFastTimeoutMs: DEFAULT_FAST_TIMEOUT_MS,
  defaultStrongTimeoutMs: DEFAULT_STRONG_TIMEOUT_MS,
}

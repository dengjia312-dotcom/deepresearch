import { createHash, randomUUID } from 'node:crypto'
import {
  buildMimoResearchRequestBody,
  getMimoConfiguration,
  isRecord,
  MimoServiceError,
  researchWithMimo,
} from './mimoResearchService'
import type { ResearchRequest } from '../types/research'

const DIAGNOSTIC_TIMEOUT_MS = 120_000

interface DiagnosticLogger {
  info(message: string, details: Record<string, unknown>): void
  error(message: string, details: Record<string, unknown>): void
}

interface DiagnosticDependencies {
  environment?: Record<string, string | undefined>
  fetchImpl?: typeof fetch
  buildResearchBody?: typeof buildMimoResearchRequestBody
  getConfiguration?: typeof getMimoConfiguration
  logger?: DiagnosticLogger
  now?: () => number
  runResearch?: typeof researchWithMimo
  timeoutMs?: number
}

type ResolvedDiagnosticDependencies = Required<Omit<DiagnosticDependencies, 'environment'>>

const productionResearchRequest: ResearchRequest = {
  topic: 'C端产品经理基础',
  goal: '系统性地梳理C端产品经理的核心能力模型、工作流程、关键决策点及行业最佳实践，构建一个适用于中国互联网环境的、可落地的C端产品经理基础能力框架与知识体系。',
  sourcePreferences: [
    '权威报告',
    '行业研究',
    '企业案例',
    '专业媒体',
    '用户研究',
  ],
  targetSourceCount: 12,
  taskId: '',
  requestId: '',
}

function getFirstChoice(payload: Record<string, unknown>) {
  if (!Array.isArray(payload.choices) || !isRecord(payload.choices[0])) return null
  return payload.choices[0]
}

function getErrorCode(payload: unknown, httpStatus: number) {
  if (!isRecord(payload) || !isRecord(payload.error)) return `HTTP_${httpStatus}`
  return typeof payload.error.code === 'string' && payload.error.code.trim()
    ? payload.error.code.trim()
    : `HTTP_${httpStatus}`
}

async function runMinimalDiagnostic({
  fetchImpl,
  getConfiguration,
  logger,
  now,
  timeoutMs,
}: ResolvedDiagnosticDependencies) {
  const startedAt = now()
  const config = getConfiguration()
  if (!config.configured) {
    logger.error('[diagnostic:web-search:minimal] failed', {
      httpStatus: null,
      errorCode: 'MIMO_NOT_CONFIGURED',
      durationMs: now() - startedAt,
    })
    return
  }

  let httpStatus: number | null = null
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': config.apiKey,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{
          role: 'user',
          content: '请搜索今天人工智能领域的最新新闻，并给出来源。',
        }],
        tools: [{
          type: 'web_search',
          max_keyword: 3,
          force_search: true,
          limit: 3,
        }],
        tool_choice: 'auto',
        stream: false,
        thinking: { type: 'disabled' },
        max_completion_tokens: 1024,
        temperature: 1.0,
      }),
      signal: controller.signal,
    })
    httpStatus = response.status

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      logger.error('[diagnostic:web-search:minimal] failed', {
        httpStatus,
        errorCode: 'MIMO_RESPONSE_INVALID',
        durationMs: now() - startedAt,
      })
      return
    }

    if (!response.ok) {
      logger.error('[diagnostic:web-search:minimal] failed', {
        httpStatus,
        errorCode: getErrorCode(payload, response.status),
        durationMs: now() - startedAt,
      })
      return
    }
    if (!isRecord(payload)) {
      logger.error('[diagnostic:web-search:minimal] failed', {
        httpStatus,
        errorCode: 'MIMO_RESPONSE_INVALID',
        durationMs: now() - startedAt,
      })
      return
    }

    const choice = getFirstChoice(payload)
    const message = choice && isRecord(choice.message) ? choice.message : null
    const annotations = message && Array.isArray(message.annotations)
      ? message.annotations
      : []
    const annotationTypes = [...new Set(annotations.flatMap((annotation) => (
      isRecord(annotation) && typeof annotation.type === 'string' && annotation.type.trim()
        ? [annotation.type.trim()]
        : []
    )))]
    const usage = isRecord(payload.usage) ? payload.usage : null
    const webSearchUsage = usage && isRecord(usage.web_search_usage)
      ? usage.web_search_usage
      : null

    logger.info('[diagnostic:web-search:minimal] result', {
      httpStatus,
      annotationCount: annotations.length,
      annotationTypes,
      hasWebSearchUsage: Boolean(webSearchUsage),
      toolUsage: webSearchUsage && typeof webSearchUsage.tool_usage === 'number'
        ? webSearchUsage.tool_usage
        : null,
      pageUsage: webSearchUsage && typeof webSearchUsage.page_usage === 'number'
        ? webSearchUsage.page_usage
        : null,
      finishReason: choice && typeof choice.finish_reason === 'string'
        ? choice.finish_reason
        : null,
      durationMs: now() - startedAt,
    })
  } catch (error) {
    const timedOut = error instanceof Error
      && (error.name === 'AbortError' || error.name === 'TimeoutError')
    logger.error('[diagnostic:web-search:minimal] failed', {
      httpStatus,
      errorCode: timedOut ? 'MIMO_TIMEOUT' : 'MIMO_NETWORK_ERROR',
      durationMs: now() - startedAt,
    })
  } finally {
    clearTimeout(timeout)
  }
}

async function runProductionDiagnostic({
  buildResearchBody,
  getConfiguration,
  logger,
  now,
  runResearch,
}: ResolvedDiagnosticDependencies) {
  const startedAt = now()
  const request = {
    ...productionResearchRequest,
    sourcePreferences: [...productionResearchRequest.sourcePreferences],
    taskId: randomUUID(),
    requestId: randomUUID(),
  }
  const config = getConfiguration()
  const bodyFingerprint = createHash('sha256')
    .update(JSON.stringify({ model: config.model, ...buildResearchBody(request) }))
    .digest('hex')
    .slice(0, 12)

  try {
    const result = await runResearch(request)
    logger.info('[diagnostic:web-search:production] result', {
      success: true,
      actualSourceCount: result.actualSourceCount,
      deduplicatedSourceCount: result.deduplicatedSourceCount,
      finalSourceCount: result.sources.length,
      durationMs: now() - startedAt,
      errorCode: null,
      bodyFingerprint,
    })
  } catch (error) {
    logger.error('[diagnostic:web-search:production] result', {
      success: false,
      actualSourceCount: null,
      deduplicatedSourceCount: null,
      finalSourceCount: 0,
      durationMs: now() - startedAt,
      errorCode: error instanceof MimoServiceError ? error.code : 'INTERNAL_ERROR',
      bodyFingerprint,
    })
  }
}

async function runDiagnostic(dependencies: ResolvedDiagnosticDependencies) {
  await runMinimalDiagnostic(dependencies)
  await runProductionDiagnostic(dependencies)
}

export function createMimoWebSearchStartupDiagnosticRunner(
  dependencies: DiagnosticDependencies = {},
) {
  const environment = dependencies.environment ?? process.env
  const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch
  const buildResearchBody = dependencies.buildResearchBody ?? buildMimoResearchRequestBody
  const getConfiguration = dependencies.getConfiguration ?? getMimoConfiguration
  const logger = dependencies.logger ?? console
  const now = dependencies.now ?? Date.now
  const runResearch = dependencies.runResearch ?? researchWithMimo
  const timeoutMs = dependencies.timeoutMs ?? DIAGNOSTIC_TIMEOUT_MS
  let started = false

  return () => {
    if (environment.AI_WEB_SEARCH_STARTUP_DIAGNOSTIC !== 'true' || started) return null
    started = true
    return runDiagnostic({
      buildResearchBody,
      fetchImpl,
      getConfiguration,
      logger,
      now,
      runResearch,
      timeoutMs,
    })
  }
}

const startOnce = createMimoWebSearchStartupDiagnosticRunner()

export function startMimoWebSearchStartupDiagnostic() {
  return startOnce()
}

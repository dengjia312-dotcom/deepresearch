import { getMimoConfiguration, isRecord } from './mimoResearchService'

const DIAGNOSTIC_TIMEOUT_MS = 120_000

interface DiagnosticLogger {
  info(message: string, details: Record<string, unknown>): void
  error(message: string, details: Record<string, unknown>): void
}

interface DiagnosticDependencies {
  environment?: Record<string, string | undefined>
  fetchImpl?: typeof fetch
  getConfiguration?: typeof getMimoConfiguration
  logger?: DiagnosticLogger
  now?: () => number
  timeoutMs?: number
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

async function runDiagnostic({
  fetchImpl,
  getConfiguration,
  logger,
  now,
  timeoutMs,
}: Required<Omit<DiagnosticDependencies, 'environment'>>) {
  const startedAt = now()
  const config = getConfiguration()
  if (!config.configured) {
    logger.error('[diagnostic:web-search] failed', {
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
      logger.error('[diagnostic:web-search] failed', {
        httpStatus,
        errorCode: 'MIMO_RESPONSE_INVALID',
        durationMs: now() - startedAt,
      })
      return
    }

    if (!response.ok) {
      logger.error('[diagnostic:web-search] failed', {
        httpStatus,
        errorCode: getErrorCode(payload, response.status),
        durationMs: now() - startedAt,
      })
      return
    }
    if (!isRecord(payload)) {
      logger.error('[diagnostic:web-search] failed', {
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

    logger.info('[diagnostic:web-search] result', {
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
    logger.error('[diagnostic:web-search] failed', {
      httpStatus,
      errorCode: timedOut ? 'MIMO_TIMEOUT' : 'MIMO_NETWORK_ERROR',
      durationMs: now() - startedAt,
    })
  } finally {
    clearTimeout(timeout)
  }
}

export function createMimoWebSearchStartupDiagnosticRunner(
  dependencies: DiagnosticDependencies = {},
) {
  const environment = dependencies.environment ?? process.env
  const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch
  const getConfiguration = dependencies.getConfiguration ?? getMimoConfiguration
  const logger = dependencies.logger ?? console
  const now = dependencies.now ?? Date.now
  const timeoutMs = dependencies.timeoutMs ?? DIAGNOSTIC_TIMEOUT_MS
  let started = false

  return () => {
    if (environment.AI_WEB_SEARCH_STARTUP_DIAGNOSTIC !== 'true' || started) return null
    started = true
    return runDiagnostic({ fetchImpl, getConfiguration, logger, now, timeoutMs })
  }
}

const startOnce = createMimoWebSearchStartupDiagnosticRunner()

export function startMimoWebSearchStartupDiagnostic() {
  return startOnce()
}

import type { NextFunction, Request, RequestHandler, Response } from 'express'
import type { ResearchErrorCode, ResearchErrorResponse } from '../types/research'

export type ApiOperation = 'plan' | 'research' | 'outline' | 'report'

interface OperationProtectionPolicy {
  windowMs: number
  sessionLimit: number
  ipLimit: number
  sessionConcurrency: number
  ipConcurrency?: number
  globalConcurrency?: number
}

export interface ApiProtectionConfig {
  operations: Record<ApiOperation, OperationProtectionPolicy>
  taskOperationConcurrency: number
  concurrencyRetryAfterSeconds: number
  cleanupIntervalMs: number
}

interface RateLimitEntry {
  count: number
  resetAt: number
}

interface RateRule {
  key: string
  limit: number
  windowMs: number
}

interface ConcurrencyRule {
  key: string
  limit: number
  global: boolean
}

interface ProtectionMiddlewareOptions {
  config: ApiProtectionConfig
  store: ApiProtectionStore
  now?: () => number
}

const SESSION_HEADER = 'X-Client-Session'
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function getPositiveInteger(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
) {
  const value = Number(environment[name]?.trim())
  return Number.isInteger(value) && value > 0 ? value : fallback
}

export function getApiProtectionConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ApiProtectionConfig {
  return {
    operations: {
      plan: {
        windowMs: getPositiveInteger(environment, 'API_PLAN_WINDOW_MS', 60_000),
        sessionLimit: getPositiveInteger(environment, 'API_PLAN_SESSION_LIMIT', 4),
        ipLimit: getPositiveInteger(environment, 'API_PLAN_IP_LIMIT', 20),
        sessionConcurrency: getPositiveInteger(environment, 'API_PLAN_SESSION_CONCURRENCY', 2),
      },
      research: {
        windowMs: getPositiveInteger(environment, 'API_RESEARCH_WINDOW_MS', 600_000),
        sessionLimit: getPositiveInteger(environment, 'API_RESEARCH_SESSION_LIMIT', 2),
        ipLimit: getPositiveInteger(environment, 'API_RESEARCH_IP_LIMIT', 8),
        sessionConcurrency: getPositiveInteger(environment, 'API_RESEARCH_SESSION_CONCURRENCY', 1),
        ipConcurrency: getPositiveInteger(environment, 'API_RESEARCH_IP_CONCURRENCY', 2),
        globalConcurrency: getPositiveInteger(environment, 'API_RESEARCH_GLOBAL_CONCURRENCY', 4),
      },
      outline: {
        windowMs: getPositiveInteger(environment, 'API_OUTLINE_WINDOW_MS', 60_000),
        sessionLimit: getPositiveInteger(environment, 'API_OUTLINE_SESSION_LIMIT', 4),
        ipLimit: getPositiveInteger(environment, 'API_OUTLINE_IP_LIMIT', 20),
        sessionConcurrency: getPositiveInteger(environment, 'API_OUTLINE_SESSION_CONCURRENCY', 2),
      },
      report: {
        windowMs: getPositiveInteger(environment, 'API_REPORT_WINDOW_MS', 600_000),
        sessionLimit: getPositiveInteger(environment, 'API_REPORT_SESSION_LIMIT', 2),
        ipLimit: getPositiveInteger(environment, 'API_REPORT_IP_LIMIT', 8),
        sessionConcurrency: getPositiveInteger(environment, 'API_REPORT_SESSION_CONCURRENCY', 1),
        globalConcurrency: getPositiveInteger(environment, 'API_REPORT_GLOBAL_CONCURRENCY', 2),
      },
    },
    taskOperationConcurrency: getPositiveInteger(
      environment,
      'API_TASK_OPERATION_CONCURRENCY',
      1,
    ),
    concurrencyRetryAfterSeconds: getPositiveInteger(
      environment,
      'API_CONCURRENCY_RETRY_AFTER_SECONDS',
      30,
    ),
    cleanupIntervalMs: getPositiveInteger(
      environment,
      'API_RATE_LIMIT_CLEANUP_INTERVAL_MS',
      60_000,
    ),
  }
}

export class ApiProtectionStore {
  private readonly rateLimitEntries = new Map<string, RateLimitEntry>()
  private readonly activeRequests = new Map<string, number>()
  private nextCleanupAt = 0

  constructor(private readonly cleanupIntervalMs: number) {}

  tryConsumeRates(rules: RateRule[], now: number) {
    this.maybeCleanup(now)
    for (const rule of rules) {
      const existing = this.rateLimitEntries.get(rule.key)
      if (existing && existing.resetAt > now && existing.count >= rule.limit) {
        return {
          allowed: false as const,
          retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
        }
      }
    }

    for (const rule of rules) {
      const existing = this.rateLimitEntries.get(rule.key)
      if (!existing || existing.resetAt <= now) {
        this.rateLimitEntries.set(rule.key, { count: 1, resetAt: now + rule.windowMs })
      } else {
        existing.count += 1
      }
    }
    return { allowed: true as const }
  }

  tryAcquire(rules: ConcurrencyRule[]) {
    const blockedRule = rules.find((rule) =>
      (this.activeRequests.get(rule.key) ?? 0) >= rule.limit)
    if (blockedRule) {
      return { acquired: false as const, global: blockedRule.global }
    }

    for (const rule of rules) {
      this.activeRequests.set(rule.key, (this.activeRequests.get(rule.key) ?? 0) + 1)
    }
    let released = false
    return {
      acquired: true as const,
      release: () => {
        if (released) return
        released = true
        for (const rule of rules) {
          const nextCount = (this.activeRequests.get(rule.key) ?? 1) - 1
          if (nextCount <= 0) this.activeRequests.delete(rule.key)
          else this.activeRequests.set(rule.key, nextCount)
        }
      },
    }
  }

  cleanupExpired(now: number) {
    for (const [key, entry] of this.rateLimitEntries) {
      if (entry.resetAt <= now) this.rateLimitEntries.delete(key)
    }
  }

  getRateLimitEntryCount() {
    return this.rateLimitEntries.size
  }

  getActiveRequestCount(key: string) {
    return this.activeRequests.get(key) ?? 0
  }

  private maybeCleanup(now: number) {
    if (now < this.nextCleanupAt) return
    this.cleanupExpired(now)
    this.nextCleanupAt = now + this.cleanupIntervalMs
  }
}

function rateKey(scope: 'session' | 'ip', identifier: string, operation: ApiOperation) {
  return JSON.stringify(['rate', scope, identifier, operation])
}

export function concurrencyKey(
  scope: 'task' | 'session' | 'ip' | 'global',
  ...parts: string[]
) {
  return JSON.stringify(['active', scope, ...parts])
}

function sendProtectionError(
  response: Response<ResearchErrorResponse>,
  status: number,
  code: ResearchErrorCode,
  message: string,
  retryAfterSeconds?: number,
) {
  if (retryAfterSeconds) response.setHeader('Retry-After', String(retryAfterSeconds))
  response.status(status).json({ error: { code, message } })
}

function isValidSessionId(value: string) {
  return value.length === 36 && UUID_V4_PATTERN.test(value)
}

function getRequestIp(request: Request) {
  return request.ip || request.socket.remoteAddress || 'unknown'
}

export function createApiProtectionMiddleware(
  operation: ApiOperation,
  options: ProtectionMiddlewareOptions,
): RequestHandler {
  const { config, store } = options
  const now = options.now ?? Date.now
  const policy = config.operations[operation]

  return (request: Request, response: Response<ResearchErrorResponse>, next: NextFunction) => {
    const sessionId = request.get(SESSION_HEADER)?.trim() ?? ''
    if (!isValidSessionId(sessionId)) {
      sendProtectionError(
        response,
        400,
        'INVALID_REQUEST',
        '缺少有效的匿名会话标识，请刷新页面后重试。',
      )
      return
    }

    const body = request.body as Record<string, unknown> | null | undefined
    const taskId = typeof body?.taskId === 'string' ? body.taskId.trim() : ''
    if (!taskId || taskId.length > 160) {
      sendProtectionError(response, 400, 'INVALID_REQUEST', '请求缺少有效的任务标识。')
      return
    }

    const ip = getRequestIp(request)
    const rateResult = store.tryConsumeRates([
      {
        key: rateKey('session', sessionId, operation),
        limit: policy.sessionLimit,
        windowMs: policy.windowMs,
      },
      {
        key: rateKey('ip', ip, operation),
        limit: policy.ipLimit,
        windowMs: policy.windowMs,
      },
    ], now())
    if (!rateResult.allowed) {
      sendProtectionError(
        response,
        429,
        'API_RATE_LIMITED',
        '请求过于频繁，请稍后手动重试。',
        rateResult.retryAfterSeconds,
      )
      return
    }

    const concurrencyRules: ConcurrencyRule[] = [
      {
        key: concurrencyKey('task', sessionId, taskId, operation),
        limit: config.taskOperationConcurrency,
        global: false,
      },
      {
        key: concurrencyKey('session', sessionId, operation),
        limit: policy.sessionConcurrency,
        global: false,
      },
    ]
    if (policy.ipConcurrency) {
      concurrencyRules.push({
        key: concurrencyKey('ip', ip, operation),
        limit: policy.ipConcurrency,
        global: false,
      })
    }
    if (policy.globalConcurrency) {
      concurrencyRules.push({
        key: concurrencyKey('global', operation),
        limit: policy.globalConcurrency,
        global: true,
      })
    }

    const concurrencyResult = store.tryAcquire(concurrencyRules)
    if (!concurrencyResult.acquired) {
      sendProtectionError(
        response,
        concurrencyResult.global ? 503 : 429,
        'API_CONCURRENCY_LIMITED',
        concurrencyResult.global
          ? '当前服务请求较多，请稍后手动重试。'
          : '当前会话已有同类请求正在处理，请等待完成后再试。',
        config.concurrencyRetryAfterSeconds,
      )
      return
    }

    const release = concurrencyResult.release
    response.once('finish', release)
    response.once('close', release)
    request.once('aborted', release)
    next()
  }
}

export function getConfiguredTrustProxy(
  environment: NodeJS.ProcessEnv = process.env,
): false | number | string | string[] {
  const rawValue = environment.API_TRUST_PROXY?.trim()
  if (!rawValue || rawValue === '0' || rawValue.toLowerCase() === 'false') return false
  if (rawValue.toLowerCase() === 'true' || rawValue === '*') {
    console.warn('[server] API_TRUST_PROXY=true/* is intentionally ignored; configure explicit proxy hops or addresses.')
    return false
  }
  if (/^[1-9]\d*$/.test(rawValue)) return Number(rawValue)
  const entries = rawValue.split(',').map((entry) => entry.trim()).filter(Boolean)
  if (entries.length === 0) return false
  return entries.length === 1 ? entries[0] : entries
}

export const apiProtectionConstants = {
  sessionHeader: SESSION_HEADER,
}

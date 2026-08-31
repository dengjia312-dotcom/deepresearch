import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { NextFunction, Request, RequestHandler, Response } from 'express'
import {
  ApiProtectionStore,
  concurrencyKey,
  createApiProtectionMiddleware,
  createResearchJobPollingProtectionMiddleware,
  getApiProtectionConfig,
  type ApiOperation,
  type ApiProtectionConfig,
} from '../server/middleware/apiProtection'
import { ImmediateSemaphore } from '../server/services/aiConcurrency'

class FakeRequest extends EventEmitter {
  readonly socket = { remoteAddress: this.ip }

  constructor(
    readonly body: Record<string, unknown>,
    readonly ip: string,
    private readonly sessionId?: string,
  ) {
    super()
  }

  get(name: string) {
    return name.toLowerCase() === 'x-client-session' ? this.sessionId : undefined
  }
}

class FakeResponse extends EventEmitter {
  statusCode = 200
  body: unknown
  readonly headers = new Map<string, string>()

  status(code: number) {
    this.statusCode = code
    return this
  }

  setHeader(name: string, value: string) {
    this.headers.set(name.toLowerCase(), value)
    return this
  }

  json(body: unknown) {
    this.body = body
    this.emit('finish')
    return this
  }
}

function sessionId(index: number) {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`
}

function createConfig(): ApiProtectionConfig {
  return getApiProtectionConfig({})
}

function invoke(
  operation: ApiOperation,
  config: ApiProtectionConfig,
  store: ApiProtectionStore,
  options: { sessionId?: string; taskId?: string; ip?: string; now?: () => number },
) {
  const request = new FakeRequest(
    { taskId: options.taskId ?? 'task-1' },
    options.ip ?? '127.0.0.1',
    options.sessionId,
  )
  const response = new FakeResponse()
  let nextCalled = false
  const middleware: RequestHandler = createApiProtectionMiddleware(operation, {
    config,
    store,
    now: options.now,
  })
  middleware(
    request as unknown as Request,
    response as unknown as Response,
    (() => { nextCalled = true }) as NextFunction,
  )
  return { request, response, nextCalled }
}

test('默认保护配置与 Web MVP 限制一致', () => {
  const config = createConfig()
  assert.equal(config.taskOperationConcurrency, 1)
  assert.deepEqual(config.operations.research, {
    windowMs: 600_000,
    sessionLimit: 2,
    ipLimit: 8,
    sessionConcurrency: 1,
    ipConcurrency: 2,
    globalConcurrency: 4,
  })
  assert.equal(config.operations.report.globalConcurrency, 2)
})

test('缺少或非法 sessionId 时拒绝 API 请求', () => {
  const config = createConfig()
  const store = new ApiProtectionStore(config.cleanupIntervalMs)
  const missing = invoke('plan', config, store, {})
  const invalid = invoke('plan', config, store, { sessionId: 'client-session' })

  assert.equal(missing.response.statusCode, 400)
  assert.equal(invalid.response.statusCode, 400)
  assert.equal(missing.nextCalled, false)
})

test('Research Job polling 使用独立轻量额度且不消耗 Research 创建额度', () => {
  const config = createConfig()
  const store = new ApiProtectionStore(config.cleanupIntervalMs)
  const middleware = createResearchJobPollingProtectionMiddleware(store, {
    API_RESEARCH_JOB_POLL_SESSION_LIMIT: '2',
    API_RESEARCH_JOB_POLL_IP_LIMIT: '10',
    API_RESEARCH_JOB_POLL_WINDOW_MS: '60000',
  })
  const invokePoll = () => {
    const request = new FakeRequest({}, '127.0.0.1', sessionId(1))
    const response = new FakeResponse()
    let nextCalled = false
    middleware(
      request as unknown as Request,
      response as unknown as Response,
      (() => { nextCalled = true }) as NextFunction,
    )
    return { response, nextCalled }
  }
  assert.equal(invokePoll().nextCalled, true)
  assert.equal(invokePoll().nextCalled, true)
  const limited = invokePoll()
  assert.equal(limited.response.statusCode, 429)
  assert.ok(limited.response.headers.has('retry-after'))
  const research = invoke('research', config, store, { sessionId: sessionId(1) })
  assert.equal(research.nextCalled, true)
  research.response.emit('finish')
})

test('同 task 同 operation 的第二个并发请求返回 429', () => {
  const config = createConfig()
  const store = new ApiProtectionStore(config.cleanupIntervalMs)
  const first = invoke('plan', config, store, { sessionId: sessionId(1) })
  const second = invoke('plan', config, store, { sessionId: sessionId(1) })

  assert.equal(first.nextCalled, true)
  assert.equal(second.response.statusCode, 429)
  assert.equal(
    store.getActiveRequestCount(concurrencyKey('task', sessionId(1), 'task-1', 'plan')),
    1,
  )
  first.response.emit('finish')
})

test('同 session 不同任务只能同时运行一个 Research', () => {
  const config = createConfig()
  const store = new ApiProtectionStore(config.cleanupIntervalMs)
  const first = invoke('research', config, store, {
    sessionId: sessionId(1),
    taskId: 'task-A',
  })
  const second = invoke('research', config, store, {
    sessionId: sessionId(1),
    taskId: 'task-B',
  })

  assert.equal(first.nextCalled, true)
  assert.equal(second.response.statusCode, 429)
  first.response.emit('finish')
})

test('单 IP 的第三个并发 Research 被拒绝', () => {
  const config = createConfig()
  const store = new ApiProtectionStore(config.cleanupIntervalMs)
  const active = [1, 2].map((index) => invoke('research', config, store, {
    sessionId: sessionId(index),
    taskId: `task-${index}`,
    ip: '10.0.0.1',
  }))
  const blocked = invoke('research', config, store, {
    sessionId: sessionId(3),
    taskId: 'task-3',
    ip: '10.0.0.1',
  })

  assert.equal(blocked.response.statusCode, 429)
  active.forEach(({ response }) => response.emit('finish'))
})

test('全局第五个 Research 返回 503 和 Retry-After', () => {
  const config = createConfig()
  const store = new ApiProtectionStore(config.cleanupIntervalMs)
  const active = [1, 2, 3, 4].map((index) => invoke('research', config, store, {
    sessionId: sessionId(index),
    taskId: `task-${index}`,
    ip: `10.0.0.${index}`,
  }))
  const blocked = invoke('research', config, store, {
    sessionId: sessionId(5),
    taskId: 'task-5',
    ip: '10.0.0.5',
  })

  assert.equal(blocked.response.statusCode, 503)
  assert.equal(blocked.response.headers.get('retry-after'), '30')
  active.forEach(({ response }) => response.emit('finish'))
})

test('全局第三个 Report 返回 503', () => {
  const config = createConfig()
  const store = new ApiProtectionStore(config.cleanupIntervalMs)
  const active = [1, 2].map((index) => invoke('report', config, store, {
    sessionId: sessionId(index),
    taskId: `task-${index}`,
    ip: `10.0.0.${index}`,
  }))
  const blocked = invoke('report', config, store, {
    sessionId: sessionId(3),
    taskId: 'task-3',
    ip: '10.0.0.3',
  })

  assert.equal(blocked.response.statusCode, 503)
  active.forEach(({ response }) => response.emit('finish'))
})

test('全局 AI semaphore 不允许超过 8 个上游调用', () => {
  const semaphore = new ImmediateSemaphore(() => 8)
  const releases = Array.from({ length: 8 }, () => semaphore.tryAcquire())

  assert.equal(releases.every(Boolean), true)
  assert.equal(semaphore.getActiveCount(), 8)
  assert.equal(semaphore.tryAcquire(), null)
  releases.forEach((release) => release?.())
  assert.equal(semaphore.getActiveCount(), 0)
})

test('频率限制返回 429 和窗口剩余 Retry-After', () => {
  const config = createConfig()
  config.operations.plan.sessionLimit = 1
  const store = new ApiProtectionStore(config.cleanupIntervalMs)
  let currentTime = 1_000
  const now = () => currentTime
  const first = invoke('plan', config, store, { sessionId: sessionId(1), now })
  first.response.emit('finish')
  currentTime = 2_000
  const blocked = invoke('plan', config, store, { sessionId: sessionId(1), now })

  assert.equal(blocked.response.statusCode, 429)
  assert.equal(blocked.response.headers.get('retry-after'), '59')
})

test('成功、失败、超时和客户端断开都会释放 HTTP 并发槽', () => {
  const releaseEvents: Array<'finish' | 'close' | 'aborted'> = ['finish', 'finish', 'close', 'aborted']
  for (const [index, event] of releaseEvents.entries()) {
    const config = createConfig()
    const store = new ApiProtectionStore(config.cleanupIntervalMs)
    const first = invoke('research', config, store, {
      sessionId: sessionId(index + 1),
      taskId: 'task-A',
    })
    if (index === 1) first.response.status(500)
    if (event === 'aborted') first.request.emit(event)
    else first.response.emit(event)

    const next = invoke('research', config, store, {
      sessionId: sessionId(index + 1),
      taskId: 'task-B',
    })
    assert.equal(next.nextCalled, true)
    next.response.emit('finish')
  }
})

test('限流窗口结束后可以重新请求', () => {
  const config = createConfig()
  config.operations.plan.sessionLimit = 1
  const store = new ApiProtectionStore(config.cleanupIntervalMs)
  let currentTime = 10_000
  const now = () => currentTime
  const first = invoke('plan', config, store, { sessionId: sessionId(1), now })
  first.response.emit('finish')
  assert.equal(invoke('plan', config, store, { sessionId: sessionId(1), now }).response.statusCode, 429)

  currentTime += config.operations.plan.windowMs + 1
  const allowed = invoke('plan', config, store, { sessionId: sessionId(1), now })
  assert.equal(allowed.nextCalled, true)
  allowed.response.emit('finish')
})

test('过期 rate-limit entry 可以被清理', () => {
  const store = new ApiProtectionStore(10)
  store.tryConsumeRates([{ key: 'expired', limit: 1, windowMs: 10 }], 0)
  assert.equal(store.getRateLimitEntryCount(), 1)
  store.cleanupExpired(11)
  assert.equal(store.getRateLimitEntryCount(), 0)
})

test('AI 上游槽位的调用点在 finally 中释放', () => {
  const generationSource = readFileSync(
    'server/services/generation/qwenGenerationProvider.ts',
    'utf8',
  )
  const retrievalSource = readFileSync('server/services/glmResearchRetrievalService.ts', 'utf8')
  assert.match(generationSource, /finally\s*{[\s\S]*clearTimeout\(timeout\)[\s\S]*releaseAiSlot\(\)/)
  assert.match(retrievalSource, /finally\s*{[\s\S]*clearTimeout\(timeout\)[\s\S]*releaseAiSlot\(\)/)
})

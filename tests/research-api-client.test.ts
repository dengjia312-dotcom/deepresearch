import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clientSessionTestApi,
  getOrCreateClientSessionId,
  requestLiveOutline,
  requestLivePlan,
  requestLiveReport,
  requestLiveResearch,
  requestConfirmResearchIntent,
  requestReportExport,
  ResearchApiError,
} from '../src/services/researchApi'

class MemoryStorage {
  private readonly values = new Map<string, string>()

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

const TEST_SESSION_ID = '12345678-1234-4123-8123-123456789abc'

test('匿名 sessionId 写入 localStorage 并在刷新后复用', () => {
  const storage = new MemoryStorage()
  const first = getOrCreateClientSessionId(storage, () => TEST_SESSION_ID)
  const refreshed = getOrCreateClientSessionId(
    storage,
    () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  )

  assert.equal(first, TEST_SESSION_ID)
  assert.equal(refreshed, TEST_SESSION_ID)
  assert.equal(storage.getItem(clientSessionTestApi.storageKey), TEST_SESSION_ID)
})

test('Intent Confirmation 使用 tasks 子资源并复用匿名 session', async () => {
  const originalFetch = globalThis.fetch
  let capturedUrl = ''
  let capturedBody = ''
  let capturedSession = ''
  globalThis.fetch = async (input, init) => {
    capturedUrl = String(input)
    capturedBody = String(init?.body)
    capturedSession = new Headers(init?.headers).get(clientSessionTestApi.headerName) ?? ''
    return new Response(JSON.stringify({ state: {}, citations: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  try {
    await requestConfirmResearchIntent('task-12345678', { candidateId: 'candidate-1' })
  } finally {
    globalThis.fetch = originalFetch
  }
  assert.equal(capturedUrl, '/api/tasks/task-12345678/research-intent/confirm')
  assert.deepEqual(JSON.parse(capturedBody), { candidateId: 'candidate-1' })
  assert.equal(clientSessionTestApi.isValidClientSessionId(capturedSession), true)
})

test('Plan、Research、Outline、Report 使用同一个 session 请求头', async () => {
  const originalFetch = globalThis.fetch
  const sessions: string[] = []
  const urls: string[] = []
  globalThis.fetch = async (input, init) => {
    urls.push(String(input))
    const headers = new Headers(init?.headers)
    sessions.push(headers.get(clientSessionTestApi.headerName) ?? '')
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  try {
    await requestLivePlan({ taskId: 'task-1', requestId: 'plan-1', topic: 'topic', depth: 'deep' })
    await requestLiveResearch({
      taskId: 'task-1',
      requestId: 'research-1',
      topic: 'topic',
      goal: 'goal',
      sourcePreferences: [],
      targetSourceCount: 8,
    })
    await requestLiveOutline({
      taskId: 'task-1',
      requestId: 'outline-1',
      topic: 'topic',
      goal: 'goal',
      sources: [],
    })
    await requestLiveReport({
      taskId: 'task-1',
      requestId: 'report-1',
      topic: 'topic',
      goal: 'goal',
      outline: { title: 'outline', sections: [] },
      sources: [],
      reportDepth: 'brief',
      targetMinWords: 800,
      targetMaxWords: 1200,
    })
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.deepEqual(urls, ['/api/plan', '/api/research', '/api/outline', '/api/report'])
  assert.equal(sessions.every((value) => value === sessions[0]), true)
  assert.equal(clientSessionTestApi.isValidClientSessionId(sessions[0]), true)
})

test('前端收到 429 后只抛出错误且不会自动重试', async () => {
  const originalFetch = globalThis.fetch
  let requestCount = 0
  globalThis.fetch = async () => {
    requestCount += 1
    return new Response(JSON.stringify({
      error: { code: 'API_RATE_LIMITED', message: '请求过于频繁。' },
    }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '60' },
    })
  }

  try {
    await assert.rejects(
      requestLivePlan({ taskId: 'task-1', requestId: 'plan-1', topic: 'topic', depth: 'deep' }),
      (error: unknown) => error instanceof ResearchApiError
        && error.code === 'API_RATE_LIMITED'
        && error.status === 429,
    )
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.equal(requestCount, 1)
})

test('报告导出携带 sessionId 并使用服务端 UTF-8 文件名', async () => {
  const originalFetch = globalThis.fetch
  let requestedUrl = ''
  let sessionId = ''
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input)
    sessionId = new Headers(init?.headers).get(clientSessionTestApi.headerName) ?? ''
    return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': "attachment; filename=report.pdf; filename*=UTF-8''C%E7%AB%AF%E6%8A%A5%E5%91%8A_2026-08-30.pdf",
      },
    })
  }

  try {
    const result = await requestReportExport('task-export-12345678', 'pdf')
    assert.equal(result.filename, 'C端报告_2026-08-30.pdf')
    assert.equal(result.blob.size, 4)
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.equal(requestedUrl, '/api/tasks/task-export-12345678/report.pdf')
  assert.equal(clientSessionTestApi.isValidClientSessionId(sessionId), true)
})

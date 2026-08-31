import assert from 'node:assert/strict'
import test from 'node:test'
import {
  pollResearchJob,
  requestCreateResearchJob,
  requestResearchJob,
  type ResearchJobResponse,
} from '../src/services/researchApi'
import {
  executeResearchJob,
  ResearchJobScheduler,
} from '../server/services/researchJobService'
import type { ResearchRequest, ResearchResponse } from '../server/types/research'
import { ResearchServiceError } from '../server/services/serviceError'
import { StaleTaskWriteError } from '../server/db/errors'

const request: ResearchRequest = {
  taskId: 'task-a',
  requestId: 'request-a',
  topic: '产品经理基础',
  goal: '梳理核心能力',
  sourcePreferences: ['行业研究'],
  targetSourceCount: 8,
}

const response: ResearchResponse = {
  taskId: request.taskId,
  requestId: request.requestId,
  mode: 'live',
  dataSource: 'real',
  topic: request.topic,
  summary: '研究摘要',
  insights: [{ id: 'i-1', title: '洞察', content: '内容', sourceIds: ['s-1'] }],
  sources: [{
    id: 's-1',
    title: '来源',
    url: 'https://example.com/source',
    publisher: '机构',
    publishedAt: '2026-08-30',
    type: '行业研究',
    credibility: '待评估',
    summary: '摘要',
    keyInsight: '洞察',
  }],
  warnings: [],
  targetSourceCount: 8,
  actualSourceCount: 1,
  deduplicatedSourceCount: 1,
  validSourceCount: 1,
  searchedAt: '2026-08-30T00:00:00.000Z',
}

function job(status: ResearchJobResponse['status']): ResearchJobResponse {
  return {
    jobId: '11111111-1111-4111-8111-111111111111',
    taskId: request.taskId,
    requestId: request.requestId,
    status,
    phase: status === 'completed' ? 'completed' : status === 'failed' ? 'failed' : 'reading',
    progress: {
      validSourceCount: 8,
      readerTargetCount: 8,
      readerCompletedCount: status === 'running' ? 4 : 8,
      fullTextCount: 4,
      partialCount: 2,
      insufficientCount: 1,
      readerFailedCount: 1,
    },
    result: status === 'completed' ? response : null,
    error: status === 'failed'
      ? { code: 'RESEARCH_SEARCH_FAILED', message: '检索失败', status: 502 }
      : null,
    createdAt: '2026-08-30T00:00:00.000Z',
    updatedAt: '2026-08-30T00:00:02.000Z',
    completedAt: status === 'completed' || status === 'failed'
      ? '2026-08-30T00:00:02.000Z'
      : null,
  }
}

test('Research Job 执行按真实阶段更新并保存原 ResearchResponse', async () => {
  const phases: string[] = []
  const readerStatuses: string[] = []
  let completedResponse: ResearchResponse | null = null
  await executeResearchJob(
    { jobId: 'job-a', ownerSessionId: 'owner-a', request },
    {
      markRunning: async () => job('running'),
      setPhase: async (_jobId, phase) => {
        phases.push(phase)
        return job('running')
      },
      incrementReader: async (_jobId, status) => {
        readerStatuses.push(status)
        return job('running')
      },
      research: async (_input, hooks) => {
        await hooks.onSearchCompleted?.(8)
        await hooks.onReaderStarted?.(3)
        await hooks.onReaderCompleted?.('full_text')
        await hooks.onReaderCompleted?.('partial')
        await hooks.onReaderCompleted?.('unavailable')
        await hooks.onSynthesisStarted?.()
        return response
      },
      complete: async (_owner, _jobId, _persisted, result) => {
        completedResponse = result
        return job('completed')
      },
    },
  )
  assert.deepEqual(phases, ['searching', 'reading', 'synthesizing'])
  assert.deepEqual(readerStatuses, ['full_text', 'partial', 'unavailable'])
  assert.deepEqual(completedResponse, response)
})

test('Research Job 失败会持久化当前错误且不会自动切换 mock', async () => {
  let failure: { code: string; message: string; status: number | null } | null = null
  await executeResearchJob(
    { jobId: 'job-failed', ownerSessionId: 'owner-a', request },
    {
      markRunning: async () => job('running'),
      research: async () => {
        throw new ResearchServiceError('RESEARCH_SEARCH_FAILED', 502, 'GLM 检索失败')
      },
      fail: async (_owner, _jobId, value) => {
        failure = value
        return job('failed')
      },
    },
  )
  assert.deepEqual(failure, {
    code: 'RESEARCH_SEARCH_FAILED',
    message: 'GLM 检索失败',
    status: 502,
  })
})

test('Stale Research Job 明确失败且不覆盖新 requestId', async () => {
  let completed = false
  let failure: { code: string; message: string; status: number | null } | null = null
  const logs: Array<Record<string, unknown>> = []
  const originalError = console.error
  console.error = (_message, details) => {
    if (details && typeof details === 'object') logs.push(details as Record<string, unknown>)
  }
  try {
    await executeResearchJob(
      { jobId: 'job-stale', ownerSessionId: 'owner-a', request },
      {
        markRunning: async () => job('running'),
        research: async () => response,
        complete: async () => {
          completed = true
          throw Object.assign(new StaleTaskWriteError(), {
            researchJobFailurePoint: 'persist_task',
          })
        },
        fail: async (_owner, _jobId, value) => {
          failure = value
          return job('failed')
        },
      },
    )
  } finally {
    console.error = originalError
  }
  assert.equal(completed, true)
  assert.deepEqual(failure, {
    code: 'STALE_TASK_WRITE',
    message: '该研究任务已被更新的请求替代，结果未写入当前任务。',
    status: 409,
  })
  assert.ok(logs.some((entry) => (
    entry.failurePoint === 'persist_task'
    && entry.errorName === 'StaleTaskWriteError'
    && entry.errorCode === 'STALE_TASK_WRITE'
  )))
})

test('Research Job 持久化异常保留 INTERNAL_ERROR 和准确 failurePoint', async () => {
  for (const failurePoint of ['persist_task', 'persist_job_complete'] as const) {
    let failureCode = ''
    const logs: Array<Record<string, unknown>> = []
    const originalError = console.error
    console.error = (_message, details) => {
      if (details && typeof details === 'object') logs.push(details as Record<string, unknown>)
    }
    try {
      await executeResearchJob(
        { jobId: `job-${failurePoint}`, ownerSessionId: 'owner-a', request },
        {
          markRunning: async () => job('running'),
          research: async () => response,
          complete: async () => {
            throw Object.assign(new Error('database failed'), {
              code: '08006',
              researchJobFailurePoint: failurePoint,
            })
          },
          fail: async (_owner, _jobId, value) => {
            failureCode = value.code
            return job('failed')
          },
        },
      )
    } finally {
      console.error = originalError
    }
    assert.equal(failureCode, 'INTERNAL_ERROR')
    assert.ok(logs.some((entry) => (
      entry.failurePoint === failurePoint && entry.errorCode === 'INTERNAL_ERROR'
    )))
  }
})

test('失败状态持久化异常单独记录 persist_job_failed', async () => {
  const logs: Array<Record<string, unknown>> = []
  const originalError = console.error
  console.error = (_message, details) => {
    if (details && typeof details === 'object') logs.push(details as Record<string, unknown>)
  }
  try {
    await executeResearchJob(
      { jobId: 'job-fail-persistence', ownerSessionId: 'owner-a', request },
      {
        markRunning: async () => job('running'),
        research: async () => { throw new Error('execution failed') },
        fail: async () => { throw Object.assign(new Error('database failed'), { code: '08006' }) },
      },
    )
  } finally {
    console.error = originalError
  }
  assert.ok(logs.some((entry) => (
    entry.failurePoint === 'persist_job_failed'
    && entry.databaseErrorCode === '08006'
  )))
})

test('Research Job scheduler 限制真正后台执行的生命周期并发', async () => {
  let active = 0
  let maxActive = 0
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const scheduler = new ResearchJobScheduler(2, async () => {
    active += 1
    maxActive = Math.max(maxActive, active)
    await gate
    active -= 1
  })
  for (let index = 0; index < 5; index += 1) {
    scheduler.schedule({
      jobId: `job-${index}`,
      ownerSessionId: 'owner-a',
      request: { ...request, requestId: `request-${index}` },
    })
  }
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(scheduler.getSnapshot().activeCount, 2)
  assert.equal(scheduler.getSnapshot().pendingCount, 3)
  assert.equal(maxActive, 2)
  release()
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(scheduler.getSnapshot().activeCount, 0)
})

test('polling 在 completed 后停止并返回最终结果', async () => {
  const states = [job('running'), job('completed')]
  let calls = 0
  const result = await pollResearchJob(job('running').jobId, {
    intervalMs: 0,
    request: async () => {
      const value = states[Math.min(calls, states.length - 1)]!
      calls += 1
      return value
    },
  })
  assert.equal(result.status, 'completed')
  assert.equal(calls, 2)
})

test('polling 在 failed 后停止且不调用任何 AI 接口', async () => {
  let calls = 0
  const result = await pollResearchJob(job('failed').jobId, {
    intervalMs: 0,
    request: async () => {
      calls += 1
      return job('failed')
    },
  })
  assert.equal(result.error?.code, 'RESEARCH_SEARCH_FAILED')
  assert.equal(calls, 1)
})

test('前端创建与读取 Job 使用独立异步 API', async () => {
  const originalFetch = globalThis.fetch
  const calls: string[] = []
  globalThis.fetch = async (input) => {
    calls.push(String(input))
    if (String(input) === '/api/research/jobs') {
      return new Response(JSON.stringify({ jobId: job('queued').jobId, status: 'queued' }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response(JSON.stringify(job('running')), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  try {
    const created = await requestCreateResearchJob(request)
    await requestResearchJob(created.jobId)
  } finally {
    globalThis.fetch = originalFetch
  }
  assert.deepEqual(calls, [
    '/api/research/jobs',
    `/api/research/jobs/${job('queued').jobId}`,
  ])
})

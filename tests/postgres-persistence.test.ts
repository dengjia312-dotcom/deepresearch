import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { runDatabaseMigrations } from '../server/db/migrate'
import { getOrCreateAnonymousSession, hashClientSessionId } from '../server/db/repositories/sessionRepository'
import {
  addOwnedPoolItem,
  completeOwnedOutline,
  completeOwnedPlan,
  completeOwnedReport,
  completeOwnedResearch,
  createOwnedTask,
  failOwnedStage,
  getOwnedTaskDetail,
  importOwnedTaskState,
  listOwnedTasks,
  recoverInterruptedStages,
  startOwnedStage,
  updateOwnedPoolItem,
} from '../server/db/repositories/taskRepository'
import { InvalidCitationError, StaleTaskWriteError, TaskNotFoundError, TaskOwnershipConflictError } from '../server/db/errors'
import {
  completeResearchJob,
  createOrReuseOwnedResearchJob,
  getOwnedResearchJob,
  incrementResearchJobReaderProgress,
  markResearchJobRunning,
  recoverInterruptedResearchJobs,
  setResearchJobPhase,
} from '../server/db/repositories/researchJobRepository'
import type { ResearchRequest, ResearchResponse } from '../server/types/research'
import type {
  LiveOutlineResult,
  LiveReportResult,
  LiveResearchResult,
  ResearchPlan,
  ResearchTask,
  Source,
} from '../src/types'

const connectionString = process.env.TEST_DATABASE_URL?.trim()
const skipReason = connectionString ? false : '需要真实 TEST_DATABASE_URL；不使用 mock 或内存数据库替代。'
const { Pool } = pg
let adminPool: pg.Pool
let pool: pg.Pool
let schema = ''

if (connectionString) {
  before(async () => {
    process.env.SESSION_HASH_SECRET = 'postgres-test-session-secret-at-least-32-characters'
    schema = `deep_research_${randomUUID().replaceAll('-', '')}`
    adminPool = new Pool({ connectionString })
    await adminPool.query(`CREATE SCHEMA ${schema}`)
    pool = new Pool({ connectionString, options: `-c search_path=${schema}` })
    await runDatabaseMigrations(pool)
  })

  beforeEach(async () => {
    await pool.query('TRUNCATE anonymous_sessions CASCADE')
  })

  after(async () => {
    await pool.end()
    await adminPool.query(`DROP SCHEMA ${schema} CASCADE`)
    await adminPool.end()
  })
}

function pgTest(name: string, fn: () => void | Promise<void>) {
  test(name, { skip: skipReason }, fn)
}

function task(taskId = `task-${randomUUID()}`): ResearchTask {
  return {
    id: taskId,
    title: 'PostgreSQL persistence test',
    query: 'PostgreSQL persistence test',
    topicId: 'generic',
    usesPrototypeData: false,
    dataSource: 'real',
    depth: 'deep',
    searchDepth: 'standard',
    targetSourceCount: 12,
    reportDepth: 'brief',
    reportTargetMinWords: 800,
    reportTargetMaxWords: 1200,
    status: 'draft',
    createdAt: new Date().toISOString(),
  }
}

function plan(label = 'current'): ResearchPlan {
  const now = new Date().toISOString()
  return {
    objective: `${label} objective`,
    scope: `${label} scope`,
    questions: [{ id: 'q-1', text: `${label} question` }],
    sourcePreferences: ['瀹樻柟璧勬枡' as never],
    estimatedSourceCount: 12,
    estimatedDurationMinutes: 5,
    usesPrototypeData: false,
    dataSource: 'real',
    updatedAt: now,
    confirmedAt: now,
  }
}

function source(id = 'source-a'): Source {
  return {
    id,
    rank: 1,
    title: `Source ${id}`,
    type: 'web',
    publisher: 'Test publisher',
    url: `https://example.com/${id}`,
    publishDate: '2026-01-01',
    freshness: 'current',
    credibility: 'high',
    tags: ['test'],
    summary: 'Summary',
    keyInsight: 'Insight',
    addedToPool: true,
    excerpt: ['Evidence'],
    insights: ['Insight'],
    origin: 'real',
  }
}

function researchResult(items: Source[]): LiveResearchResult {
  return {
    mode: 'live', dataSource: 'real', topic: 'test', summary: 'summary', insights: [],
    sources: items, warnings: [], targetSourceCount: 12, actualSourceCount: items.length,
    deduplicatedSourceCount: items.length, validSourceCount: items.length,
    searchedAt: new Date().toISOString(),
  }
}

function jobRequest(taskId: string, requestId = `request-${randomUUID()}`): ResearchRequest {
  return {
    taskId,
    requestId,
    topic: 'PostgreSQL persistence test',
    goal: 'Research job persistence',
    sourcePreferences: ['行业研究'],
    targetSourceCount: 12,
  }
}

function jobResponse(input: ResearchRequest): ResearchResponse {
  return {
    taskId: input.taskId,
    requestId: input.requestId,
    mode: 'live',
    dataSource: 'real',
    topic: input.topic,
    summary: 'summary',
    insights: [],
    sources: [{
      id: 'source-a', title: 'Source A', url: 'https://example.com/source-a',
      publisher: 'Publisher', publishedAt: '2026-08-30', type: 'web',
      credibility: '待评估', summary: 'summary', keyInsight: 'insight',
    }],
    warnings: [],
    targetSourceCount: 12,
    actualSourceCount: 1,
    deduplicatedSourceCount: 1,
    validSourceCount: 1,
    searchedAt: new Date().toISOString(),
  }
}

function outlineResult(sourceId: string): LiveOutlineResult {
  return {
    mode: 'live', dataSource: 'real', warnings: [], generatedAt: new Date().toISOString(),
    outline: {
      title: 'Outline',
      sections: [{
        id: 'section-1', title: 'Section', description: 'Description', sourceIds: [sourceId],
        evidenceStatus: 'limited', children: [],
      }],
    },
  }
}

function reportResult(sourceId: string): LiveReportResult {
  return {
    mode: 'live', dataSource: 'real', warnings: [], reportDepth: 'brief',
    targetMinWords: 800, targetMaxWords: 1200, actualWordCount: 900,
    generatedAt: new Date().toISOString(),
    report: {
      title: 'Report', executiveSummary: 'Summary', conclusion: 'Conclusion', limitations: [],
      sections: [{
        id: 'section-1', title: 'Section',
        paragraphs: [{ id: 'paragraph-1', content: 'Claim', sourceIds: [sourceId], claimType: 'source_supported' }],
      }],
    },
  }
}

async function owner(raw = randomUUID()) {
  return getOrCreateAnonymousSession(raw, pool)
}

async function created(ownerId: string, taskId = `task-${randomUUID()}`) {
  return createOwnedTask(ownerId, { task: task(taskId) }, pool)
}

async function completedChain(ownerId: string, taskId = `task-${randomUUID()}`) {
  await created(ownerId, taskId)
  await startOwnedStage(ownerId, taskId, 'plan', 'plan-1', new Date().toISOString(), {}, pool)
  await completeOwnedPlan(ownerId, taskId, 'plan-1', plan('old'), pool)
  await startOwnedStage(ownerId, taskId, 'research', 'research-1', new Date().toISOString(), {}, pool)
  await completeOwnedResearch(ownerId, taskId, 'research-1', researchResult([source('source-a')]), pool)
  await addOwnedPoolItem(ownerId, taskId, source('source-a'), 'real', pool)
  const beforeOutline = await getOwnedTaskDetail(ownerId, taskId, pool)
  await startOwnedStage(ownerId, taskId, 'outline', 'outline-1', new Date().toISOString(), {
    poolVersion: beforeOutline.state.poolVersion,
  }, pool)
  await completeOwnedOutline(
    ownerId, taskId, 'outline-1', beforeOutline.state.poolVersion, outlineResult('source-a'), pool,
  )
  const beforeReport = await getOwnedTaskDetail(ownerId, taskId, pool)
  const versions = {
    poolVersion: beforeReport.state.poolVersion,
    outlineVersion: beforeReport.state.outlineVersion,
    reportConfigVersion: beforeReport.state.reportConfigVersion,
  }
  await startOwnedStage(ownerId, taskId, 'report', 'report-1', new Date().toISOString(), versions, pool)
  await completeOwnedReport(ownerId, taskId, 'report-1', versions, reportResult('source-a'), pool)
  return getOwnedTaskDetail(ownerId, taskId, pool)
}

pgTest('1. 空数据库 migration 成功', async () => {
  const tables = await pool.query<{ count: string }>(`
    SELECT count(*) FROM information_schema.tables WHERE table_schema = current_schema()
  `)
  assert.equal(Number(tables.rows[0].count) >= 10, true)
})

pgTest('2. migration 可重复执行', async () => {
  await runDatabaseMigrations(pool)
  await runDatabaseMigrations(pool)
  const rows = await pool.query('SELECT * FROM schema_migrations')
  assert.equal(rows.rowCount, 2)
})

pgTest('Research Job 同 task/request 幂等且只归所属 session 可读', async () => {
  const ownerId = await owner()
  const otherOwnerId = await owner()
  const detail = await created(ownerId)
  const input = jobRequest(detail.state.task.id)
  const first = await createOrReuseOwnedResearchJob(ownerId, randomUUID(), input, pool)
  const duplicate = await createOrReuseOwnedResearchJob(ownerId, randomUUID(), input, pool)
  assert.equal(first.created, true)
  assert.equal(duplicate.created, false)
  assert.equal(duplicate.job.jobId, first.job.jobId)
  await assert.rejects(
    () => getOwnedResearchJob(otherOwnerId, first.job.jobId, pool),
    TaskNotFoundError,
  )
})

pgTest('Research Job 保存真实阶段进度并与任务结果原子完成', async () => {
  const ownerId = await owner()
  const detail = await created(ownerId)
  const input = jobRequest(detail.state.task.id)
  const createdJob = await createOrReuseOwnedResearchJob(ownerId, randomUUID(), input, pool)
  await markResearchJobRunning(createdJob.job.jobId, pool)
  await setResearchJobPhase(createdJob.job.jobId, 'searching', { validSourceCount: 7 }, pool)
  await setResearchJobPhase(createdJob.job.jobId, 'reading', { readerTargetCount: 2 }, pool)
  await incrementResearchJobReaderProgress(createdJob.job.jobId, 'full_text', pool)
  await incrementResearchJobReaderProgress(createdJob.job.jobId, 'partial', pool)
  await setResearchJobPhase(createdJob.job.jobId, 'synthesizing', {}, pool)
  const apiResult = jobResponse(input)
  const persisted = researchResult([source('source-a')])
  const completed = await completeResearchJob(
    ownerId,
    createdJob.job.jobId,
    persisted,
    apiResult,
    pool,
  )
  assert.equal(completed.status, 'completed')
  assert.equal(completed.progress.readerCompletedCount, 2)
  assert.equal(completed.progress.fullTextCount, 1)
  assert.equal(completed.progress.partialCount, 1)
  assert.deepEqual(completed.result, apiResult)
  const restored = await getOwnedTaskDetail(ownerId, detail.state.task.id, pool)
  assert.equal(restored.state.searchStatus, 'success')
  assert.equal(restored.state.researchJobId, createdJob.job.jobId)
  assert.deepEqual(restored.state.liveResearchResult, persisted)
})

pgTest('旧 requestId Job 完成不能覆盖更新请求', async () => {
  const ownerId = await owner()
  const detail = await created(ownerId)
  const oldRequest = jobRequest(detail.state.task.id, 'old-request')
  const oldJob = await createOrReuseOwnedResearchJob(ownerId, randomUUID(), oldRequest, pool)
  await markResearchJobRunning(oldJob.job.jobId, pool)
  const newRequest = jobRequest(detail.state.task.id, 'new-request')
  await createOrReuseOwnedResearchJob(ownerId, randomUUID(), newRequest, pool)
  await assert.rejects(
    () => completeResearchJob(
      ownerId,
      oldJob.job.jobId,
      researchResult([source('old-source')]),
      jobResponse(oldRequest),
      pool,
    ),
    StaleTaskWriteError,
  )
  const restored = await getOwnedTaskDetail(ownerId, detail.state.task.id, pool)
  assert.equal(restored.state.requests.research.requestId, 'new-request')
  assert.equal(restored.state.liveResearchResult, null)
})

pgTest('服务重启把 queued/running Job 标记为可重试失败', async () => {
  const ownerId = await owner()
  const detail = await created(ownerId)
  const input = jobRequest(detail.state.task.id)
  const createdJob = await createOrReuseOwnedResearchJob(ownerId, randomUUID(), input, pool)
  await markResearchJobRunning(createdJob.job.jobId, pool)
  assert.equal(await recoverInterruptedResearchJobs(pool), 1)
  const recovered = await getOwnedResearchJob(ownerId, createdJob.job.jobId, pool)
  assert.equal(recovered.status, 'failed')
  assert.equal(recovered.phase, 'failed')
  assert.equal(recovered.error?.code, 'RESEARCH_JOB_INTERRUPTED')
  const restored = await getOwnedTaskDetail(ownerId, detail.state.task.id, pool)
  assert.equal(restored.state.searchStatus, 'error')
  assert.equal(restored.state.requests.research.lastErrorCode, 'RESEARCH_JOB_INTERRUPTED')
})

pgTest('3. 原始 sessionId 不进入数据库', async () => {
  const raw = randomUUID()
  await owner(raw)
  const rows = await pool.query<{ session_key_hash: string }>('SELECT session_key_hash FROM anonymous_sessions')
  assert.equal(rows.rows[0].session_key_hash, hashClientSessionId(raw))
  assert.notEqual(rows.rows[0].session_key_hash, raw)
})

pgTest('4. 同 session 得到同一个 anonymous_session', async () => {
  const raw = randomUUID()
  assert.equal(await owner(raw), await owner(raw))
  assert.equal((await pool.query('SELECT * FROM anonymous_sessions')).rowCount, 1)
})

pgTest('5. A/B session 任务完全隔离', async () => {
  const a = await owner(), b = await owner()
  await created(a)
  await created(b)
  assert.equal((await listOwnedTasks(a, pool)).length, 1)
  assert.equal((await listOwnedTasks(b, pool)).length, 1)
})

pgTest('6. 修改 taskId 无法读取别人任务', async () => {
  const a = await owner(), b = await owner()
  const detail = await created(a)
  await assert.rejects(() => getOwnedTaskDetail(b, detail.state.task.id, pool), TaskNotFoundError)
})

pgTest('7. 创建 task 后可完整恢复', async () => {
  const ownerId = await owner()
  const original = await completedChain(ownerId)
  const restored = await getOwnedTaskDetail(ownerId, original.state.task.id, pool)
  assert.deepEqual(restored.state, original.state)
  assert.equal(restored.citations.length, 1)
})

pgTest('8. 创建 task 事务失败不会留下半条记录', async () => {
  const ownerId = await owner()
  const invalid = task()
  invalid.targetSourceCount = 100
  await assert.rejects(() => createOwnedTask(ownerId, { task: invalid }, pool))
  assert.equal((await pool.query('SELECT * FROM research_tasks')).rowCount, 0)
  assert.equal((await pool.query('SELECT * FROM research_task_stages')).rowCount, 0)
})

pgTest('9. 创建 task 自动创建四个 stage', async () => {
  const ownerId = await owner()
  const detail = await created(ownerId)
  const rows = await pool.query('SELECT stage FROM research_task_stages WHERE task_id = $1', [detail.state.task.id])
  assert.equal(rows.rowCount, 4)
})

pgTest('10. Plan 重试失败保留旧 Plan 和下游', async () => {
  const ownerId = await owner()
  const old = await completedChain(ownerId)
  const id = old.state.task.id
  await startOwnedStage(ownerId, id, 'plan', 'plan-retry', new Date().toISOString(), {}, pool)
  await failOwnedStage(ownerId, id, 'plan', 'plan-retry', {
    errorCode: 'UPSTREAM_TIMEOUT', errorStatus: 504, errorMessage: 'timeout', failedAt: new Date().toISOString(),
  }, pool)
  const next = await getOwnedTaskDetail(ownerId, id, pool)
  assert.equal(next.state.researchPlan?.objective, old.state.researchPlan?.objective)
  assert.ok(next.state.liveResearchResult && next.state.liveOutline && next.state.liveReport)
  assert.equal(next.state.poolItems.length, 1)
})

pgTest('11. Plan 成功原子替换并清理旧下游', async () => {
  const ownerId = await owner()
  const old = await completedChain(ownerId)
  const id = old.state.task.id
  await startOwnedStage(ownerId, id, 'plan', 'plan-new', new Date().toISOString(), {}, pool)
  const next = await completeOwnedPlan(ownerId, id, 'plan-new', plan('new'), pool)
  assert.equal(next.state.researchPlan?.objective, 'new objective')
  assert.equal(next.state.liveResearchResult, null)
  assert.equal(next.state.poolItems.length, 0)
  assert.equal(next.state.liveOutline, null)
  assert.equal(next.state.liveReport, null)
  assert.equal(next.citations.length, 0)
})

pgTest('12. Research 失败保留旧数据', async () => {
  const ownerId = await owner()
  const old = await completedChain(ownerId)
  await startOwnedStage(ownerId, old.state.task.id, 'research', 'research-retry', new Date().toISOString(), {}, pool)
  await failOwnedStage(ownerId, old.state.task.id, 'research', 'research-retry', {
    errorCode: 'NETWORK_ERROR', errorStatus: null, errorMessage: 'network', failedAt: new Date().toISOString(),
  }, pool)
  const next = await getOwnedTaskDetail(ownerId, old.state.task.id, pool)
  assert.deepEqual(next.state.liveResearchResult, old.state.liveResearchResult)
  assert.ok(next.state.researchPlan && next.state.liveOutline && next.state.liveReport)
})

pgTest('13. Pool 修改正确递增 poolVersion', async () => {
  const ownerId = await owner()
  const detail = await created(ownerId)
  const id = detail.state.task.id
  const added = await addOwnedPoolItem(ownerId, id, source(), 'real', pool)
  const updated = await updateOwnedPoolItem(ownerId, id, 'source-a', { reviewStatus: 'trusted' }, pool)
  assert.equal(added.state.poolVersion, detail.state.poolVersion + 1)
  assert.equal(updated.state.poolVersion, added.state.poolVersion + 1)
})

pgTest('14. Outline 失败保留旧 Outline Report Pool', async () => {
  const ownerId = await owner()
  const old = await completedChain(ownerId)
  const id = old.state.task.id
  await startOwnedStage(ownerId, id, 'outline', 'outline-retry', new Date().toISOString(), {
    poolVersion: old.state.poolVersion,
  }, pool)
  await failOwnedStage(ownerId, id, 'outline', 'outline-retry', {
    errorCode: 'UPSTREAM_ERROR', errorStatus: 503, errorMessage: 'failed', failedAt: new Date().toISOString(),
  }, pool)
  const next = await getOwnedTaskDetail(ownerId, id, pool)
  assert.deepEqual(next.state.liveOutline, old.state.liveOutline)
  assert.deepEqual(next.state.liveReport, old.state.liveReport)
  assert.deepEqual(next.state.poolItems, old.state.poolItems)
})

pgTest('15. Outline 成功后旧 Report 才失效', async () => {
  const ownerId = await owner()
  const old = await completedChain(ownerId)
  const id = old.state.task.id
  await startOwnedStage(ownerId, id, 'outline', 'outline-new', new Date().toISOString(), {
    poolVersion: old.state.poolVersion,
  }, pool)
  const loading = await getOwnedTaskDetail(ownerId, id, pool)
  assert.ok(loading.state.liveReport)
  const next = await completeOwnedOutline(ownerId, id, 'outline-new', old.state.poolVersion, outlineResult('source-a'), pool)
  assert.equal(next.state.liveReport, null)
  assert.equal(next.citations.length, 0)
})

pgTest('16. Report 失败保留旧报告', async () => {
  const ownerId = await owner()
  const old = await completedChain(ownerId)
  const id = old.state.task.id
  const versions = { poolVersion: old.state.poolVersion, outlineVersion: old.state.outlineVersion, reportConfigVersion: old.state.reportConfigVersion }
  await startOwnedStage(ownerId, id, 'report', 'report-retry', new Date().toISOString(), versions, pool)
  await failOwnedStage(ownerId, id, 'report', 'report-retry', {
    errorCode: 'UPSTREAM_TIMEOUT', errorStatus: 504, errorMessage: 'timeout', failedAt: new Date().toISOString(),
  }, pool)
  const next = await getOwnedTaskDetail(ownerId, id, pool)
  assert.deepEqual(next.state.liveReport, old.state.liveReport)
  assert.deepEqual(next.citations, old.citations)
})

pgTest('17. Report 和 citations 同事务写入', async () => {
  const ownerId = await owner()
  const detail = await completedChain(ownerId)
  assert.ok(detail.state.liveReport)
  assert.equal(detail.citations.length, 1)
})

pgTest('18. 非法 citation 使整个事务回滚', async () => {
  const ownerId = await owner()
  const old = await completedChain(ownerId)
  const id = old.state.task.id
  const versions = { poolVersion: old.state.poolVersion, outlineVersion: old.state.outlineVersion, reportConfigVersion: old.state.reportConfigVersion }
  await startOwnedStage(ownerId, id, 'report', 'report-invalid', new Date().toISOString(), versions, pool)
  await assert.rejects(
    () => completeOwnedReport(ownerId, id, 'report-invalid', versions, reportResult('unknown-source'), pool),
    InvalidCitationError,
  )
  const next = await getOwnedTaskDetail(ownerId, id, pool)
  assert.deepEqual(next.state.liveReport, old.state.liveReport)
  assert.deepEqual(next.citations, old.citations)
})

pgTest('19. A task citation 无法指向 B task source', async () => {
  const ownerId = await owner()
  const a = await completedChain(ownerId)
  const b = await created(ownerId)
  await addOwnedPoolItem(ownerId, b.state.task.id, source('source-b'), 'real', pool)
  const versions = { poolVersion: a.state.poolVersion, outlineVersion: a.state.outlineVersion, reportConfigVersion: a.state.reportConfigVersion }
  await startOwnedStage(ownerId, a.state.task.id, 'report', 'cross-report', new Date().toISOString(), versions, pool)
  await assert.rejects(
    () => completeOwnedReport(ownerId, a.state.task.id, 'cross-report', versions, reportResult('source-b'), pool),
    InvalidCitationError,
  )
})

pgTest('20. 旧 requestId 写入被拒绝', async () => {
  const ownerId = await owner()
  const detail = await created(ownerId)
  const id = detail.state.task.id
  await startOwnedStage(ownerId, id, 'plan', 'old', new Date().toISOString(), {}, pool)
  await startOwnedStage(ownerId, id, 'plan', 'new', new Date().toISOString(), {}, pool)
  await assert.rejects(() => completeOwnedPlan(ownerId, id, 'old', plan(), pool), StaleTaskWriteError)
})

pgTest('21. 旧 poolVersion 写 Outline 被拒绝', async () => {
  const ownerId = await owner()
  const detail = await created(ownerId)
  const id = detail.state.task.id
  await addOwnedPoolItem(ownerId, id, source(), 'real', pool)
  const current = await getOwnedTaskDetail(ownerId, id, pool)
  await startOwnedStage(ownerId, id, 'outline', 'outline', new Date().toISOString(), { poolVersion: current.state.poolVersion }, pool)
  await updateOwnedPoolItem(ownerId, id, 'source-a', { reviewStatus: 'trusted' }, pool)
  await assert.rejects(
    () => completeOwnedOutline(ownerId, id, 'outline', current.state.poolVersion, outlineResult('source-a'), pool),
    StaleTaskWriteError,
  )
})

pgTest('22. 旧 outlineVersion 写 Report 被拒绝', async () => {
  const ownerId = await owner()
  const current = await completedChain(ownerId)
  const id = current.state.task.id
  const stale = { poolVersion: current.state.poolVersion, outlineVersion: current.state.outlineVersion - 1, reportConfigVersion: current.state.reportConfigVersion }
  await assert.rejects(
    () => startOwnedStage(ownerId, id, 'report', 'stale', new Date().toISOString(), stale, pool),
    StaleTaskWriteError,
  )
})

pgTest('23. server restart 后 loading 恢复为 retryable error', async () => {
  const ownerId = await owner()
  const detail = await created(ownerId)
  await startOwnedStage(ownerId, detail.state.task.id, 'research', 'interrupted', new Date().toISOString(), {}, pool)
  await recoverInterruptedStages(pool)
  const restored = await getOwnedTaskDetail(ownerId, detail.state.task.id, pool)
  assert.equal(restored.state.searchStatus, 'error')
  assert.equal(restored.state.requests.research.lastErrorCode, 'REQUEST_INTERRUPTED')
})

pgTest('24. localStorage v4 规范化状态可导入', async () => {
  const ownerId = await owner()
  const original = await completedChain(ownerId)
  const importedId = `task-${randomUUID()}`
  const importedState = { ...original.state, task: { ...original.state.task, id: importedId } }
  const result = await importOwnedTaskState(ownerId, importedState, pool)
  assert.equal(result.imported, true)
  assert.ok(result.detail.state.liveReport)
})

pgTest('25. v4 import 重复执行不重复数据', async () => {
  const ownerId = await owner()
  const original = await completedChain(ownerId)
  const first = await importOwnedTaskState(ownerId, original.state, pool)
  assert.equal(first.imported, false)
  assert.equal((await listOwnedTasks(ownerId, pool)).length, 1)
})

pgTest('26. 不同 session 的相同 taskId 不允许覆盖', async () => {
  const a = await owner(), b = await owner()
  const original = await completedChain(a)
  await assert.rejects(() => importOwnedTaskState(b, original.state, pool), TaskOwnershipConflictError)
})

pgTest('27. 数据库约束失败时不会产生假成功任务', async () => {
  const ownerId = await owner()
  const invalid = task()
  invalid.reportTargetMinWords = -1
  await assert.rejects(() => createOwnedTask(ownerId, { task: invalid }, pool))
  assert.equal((await listOwnedTasks(ownerId, pool)).length, 0)
})

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
  confirmOwnedResearchIntent,
  createOwnedTask,
  failOwnedStage,
  getOwnedTaskDetail,
  getOwnedResearchPlanStrategySnapshot,
  importOwnedTaskState,
  listOwnedTasks,
  recoverInterruptedStages,
  saveOwnedPlan,
  startOwnedStage,
  updateOwnedPoolItem,
} from '../server/db/repositories/taskRepository'
import { InvalidCitationError, StaleTaskWriteError, TaskNotFoundError, TaskOwnershipConflictError } from '../server/db/errors'
import {
  completeResearchJob,
  assertResearchJobStillCurrent,
  createOrReuseOwnedResearchJob,
  getOwnedResearchJob,
  incrementResearchJobReaderProgress,
  markResearchJobRunning,
  recoverInterruptedResearchJobs,
  setResearchJobPhase,
  updateResearchJobAgentCheckpoint,
} from '../server/db/repositories/researchJobRepository'
import type {
  ResearchAgentCheckpoint,
  ResearchRequest,
  ResearchResponse,
  ResearchStrategy,
} from '../server/types/research'
import type {
  LiveOutlineResult,
  LiveReportResult,
  LiveResearchResult,
  ResearchPlan,
  ResearchTask,
  Source,
} from '../src/types'
import { exportOwnedReport } from '../server/reporting/reportExportService'
import { ReportNotReadyError } from '../server/reporting/reportDocument'
import { createFallbackResearchStrategy } from '../server/services/researchStrategyService'
import { ResearchServiceError } from '../server/services/serviceError'

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

function confirmedStrategyForPending(strategy: ResearchStrategy): ResearchStrategy {
  const candidate = strategy.intentConfirmation.candidates[0]!
  const intent = {
    normalizedTopic: candidate.label,
    researchObject: candidate.researchObject,
    userIntent: candidate.description,
    scope: candidate.scope,
    excludedMeanings: candidate.excludedMeanings,
    keyConcepts: candidate.keyConcepts,
    ambiguityDetected: false,
  }
  return {
    version: 2,
    intent,
    queryPlan: { queries: [
      { id: 'query-1', query: `${candidate.keyConcepts[0]} 发展趋势`, purpose: '发展趋势', priority: 1 },
      { id: 'query-2', query: `${candidate.keyConcepts[1]} 就业前景`, purpose: '就业前景', priority: 2 },
      { id: 'query-3', query: `${candidate.keyConcepts[2]} 能力要求`, purpose: '能力要求', priority: 3 },
    ] },
    intentConfirmation: {
      status: 'confirmed',
      candidates: strategy.intentConfirmation.candidates,
      confirmedIntent: {
        source: 'candidate',
        candidateId: candidate.id,
        label: candidate.label,
        normalizedTopic: intent.normalizedTopic,
        researchObject: intent.researchObject,
        userIntent: intent.userIntent,
        scope: intent.scope,
        excludedMeanings: intent.excludedMeanings,
        keyConcepts: intent.keyConcepts,
      },
    },
    queryPlanStatus: 'ready',
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

async function researchReady(ownerId: string, taskId = `task-${randomUUID()}`) {
  await created(ownerId, taskId)
  await startOwnedStage(ownerId, taskId, 'plan', 'plan-ready', new Date().toISOString(), {}, pool)
  await completeOwnedPlan(ownerId, taskId, 'plan-ready', plan('ready'), pool)
  return getOwnedTaskDetail(ownerId, taskId, pool)
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

pgTest('新版 pending Intent 在 Job 事务入口被阻止且不创建 Job/不启动 stage', async () => {
  const ownerId = await owner()
  const detail = await created(ownerId)
  const strategy = createFallbackResearchStrategy({
    topic: '环境设计的未来',
    goal: '分析环境设计专业未来发展方向、就业前景、行业趋势和能力要求。',
  })
  const managedPlan = {
    ...plan('ambiguous'),
    _researchStrategy: strategy,
    _researchStrategyVersion: 2 as const,
  }
  await startOwnedStage(ownerId, detail.state.task.id, 'plan', 'plan-managed', new Date().toISOString(), {}, pool)
  await completeOwnedPlan(ownerId, detail.state.task.id, 'plan-managed', managedPlan, pool)
  await assert.rejects(
    () => createOrReuseOwnedResearchJob(
      ownerId,
      randomUUID(),
      jobRequest(detail.state.task.id),
      pool,
    ),
    (error) => error instanceof ResearchServiceError
      && error.code === 'RESEARCH_INTENT_CONFIRMATION_REQUIRED',
  )
  assert.equal((await pool.query('SELECT * FROM research_jobs')).rowCount, 0)
  const restored = await getOwnedTaskDetail(ownerId, detail.state.task.id, pool)
  assert.equal(restored.state.searchStatus, 'idle')
  assert.equal(restored.state.requests.research.requestId, null)
})

pgTest('pending Intent 即使存在同 requestId queued Job 也不能绕过 Gate', async () => {
  const ownerId = await owner()
  const detail = await created(ownerId)
  const strategy = createFallbackResearchStrategy({
    topic: '环境设计的未来',
    goal: '分析环境设计专业未来发展方向、就业前景、行业趋势和能力要求。',
  })
  const managedPlan = {
    ...plan('ambiguous-existing'),
    _researchStrategy: strategy,
    _researchStrategyVersion: 2 as const,
  }
  await startOwnedStage(ownerId, detail.state.task.id, 'plan', 'plan-managed-existing', new Date().toISOString(), {}, pool)
  await completeOwnedPlan(ownerId, detail.state.task.id, 'plan-managed-existing', managedPlan, pool)
  const request = jobRequest(detail.state.task.id, 'existing-pending-request')
  await pool.query(`
    INSERT INTO research_jobs(id, task_id, owner_session_id, request_id, status, phase)
    VALUES ($1, $2, $3, $4, 'queued', 'queued')
  `, [randomUUID(), detail.state.task.id, ownerId, request.requestId])
  await assert.rejects(
    () => createOrReuseOwnedResearchJob(ownerId, randomUUID(), request, pool),
    (error) => error instanceof ResearchServiceError
      && error.code === 'RESEARCH_INTENT_CONFIRMATION_REQUIRED',
  )
  assert.equal((await pool.query('SELECT * FROM research_jobs')).rowCount, 1)
  const restored = await getOwnedTaskDetail(ownerId, detail.state.task.id, pool)
  assert.equal(restored.state.searchStatus, 'idle')
  assert.equal(restored.state.requests.research.requestId, null)
})

pgTest('Intent repository transaction 只允许 pending -> confirmed', async () => {
  const ownerId = await owner()
  const detail = await created(ownerId)
  const pending = createFallbackResearchStrategy({
    topic: '环境设计的未来',
    goal: '分析环境设计专业未来发展方向、就业前景、行业趋势和能力要求。',
  })
  await startOwnedStage(ownerId, detail.state.task.id, 'plan', 'plan-confirm-state', new Date().toISOString(), {}, pool)
  const withPending = await completeOwnedPlan(ownerId, detail.state.task.id, 'plan-confirm-state', {
    ...plan('confirm-state'),
    _researchStrategy: pending,
    _researchStrategyVersion: 2 as const,
  }, pool)
  const confirmed = confirmedStrategyForPending(pending)
  const afterConfirm = await confirmOwnedResearchIntent(
    ownerId,
    detail.state.task.id,
    withPending.state.revision,
    confirmed,
    pool,
  )
  await assert.rejects(
    () => confirmOwnedResearchIntent(
      ownerId,
      detail.state.task.id,
      afterConfirm.state.revision,
      confirmed,
      pool,
    ),
    (error) => error instanceof ResearchServiceError
      && error.code === 'INVALID_RESEARCH_INTENT'
      && error.status === 409,
  )
})

pgTest('v2 marker 缺失 Strategy 的 Plan save 返回 INVALID_RESEARCH_INTENT', async () => {
  const ownerId = await owner()
  const detail = await created(ownerId)
  const corruptPlan = { ...plan('corrupt'), _researchStrategyVersion: 2 as const }
  await startOwnedStage(ownerId, detail.state.task.id, 'plan', 'plan-corrupt', new Date().toISOString(), {}, pool)
  await completeOwnedPlan(ownerId, detail.state.task.id, 'plan-corrupt', corruptPlan, pool)
  await assert.rejects(
    () => saveOwnedPlan(
      ownerId,
      detail.state.task.id,
      { ...plan('corrupt'), estimatedSourceCount: 20 },
      true,
      { searchDepth: 'deep', targetSourceCount: 20 },
      undefined,
      undefined,
      pool,
    ),
    (error) => error instanceof ResearchServiceError
      && error.code === 'INVALID_RESEARCH_INTENT',
  )
  const snapshot = await getOwnedResearchPlanStrategySnapshot(ownerId, detail.state.task.id, pool)
  assert.equal(snapshot.strategyVersion, 2)
  assert.equal(snapshot.strategy, null)
})

pgTest('仅修改 searchDepth/targetSourceCount 不使 managed QueryPlan stale', async () => {
  const ownerId = await owner()
  const detail = await created(ownerId)
  const basePlan = plan('search-config')
  const strategy = createFallbackResearchStrategy({
    topic: detail.state.task.title,
    goal: basePlan.objective,
    scope: basePlan.scope,
  })
  await startOwnedStage(ownerId, detail.state.task.id, 'plan', 'plan-search-config', new Date().toISOString(), {}, pool)
  await completeOwnedPlan(ownerId, detail.state.task.id, 'plan-search-config', {
    ...basePlan,
    _researchStrategy: strategy,
    _researchStrategyVersion: 2 as const,
  }, pool)
  await saveOwnedPlan(
    ownerId,
    detail.state.task.id,
    { ...basePlan, estimatedSourceCount: 24, confirmedAt: null },
    true,
    { searchDepth: 'deep', targetSourceCount: 24 },
    undefined,
    undefined,
    pool,
  )
  const snapshot = await getOwnedResearchPlanStrategySnapshot(ownerId, detail.state.task.id, pool)
  assert.equal(snapshot.strategy?.queryPlanStatus, 'ready')
  assert.deepEqual(snapshot.strategy?.queryPlan, strategy.queryPlan)
  assert.equal(snapshot.task.searchDepth, 'deep')
  assert.equal(snapshot.task.targetSourceCount, 24)
})

pgTest('Plan 编辑保留受管 Intent 元数据并显式使 QueryPlan 失效', async () => {
  const ownerId = await owner()
  const detail = await created(ownerId)
  const strategy = createFallbackResearchStrategy({
    topic: '环境设计的未来',
    goal: '分析环境设计专业就业和行业发展',
  })
  const originalPlan = {
    ...plan('managed'),
    _researchStrategy: strategy,
    _researchStrategyVersion: 2 as const,
  }
  await startOwnedStage(ownerId, detail.state.task.id, 'plan', 'plan-managed', new Date().toISOString(), {}, pool)
  await completeOwnedPlan(ownerId, detail.state.task.id, 'plan-managed', originalPlan, pool)
  await saveOwnedPlan(
    ownerId,
    detail.state.task.id,
    { ...plan('edited'), confirmedAt: null },
    true,
    { searchDepth: 'standard', targetSourceCount: 12 },
    undefined,
    undefined,
    pool,
  )
  const snapshot = await getOwnedResearchPlanStrategySnapshot(ownerId, detail.state.task.id, pool)
  assert.equal(snapshot.strategyVersion, 2)
  assert.equal(snapshot.strategy?.intentConfirmation.status, 'pending')
  assert.equal(snapshot.strategy?.intentConfirmation.candidates.length, 2)
  assert.equal(snapshot.strategy?.queryPlanStatus, 'pending_confirmation')
  assert.deepEqual(snapshot.strategy?.queryPlan.queries, [])
  assert.equal(snapshot.publicPlan?.intentConfirmation?.status, 'pending')
})

pgTest('Research Job 同 task/request 幂等且只归所属 session 可读', async () => {
  const ownerId = await owner()
  const otherOwnerId = await owner()
  const detail = await researchReady(ownerId)
  const input = jobRequest(detail.state.task.id)
  const first = await createOrReuseOwnedResearchJob(ownerId, randomUUID(), input, pool)
  const duplicate = await createOrReuseOwnedResearchJob(ownerId, randomUUID(), input, pool)
  assert.equal(first.created, true)
  assert.equal(duplicate.created, false)
  assert.equal(duplicate.job.jobId, first.job.jobId)
  assert.equal(duplicate.executionRequest, null)
  await assert.rejects(
    () => getOwnedResearchJob(otherOwnerId, first.job.jobId, pool),
    TaskNotFoundError,
  )
})

for (const status of ['running', 'completed', 'failed'] as const) {
  pgTest(`Research Job ${status} 状态下相同 requestId 复用原 Job`, async () => {
    const ownerId = await owner()
    const detail = await researchReady(ownerId)
    const input = jobRequest(detail.state.task.id)
    const first = await createOrReuseOwnedResearchJob(ownerId, randomUUID(), input, pool)
    if (status === 'running') {
      await markResearchJobRunning(first.job.jobId, pool)
    } else {
      await pool.query(`
        UPDATE research_jobs
        SET status = $2, phase = $2, completed_at = now(), updated_at = now()
        WHERE id = $1
      `, [first.job.jobId, status])
    }

    const duplicate = await createOrReuseOwnedResearchJob(ownerId, randomUUID(), input, pool)
    const count = await pool.query<{ count: string }>(`
      SELECT count(*)::text AS count
      FROM research_jobs
      WHERE owner_session_id = $1 AND task_id = $2 AND request_id = $3
    `, [ownerId, input.taskId, input.requestId])

    assert.equal(duplicate.created, false)
    assert.equal(duplicate.executionRequest, null)
    assert.equal(duplicate.job.jobId, first.job.jobId)
    assert.equal(duplicate.job.status, status)
    assert.equal(count.rows[0]?.count, '1')
  })
}

pgTest('Research Job 终态后使用新 requestId 仍创建新 Job', async () => {
  const ownerId = await owner()
  const detail = await researchReady(ownerId)
  const firstInput = jobRequest(detail.state.task.id, 'terminal-request')
  const first = await createOrReuseOwnedResearchJob(ownerId, randomUUID(), firstInput, pool)
  await pool.query(`
    UPDATE research_jobs
    SET status = 'completed', phase = 'completed', completed_at = now(), updated_at = now()
    WHERE id = $1
  `, [first.job.jobId])

  const nextInput = jobRequest(detail.state.task.id, 'new-request')
  const next = await createOrReuseOwnedResearchJob(ownerId, randomUUID(), nextInput, pool)
  const count = await pool.query<{ count: string }>(`
    SELECT count(*)::text AS count
    FROM research_jobs
    WHERE owner_session_id = $1 AND task_id = $2
  `, [ownerId, detail.state.task.id])

  assert.equal(next.created, true)
  assert.notEqual(next.executionRequest, null)
  assert.notEqual(next.job.jobId, first.job.jobId)
  assert.equal(count.rows[0]?.count, '2')
})

pgTest('Research Job 保存真实阶段进度并与任务结果原子完成', async () => {
  const ownerId = await owner()
  const detail = await researchReady(ownerId)
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

pgTest('Agent checkpoint 使用 progress JSONB 持久化、公开脱敏并受 requestId stale 保护', async () => {
  const ownerId = await owner()
  const detail = await researchReady(ownerId)
  const input = jobRequest(detail.state.task.id, 'agent-request-old')
  const createdJob = await createOrReuseOwnedResearchJob(ownerId, randomUUID(), input, pool)
  await markResearchJobRunning(createdJob.job.jobId, pool)
  const identity = {
    jobId: createdJob.job.jobId,
    ownerSessionId: ownerId,
    taskId: input.taskId,
    requestId: input.requestId,
  }
  const checkpoint: ResearchAgentCheckpoint = {
    version: 1,
    currentRound: 2,
    maxRounds: 2,
    replanCount: 1,
    maxReplans: 1,
    phase: 'round_search',
    evaluationStatus: 'insufficient',
    evidenceNeeds: [{
      id: 'need-1', label: '内部缺口', description: '内部描述',
      relatedQuestionIds: ['q-1'], status: 'open', supportingEvidenceIds: [],
    }],
    followUpQueries: [{
      id: 'follow-up-r2-1', query: '内部完整查询', purpose: '内部目的',
      priority: 1, round: 2, evidenceNeedIds: ['need-1'],
    }],
    evidenceCount: 4,
    updatedAt: new Date().toISOString(),
  }
  await updateResearchJobAgentCheckpoint(identity, checkpoint, pool)
  await setResearchJobPhase(identity.jobId, 'searching', { validSourceCount: 7 }, pool)
  await setResearchJobPhase(identity.jobId, 'reading', { readerTargetCount: 2 }, pool)
  await incrementResearchJobReaderProgress(identity.jobId, 'full_text', pool)
  const raw = await pool.query<{ progress: { agentState?: ResearchAgentCheckpoint } }>(
    'SELECT progress FROM research_jobs WHERE id = $1',
    [identity.jobId],
  )
  assert.deepEqual(raw.rows[0]?.progress.agentState, checkpoint)
  const publicJob = await getOwnedResearchJob(ownerId, identity.jobId, pool)
  assert.equal(publicJob.progress.agent?.followUpQueryCount, 1)
  assert.doesNotMatch(JSON.stringify(publicJob.progress), /内部完整查询|内部缺口|内部描述/)

  await createOrReuseOwnedResearchJob(
    ownerId,
    randomUUID(),
    jobRequest(detail.state.task.id, 'agent-request-new'),
    pool,
  )
  await assert.rejects(
    () => assertResearchJobStillCurrent(identity, pool),
    StaleTaskWriteError,
  )
  await assert.rejects(
    () => updateResearchJobAgentCheckpoint(identity, checkpoint, pool),
    StaleTaskWriteError,
  )
})

pgTest('旧 requestId Job 完成不能覆盖更新请求', async () => {
  const ownerId = await owner()
  const detail = await researchReady(ownerId)
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
  const detail = await researchReady(ownerId)
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

pgTest('28. 非所属 session 不能导出报告', async () => {
  const ownerId = await owner()
  const otherOwnerId = await owner()
  const detail = await completedChain(ownerId)
  await assert.rejects(
    () => exportOwnedReport(otherOwnerId, detail.state.task.id, 'pdf', pool),
    TaskNotFoundError,
  )
})

pgTest('29. 报告未生成不能导出', async () => {
  const ownerId = await owner()
  const detail = await created(ownerId)
  await assert.rejects(
    () => exportOwnedReport(ownerId, detail.state.task.id, 'docx', pool),
    ReportNotReadyError,
  )
})

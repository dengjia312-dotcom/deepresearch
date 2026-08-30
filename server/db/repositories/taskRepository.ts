import type { Pool, PoolClient, QueryResultRow } from 'pg'
import type {
  LiveOutlineResult,
  LiveReportResult,
  LiveResearchResult,
  ResearchPlan,
  ResearchPoolItem,
  ResearchTask,
  Source,
} from '../../../src/types'
import {
  InvalidCitationError,
  StaleTaskWriteError,
  TaskNotFoundError,
  TaskOwnershipConflictError,
} from '../errors'
import { getDatabasePool } from '../pool'
import { withTransaction } from '../transactions'
import type {
  CreateTaskInput,
  PersistedResearchStateDto,
  PoolItemMutation,
  ResearchStage,
  StageFailureInput,
  StageRowData,
  StageStartVersions,
  TaskDetailDto,
  TaskSummaryDto,
} from '../types'
import { toAsyncRequestState } from '../types'
import type {
  ResearchJobPhase,
  ResearchJobProgress,
  ResearchJobStatus,
} from '../../types/researchJob'

type Queryable = Pool | PoolClient

interface TaskRow extends QueryResultRow {
  task_id: string
  topic: string
  original_query: string
  topic_id: string
  uses_prototype_data: boolean
  data_source: 'real'
  research_depth: ResearchTask['depth']
  search_depth: ResearchTask['searchDepth']
  source_count: number
  report_depth: ResearchTask['reportDepth']
  report_target_min_words: number
  report_target_max_words: number
  task_status: ResearchTask['status']
  pool_version: number
  outline_version: number
  report_config_version: number
  revision: number
  created_at: Date | string
  updated_at: Date | string
}

interface StageRow extends QueryResultRow {
  task_id: string
  stage: ResearchStage
  mode: StageRowData['mode']
  status: StageRowData['status']
  request_id: string | null
  last_error_message: string | null
  last_error_code: string | null
  last_error_status: number | null
  failed_at: Date | string | null
  started_at: Date | string | null
  completed_at: Date | string | null
  pool_version: number | null
  outline_version: number | null
  report_config_version: number | null
}

interface ResearchJobProjectionRow extends QueryResultRow {
  id: string
  status: ResearchJobStatus
  phase: ResearchJobPhase
  progress: ResearchJobProgress
}

function toIso(value: Date | string | null | undefined) {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function toResearchTask(row: TaskRow): ResearchTask {
  return {
    id: row.task_id,
    title: row.topic,
    query: row.original_query,
    topicId: row.topic_id,
    usesPrototypeData: row.uses_prototype_data,
    dataSource: 'real',
    depth: row.research_depth,
    searchDepth: row.search_depth,
    targetSourceCount: row.source_count,
    reportDepth: row.report_depth,
    reportTargetMinWords: row.report_target_min_words,
    reportTargetMaxWords: row.report_target_max_words,
    status: row.task_status,
    createdAt: toIso(row.created_at)!,
  }
}

function toStageData(row: StageRow | undefined): StageRowData {
  return {
    mode: row?.mode ?? 'idle',
    status: row?.status ?? 'idle',
    requestId: row?.request_id ?? null,
    lastErrorMessage: row?.last_error_message ?? null,
    lastErrorCode: row?.last_error_code ?? null,
    lastErrorStatus: row?.last_error_status ?? null,
    failedAt: toIso(row?.failed_at),
    startedAt: toIso(row?.started_at),
    completedAt: toIso(row?.completed_at),
  }
}

async function selectOwnedTask(
  database: Queryable,
  ownerSessionId: string,
  taskId: string,
  lock = false,
) {
  const result = await database.query<TaskRow>(`
    SELECT * FROM research_tasks
    WHERE task_id = $1 AND owner_session_id = $2
    ${lock ? 'FOR UPDATE' : ''}
  `, [taskId, ownerSessionId])
  if (!result.rows[0]) throw new TaskNotFoundError()
  return result.rows[0]
}

export async function listOwnedTasks(
  ownerSessionId: string,
  pool: Pool = getDatabasePool(),
): Promise<TaskSummaryDto[]> {
  const tasks = await pool.query<TaskRow>(`
    SELECT * FROM research_tasks
    WHERE owner_session_id = $1
    ORDER BY created_at DESC
  `, [ownerSessionId])
  if (tasks.rows.length === 0) return []
  const stages = await pool.query<StageRow>(`
    SELECT s.* FROM research_task_stages s
    JOIN research_tasks t ON t.task_id = s.task_id
    WHERE t.owner_session_id = $1
  `, [ownerSessionId])
  const stagesByTask = new Map<string, Map<ResearchStage, StageRow>>()
  for (const stage of stages.rows) {
    const taskId = stage.task_id
    const byStage = stagesByTask.get(taskId) ?? new Map<ResearchStage, StageRow>()
    byStage.set(stage.stage, stage)
    stagesByTask.set(taskId, byStage)
  }
  return tasks.rows.map((task) => {
    const taskStages = stagesByTask.get(task.task_id)
    return {
      task: toResearchTask(task),
      planStatus: taskStages?.get('plan')?.status ?? 'idle',
      searchStatus: taskStages?.get('research')?.status ?? 'idle',
      outlineStatus: taskStages?.get('outline')?.status ?? 'idle',
      reportStatus: taskStages?.get('report')?.status ?? 'idle',
      updatedAt: toIso(task.updated_at)!,
    }
  })
}

export async function getOwnedTaskDetail(
  ownerSessionId: string,
  taskId: string,
  pool: Pool = getDatabasePool(),
): Promise<TaskDetailDto> {
  return getOwnedTaskDetailFromDatabase(pool, ownerSessionId, taskId)
}

async function getOwnedTaskDetailFromDatabase(
  database: Queryable,
  ownerSessionId: string,
  taskId: string,
): Promise<TaskDetailDto> {
  const task = await selectOwnedTask(database, ownerSessionId, taskId)
  // A PoolClient cannot execute concurrent queries safely; hydration also runs inside transactions.
  const stagesResult = await database.query<StageRow>(
    'SELECT * FROM research_task_stages WHERE task_id = $1', [taskId],
  )
  const planResult = await database.query<{ payload: ResearchPlan }>(
    'SELECT payload FROM research_plans WHERE task_id = $1', [taskId],
  )
  const researchResult = await database.query<{ payload: LiveResearchResult; searched_at: Date | string }>(
    'SELECT payload, searched_at FROM research_results WHERE task_id = $1', [taskId],
  )
  const poolResult = await database.query<{
      source_id: string
      source_snapshot: Source
      review_status: ResearchPoolItem['reviewStatus']
      note: string
      data_source: ResearchPoolItem['dataSource']
      added_at: Date | string
    }>('SELECT * FROM research_pool_items WHERE task_id = $1 ORDER BY added_at', [taskId])
  const outlineResult = await database.query<{ payload: LiveOutlineResult }>(
    'SELECT payload FROM research_outlines WHERE task_id = $1', [taskId],
  )
  const reportResult = await database.query<{ payload: LiveReportResult }>(
    'SELECT payload FROM research_reports WHERE task_id = $1', [taskId],
  )
  const citationsResult = await database.query<{
      section_id: string
      paragraph_id: string
      source_id: string
      citation_order: number
    }>('SELECT * FROM report_citations WHERE task_id = $1 ORDER BY citation_order', [taskId])
  const researchJobResult = await database.query<ResearchJobProjectionRow>(`
    SELECT j.id, j.status, j.phase, j.progress
    FROM research_jobs j
    JOIN research_task_stages s
      ON s.task_id = j.task_id AND s.stage = 'research' AND s.request_id = j.request_id
    WHERE j.task_id = $1 AND j.owner_session_id = $2
    ORDER BY j.created_at DESC
    LIMIT 1
  `, [taskId, ownerSessionId])
  const stageMap = new Map(stagesResult.rows.map((stage) => [stage.stage, toStageData(stage)]))
  const plan = stageMap.get('plan') ?? toStageData(undefined)
  const research = stageMap.get('research') ?? toStageData(undefined)
  const outline = stageMap.get('outline') ?? toStageData(undefined)
  const report = stageMap.get('report') ?? toStageData(undefined)
  const poolItems: ResearchPoolItem[] = poolResult.rows.map((item) => ({
    sourceId: item.source_id,
    reviewStatus: item.review_status,
    note: item.note,
    addedAt: toIso(item.added_at)!,
    sourceSnapshot: item.source_snapshot,
    dataSource: item.data_source,
  }))

  const state: PersistedResearchStateDto = {
    version: 3,
    task: toResearchTask(task),
    researchPlan: planResult.rows[0]?.payload ?? null,
    planMode: plan.mode,
    planStatus: plan.status,
    planError: plan.lastErrorMessage,
    searchMode: research.mode,
    searchStatus: research.status,
    liveResearchResult: researchResult.rows[0]?.payload ?? null,
    searchError: research.lastErrorMessage,
    searchedAt: toIso(researchResult.rows[0]?.searched_at),
    outlineMode: outline.mode,
    outlineStatus: outline.status,
    outlineError: outline.lastErrorMessage,
    liveOutline: outlineResult.rows[0]?.payload ?? null,
    reportMode: report.mode,
    reportStatus: report.status,
    reportError: report.lastErrorMessage,
    liveReport: reportResult.rows[0]?.payload ?? null,
    poolItems,
    outlineGenerated: outline.status === 'success' && (outline.mode === 'mock' || Boolean(outlineResult.rows[0])),
    reportGenerated: report.status === 'success' && (report.mode === 'mock' || Boolean(reportResult.rows[0])),
    requests: {
      plan: toAsyncRequestState(plan),
      research: toAsyncRequestState(research),
      outline: toAsyncRequestState(outline),
      report: toAsyncRequestState(report),
    },
    poolVersion: task.pool_version,
    outlineVersion: task.outline_version,
    reportConfigVersion: task.report_config_version,
    revision: task.revision,
    researchJobId: researchJobResult.rows[0]?.id ?? null,
    researchJobStatus: researchJobResult.rows[0]?.status ?? null,
    researchJobPhase: researchJobResult.rows[0]?.phase ?? null,
    researchJobProgress: researchJobResult.rows[0]?.progress ?? null,
  }
  return {
    state,
    citations: citationsResult.rows.map((citation) => ({
      sectionId: citation.section_id,
      paragraphId: citation.paragraph_id,
      sourceId: citation.source_id,
      citationOrder: citation.citation_order,
    })),
  }
}

export async function createOwnedTask(
  ownerSessionId: string,
  input: CreateTaskInput,
  pool: Pool = getDatabasePool(),
) {
  return withTransaction(async (client) => {
    const task = input.task
    const existing = await client.query<{ owner_session_id: string }>(
      'SELECT owner_session_id FROM research_tasks WHERE task_id = $1',
      [task.id],
    )
    if (existing.rows[0]) {
      if (existing.rows[0].owner_session_id !== ownerSessionId) throw new TaskOwnershipConflictError()
      throw new StaleTaskWriteError()
    }
    await client.query(`
      INSERT INTO research_tasks(
        task_id, owner_session_id, topic, original_query, topic_id,
        uses_prototype_data, data_source, research_depth, search_depth,
        source_count, report_depth, report_target_min_words,
        report_target_max_words, task_status, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, 'real', $7, $8, $9, $10, $11, $12, $13, $14, now()
      )
    `, [
      task.id,
      ownerSessionId,
      task.title,
      task.query,
      task.topicId,
      task.usesPrototypeData,
      task.depth,
      task.searchDepth,
      task.targetSourceCount,
      task.reportDepth,
      task.reportTargetMinWords,
      task.reportTargetMaxWords,
      task.status,
      task.createdAt,
    ])
    await client.query(`
      INSERT INTO research_task_stages(task_id, stage, mode, status)
      SELECT $1, stage, CASE WHEN stage = 'plan' THEN 'real' ELSE 'idle' END, 'idle'
      FROM unnest(ARRAY['plan', 'research', 'outline', 'report']) AS stage
    `, [task.id])
    return getOwnedTaskDetailFromDatabase(client, ownerSessionId, task.id)
  }, pool)
}

export async function startOwnedStageWithClient(
  client: PoolClient,
  ownerSessionId: string,
  taskId: string,
  stage: ResearchStage,
  requestId: string,
  startedAt: string,
  versions: StageStartVersions = {},
) {
  const task = await selectOwnedTask(client, ownerSessionId, taskId, true)
  if (
    (versions.poolVersion !== undefined && task.pool_version !== versions.poolVersion)
    || (versions.outlineVersion !== undefined && task.outline_version !== versions.outlineVersion)
    || (versions.reportConfigVersion !== undefined
      && task.report_config_version !== versions.reportConfigVersion)
  ) throw new StaleTaskWriteError()
  await client.query(`
      UPDATE research_task_stages
      SET mode = 'real', status = 'loading', request_id = $3,
          started_at = $4, completed_at = NULL, failed_at = NULL,
          last_error_message = NULL, last_error_code = NULL, last_error_status = NULL,
          pool_version = $5, outline_version = $6, report_config_version = $7,
          updated_at = now()
      WHERE task_id = $1 AND stage = $2
  `, [
    taskId,
    stage,
    requestId,
    startedAt,
    versions.poolVersion ?? null,
    versions.outlineVersion ?? null,
    versions.reportConfigVersion ?? null,
  ])
}

export async function startOwnedStage(
  ownerSessionId: string,
  taskId: string,
  stage: ResearchStage,
  requestId: string,
  startedAt: string,
  versions: StageStartVersions = {},
  pool: Pool = getDatabasePool(),
) {
  return withTransaction(
    (client) => startOwnedStageWithClient(
      client,
      ownerSessionId,
      taskId,
      stage,
      requestId,
      startedAt,
      versions,
    ),
    pool,
  )
}

async function assertLatestStage(
  client: PoolClient,
  ownerSessionId: string,
  taskId: string,
  stage: ResearchStage,
  requestId: string,
) {
  const task = await selectOwnedTask(client, ownerSessionId, taskId, true)
  const stageResult = await client.query<StageRow>(`
    SELECT * FROM research_task_stages
    WHERE task_id = $1 AND stage = $2
    FOR UPDATE
  `, [taskId, stage])
  const currentStage = stageResult.rows[0]
  if (!currentStage || currentStage.status !== 'loading' || currentStage.request_id !== requestId) {
    throw new StaleTaskWriteError()
  }
  return { task, stage: currentStage }
}

async function markStageSuccess(
  client: PoolClient,
  taskId: string,
  stage: ResearchStage,
  completedAt: string,
) {
  await client.query(`
    UPDATE research_task_stages
    SET status = 'success', completed_at = $3, failed_at = NULL,
        last_error_message = NULL, last_error_code = NULL, last_error_status = NULL,
        updated_at = now()
    WHERE task_id = $1 AND stage = $2
  `, [taskId, stage, completedAt])
}

export async function failOwnedStageWithClient(
  client: PoolClient,
  ownerSessionId: string,
  taskId: string,
  stage: ResearchStage,
  requestId: string,
  failure: StageFailureInput,
) {
  await selectOwnedTask(client, ownerSessionId, taskId, true)
  const result = await client.query(`
      UPDATE research_task_stages
      SET status = 'error', last_error_message = $4, last_error_code = $5,
          last_error_status = $6, failed_at = $7, updated_at = now()
      WHERE task_id = $1 AND stage = $2 AND request_id = $3 AND status = 'loading'
  `, [
    taskId,
    stage,
    requestId,
    failure.errorMessage,
    failure.errorCode,
    failure.errorStatus,
    failure.failedAt,
  ])
  if (result.rowCount !== 1) throw new StaleTaskWriteError()
}

export async function failOwnedStage(
  ownerSessionId: string,
  taskId: string,
  stage: ResearchStage,
  requestId: string,
  failure: StageFailureInput,
  pool: Pool = getDatabasePool(),
) {
  return withTransaction(
    (client) => failOwnedStageWithClient(
      client,
      ownerSessionId,
      taskId,
      stage,
      requestId,
      failure,
    ),
    pool,
  )
}

export async function completeOwnedPlan(
  ownerSessionId: string,
  taskId: string,
  requestId: string,
  plan: ResearchPlan,
  pool: Pool = getDatabasePool(),
) {
  return withTransaction(async (client) => {
    await assertLatestStage(client, ownerSessionId, taskId, 'plan', requestId)
    await client.query(`
      INSERT INTO research_plans(task_id, payload, data_source, confirmed_at, created_at, updated_at)
      VALUES ($1, $2, $3, $4, now(), now())
      ON CONFLICT (task_id) DO UPDATE
      SET payload = EXCLUDED.payload, data_source = EXCLUDED.data_source,
          confirmed_at = EXCLUDED.confirmed_at, updated_at = now()
    `, [taskId, plan, plan.dataSource, plan.confirmedAt])
    await client.query('DELETE FROM research_results WHERE task_id = $1', [taskId])
    await client.query('DELETE FROM research_outlines WHERE task_id = $1', [taskId])
    await client.query('DELETE FROM research_reports WHERE task_id = $1', [taskId])
    await client.query('DELETE FROM research_pool_items WHERE task_id = $1', [taskId])
    await client.query(`
      UPDATE research_task_stages
      SET mode = 'idle', status = 'idle', request_id = NULL, started_at = NULL,
          completed_at = NULL, failed_at = NULL, last_error_message = NULL,
          last_error_code = NULL, last_error_status = NULL,
          pool_version = NULL, outline_version = NULL, report_config_version = NULL,
          updated_at = now()
      WHERE task_id = $1 AND stage IN ('research', 'outline', 'report')
    `, [taskId])
    await client.query(`
      UPDATE research_tasks
      SET task_status = 'draft', pool_version = pool_version + 1,
          outline_version = outline_version + 1, revision = revision + 1,
          updated_at = now()
      WHERE task_id = $1
    `, [taskId])
    await markStageSuccess(client, taskId, 'plan', plan.updatedAt)
    return getOwnedTaskDetailFromDatabase(client, ownerSessionId, taskId)
  }, pool)
}

export async function completeOwnedResearchWithClient(
  client: PoolClient,
  ownerSessionId: string,
  taskId: string,
  requestId: string,
  result: LiveResearchResult,
) {
  await assertLatestStage(client, ownerSessionId, taskId, 'research', requestId)
  await client.query(`
      INSERT INTO research_results(task_id, payload, searched_at, created_at, updated_at)
      VALUES ($1, $2, $3, now(), now())
      ON CONFLICT (task_id) DO UPDATE
      SET payload = EXCLUDED.payload, searched_at = EXCLUDED.searched_at, updated_at = now()
  `, [taskId, result, result.searchedAt])
  await client.query(`
      UPDATE research_tasks SET revision = revision + 1, updated_at = now()
      WHERE task_id = $1
  `, [taskId])
  await markStageSuccess(client, taskId, 'research', result.searchedAt)
}

export async function completeOwnedResearch(
  ownerSessionId: string,
  taskId: string,
  requestId: string,
  result: LiveResearchResult,
  pool: Pool = getDatabasePool(),
) {
  return withTransaction(async (client) => {
    await completeOwnedResearchWithClient(
      client,
      ownerSessionId,
      taskId,
      requestId,
      result,
    )
    return getOwnedTaskDetailFromDatabase(client, ownerSessionId, taskId)
  }, pool)
}

export async function completeOwnedOutline(
  ownerSessionId: string,
  taskId: string,
  requestId: string,
  expectedPoolVersion: number,
  outline: LiveOutlineResult,
  pool: Pool = getDatabasePool(),
) {
  return withTransaction(async (client) => {
    const { task, stage } = await assertLatestStage(client, ownerSessionId, taskId, 'outline', requestId)
    if (
      task.pool_version !== expectedPoolVersion
      || stage.pool_version !== expectedPoolVersion
    ) throw new StaleTaskWriteError()
    const nextOutlineVersion = task.outline_version + 1
    await client.query(`
      INSERT INTO research_outlines(
        task_id, payload, data_source, pool_version, outline_version,
        generated_at, created_at, updated_at
      ) VALUES ($1, $2, 'real', $3, $4, $5, now(), now())
      ON CONFLICT (task_id) DO UPDATE
      SET payload = EXCLUDED.payload, data_source = EXCLUDED.data_source,
          pool_version = EXCLUDED.pool_version, outline_version = EXCLUDED.outline_version,
          generated_at = EXCLUDED.generated_at, updated_at = now()
    `, [taskId, outline, expectedPoolVersion, nextOutlineVersion, outline.generatedAt])
    await client.query('DELETE FROM research_reports WHERE task_id = $1', [taskId])
    await client.query(`
      UPDATE research_task_stages
      SET mode = 'idle', status = 'idle', request_id = NULL, started_at = NULL,
          completed_at = NULL, failed_at = NULL, last_error_message = NULL,
          last_error_code = NULL, last_error_status = NULL, updated_at = now()
      WHERE task_id = $1 AND stage = 'report'
    `, [taskId])
    await client.query(`
      UPDATE research_tasks
      SET task_status = 'outlined', outline_version = $2,
          revision = revision + 1, updated_at = now()
      WHERE task_id = $1
    `, [taskId, nextOutlineVersion])
    await markStageSuccess(client, taskId, 'outline', outline.generatedAt)
    return getOwnedTaskDetailFromDatabase(client, ownerSessionId, taskId)
  }, pool)
}

export async function completeOwnedReport(
  ownerSessionId: string,
  taskId: string,
  requestId: string,
  versions: Required<StageStartVersions>,
  report: LiveReportResult,
  pool: Pool = getDatabasePool(),
) {
  return withTransaction(async (client) => {
    const { task, stage } = await assertLatestStage(client, ownerSessionId, taskId, 'report', requestId)
    if (
      task.pool_version !== versions.poolVersion
      || task.outline_version !== versions.outlineVersion
      || task.report_config_version !== versions.reportConfigVersion
      || stage.pool_version !== versions.poolVersion
      || stage.outline_version !== versions.outlineVersion
      || stage.report_config_version !== versions.reportConfigVersion
    ) throw new StaleTaskWriteError()

    const citations = report.report.sections.flatMap((section) =>
      section.paragraphs.flatMap((paragraph) =>
        paragraph.sourceIds.map((sourceId) => ({
          sectionId: section.id,
          paragraphId: paragraph.id,
          sourceId,
        }))))
    const poolSources = await client.query<{ source_id: string }>(
      'SELECT source_id FROM research_pool_items WHERE task_id = $1',
      [taskId],
    )
    const allowedSources = new Set(poolSources.rows.map((row) => row.source_id))
    if (citations.some((citation) => !allowedSources.has(citation.sourceId))) {
      throw new InvalidCitationError()
    }

    await client.query(`
      INSERT INTO research_reports(
        task_id, payload, data_source, pool_version, outline_version,
        report_config_version, generated_at, created_at, updated_at
      ) VALUES ($1, $2, 'real', $3, $4, $5, $6, now(), now())
      ON CONFLICT (task_id) DO UPDATE
      SET payload = EXCLUDED.payload, data_source = EXCLUDED.data_source,
          pool_version = EXCLUDED.pool_version, outline_version = EXCLUDED.outline_version,
          report_config_version = EXCLUDED.report_config_version,
          generated_at = EXCLUDED.generated_at, updated_at = now()
    `, [
      taskId,
      report,
      versions.poolVersion,
      versions.outlineVersion,
      versions.reportConfigVersion,
      report.generatedAt,
    ])
    await client.query('DELETE FROM report_citations WHERE task_id = $1', [taskId])
    for (const [citationOrder, citation] of citations.entries()) {
      await client.query(`
        INSERT INTO report_citations(
          task_id, section_id, paragraph_id, source_id, citation_order
        ) VALUES ($1, $2, $3, $4, $5)
      `, [taskId, citation.sectionId, citation.paragraphId, citation.sourceId, citationOrder])
    }
    await client.query(`
      UPDATE research_tasks
      SET task_status = 'reported', revision = revision + 1, updated_at = now()
      WHERE task_id = $1
    `, [taskId])
    await markStageSuccess(client, taskId, 'report', report.generatedAt)
    return getOwnedTaskDetailFromDatabase(client, ownerSessionId, taskId)
  }, pool)
}

function payloadReferencesSource(payload: unknown, sourceId: string): boolean {
  if (!payload || typeof payload !== 'object') return false
  if (Array.isArray(payload)) return payload.some((item) => payloadReferencesSource(item, sourceId))
  return Object.entries(payload).some(([key, value]) =>
    key === 'sourceIds' && Array.isArray(value)
      ? value.includes(sourceId)
      : payloadReferencesSource(value, sourceId))
}

async function invalidateSourceDependents(
  client: PoolClient,
  taskId: string,
  sourceId: string,
) {
  const [outline, report] = await Promise.all([
    client.query<{ payload: unknown }>('SELECT payload FROM research_outlines WHERE task_id = $1', [taskId]),
    client.query<{ payload: unknown }>('SELECT payload FROM research_reports WHERE task_id = $1', [taskId]),
  ])
  const invalidatesOutline = payloadReferencesSource(outline.rows[0]?.payload, sourceId)
  const invalidatesReport = payloadReferencesSource(report.rows[0]?.payload, sourceId)
  if (invalidatesOutline) {
    await client.query('DELETE FROM research_outlines WHERE task_id = $1', [taskId])
    await client.query('DELETE FROM research_reports WHERE task_id = $1', [taskId])
    await client.query(`
      UPDATE research_task_stages SET mode = 'idle', status = 'idle', request_id = NULL,
        last_error_message = NULL, last_error_code = NULL, last_error_status = NULL,
        started_at = NULL, completed_at = NULL, failed_at = NULL, updated_at = now()
      WHERE task_id = $1 AND stage IN ('outline', 'report')
    `, [taskId])
  } else if (invalidatesReport) {
    await client.query('DELETE FROM research_reports WHERE task_id = $1', [taskId])
    await client.query(`
      UPDATE research_task_stages SET mode = 'idle', status = 'idle', request_id = NULL,
        last_error_message = NULL, last_error_code = NULL, last_error_status = NULL,
        started_at = NULL, completed_at = NULL, failed_at = NULL, updated_at = now()
      WHERE task_id = $1 AND stage = 'report'
    `, [taskId])
  }
  return { invalidatesOutline, invalidatesReport }
}

export async function addOwnedPoolItem(
  ownerSessionId: string,
  taskId: string,
  source: Source,
  dataSource: ResearchPoolItem['dataSource'],
  pool: Pool = getDatabasePool(),
) {
  return withTransaction(async (client) => {
    await selectOwnedTask(client, ownerSessionId, taskId, true)
    const inserted = await client.query(`
      INSERT INTO research_pool_items(
        task_id, source_id, source_snapshot, credibility, review_status,
        note, data_source, added_at, updated_at
      ) VALUES ($1, $2, $3, $4, 'unreviewed', '', $5, now(), now())
      ON CONFLICT (task_id, source_id) DO NOTHING
    `, [taskId, source.id, source, source.credibility, dataSource])
    if (inserted.rowCount === 1) {
      await client.query(`
        UPDATE research_task_stages
        SET status = 'idle', request_id = NULL, started_at = NULL,
            last_error_message = NULL, last_error_code = NULL, last_error_status = NULL,
            failed_at = NULL, updated_at = now()
        WHERE task_id = $1 AND stage IN ('outline', 'report') AND status = 'loading'
      `, [taskId])
      await client.query(`
        UPDATE research_tasks
        SET task_status = 'collecting', pool_version = pool_version + 1,
            revision = revision + 1, updated_at = now()
        WHERE task_id = $1
      `, [taskId])
    }
    return getOwnedTaskDetailFromDatabase(client, ownerSessionId, taskId)
  }, pool)
}

export async function updateOwnedPoolItem(
  ownerSessionId: string,
  taskId: string,
  sourceId: string,
  mutation: PoolItemMutation,
  pool: Pool = getDatabasePool(),
) {
  return withTransaction(async (client) => {
    await selectOwnedTask(client, ownerSessionId, taskId, true)
    const current = await client.query<{
      review_status: ResearchPoolItem['reviewStatus']
      source_snapshot: Source
    }>(`
      SELECT review_status, source_snapshot FROM research_pool_items
      WHERE task_id = $1 AND source_id = $2 FOR UPDATE
    `, [taskId, sourceId])
    if (!current.rows[0]) throw new TaskNotFoundError()
    const nextReviewStatus = mutation.reviewStatus ?? current.rows[0].review_status
    const nextSnapshot = mutation.credibility
      ? { ...current.rows[0].source_snapshot, credibility: mutation.credibility }
      : current.rows[0].source_snapshot
    const dependencyChange = (mutation.reviewStatus !== undefined
      && mutation.reviewStatus !== current.rows[0].review_status)
      || mutation.credibility !== undefined
    const invalidation = nextReviewStatus === 'irrelevant' && dependencyChange
      ? await invalidateSourceDependents(client, taskId, sourceId)
      : { invalidatesOutline: false, invalidatesReport: false }
    await client.query(`
      UPDATE research_pool_items
      SET review_status = $3, note = COALESCE($4, note),
          credibility = COALESCE($5, credibility), source_snapshot = $6,
          updated_at = now()
      WHERE task_id = $1 AND source_id = $2
    `, [
      taskId,
      sourceId,
      nextReviewStatus,
      mutation.note ?? null,
      mutation.credibility ?? null,
      nextSnapshot,
    ])
    if (dependencyChange) {
      await client.query(`
        UPDATE research_task_stages
        SET status = 'idle', request_id = NULL, started_at = NULL,
            last_error_message = NULL, last_error_code = NULL, last_error_status = NULL,
            failed_at = NULL, updated_at = now()
        WHERE task_id = $1 AND stage IN ('outline', 'report') AND status = 'loading'
      `, [taskId])
    }
    await client.query(`
      UPDATE research_tasks
      SET pool_version = pool_version + $2,
          outline_version = outline_version + $3,
          revision = revision + 1, updated_at = now()
      WHERE task_id = $1
    `, [taskId, dependencyChange ? 1 : 0, invalidation.invalidatesOutline ? 1 : 0])
    return getOwnedTaskDetailFromDatabase(client, ownerSessionId, taskId)
  }, pool)
}

export async function deleteOwnedPoolItem(
  ownerSessionId: string,
  taskId: string,
  sourceId: string,
  pool: Pool = getDatabasePool(),
) {
  return withTransaction(async (client) => {
    await selectOwnedTask(client, ownerSessionId, taskId, true)
    const invalidation = await invalidateSourceDependents(client, taskId, sourceId)
    const deleted = await client.query(
      'DELETE FROM research_pool_items WHERE task_id = $1 AND source_id = $2',
      [taskId, sourceId],
    )
    if (deleted.rowCount !== 1) throw new TaskNotFoundError()
    await client.query(`
      UPDATE research_task_stages
      SET status = 'idle', request_id = NULL, started_at = NULL,
          last_error_message = NULL, last_error_code = NULL, last_error_status = NULL,
          failed_at = NULL, updated_at = now()
      WHERE task_id = $1 AND stage IN ('outline', 'report') AND status = 'loading'
    `, [taskId])
    await client.query(`
      UPDATE research_tasks
      SET pool_version = pool_version + 1,
          outline_version = outline_version + $2,
          revision = revision + 1, updated_at = now()
      WHERE task_id = $1
    `, [taskId, invalidation.invalidatesOutline ? 1 : 0])
    return getOwnedTaskDetailFromDatabase(client, ownerSessionId, taskId)
  }, pool)
}

async function resetDownstreamFromPlan(client: PoolClient, taskId: string) {
  await client.query('DELETE FROM research_results WHERE task_id = $1', [taskId])
  await client.query('DELETE FROM research_outlines WHERE task_id = $1', [taskId])
  await client.query('DELETE FROM research_reports WHERE task_id = $1', [taskId])
  await client.query('DELETE FROM research_pool_items WHERE task_id = $1', [taskId])
  await client.query(`
    UPDATE research_task_stages
    SET mode = 'idle', status = 'idle', request_id = NULL, started_at = NULL,
        completed_at = NULL, failed_at = NULL, last_error_message = NULL,
        last_error_code = NULL, last_error_status = NULL,
        pool_version = NULL, outline_version = NULL, report_config_version = NULL,
        updated_at = now()
    WHERE task_id = $1 AND stage IN ('research', 'outline', 'report')
  `, [taskId])
}

export async function saveOwnedPlan(
  ownerSessionId: string,
  taskId: string,
  plan: ResearchPlan,
  invalidateDownstream: boolean,
  searchConfig?: Pick<ResearchTask, 'searchDepth' | 'targetSourceCount'>,
  pool: Pool = getDatabasePool(),
) {
  return withTransaction(async (client) => {
    await selectOwnedTask(client, ownerSessionId, taskId, true)
    await client.query(`
      INSERT INTO research_plans(task_id, payload, data_source, confirmed_at, created_at, updated_at)
      VALUES ($1, $2, $3, $4, now(), now())
      ON CONFLICT (task_id) DO UPDATE
      SET payload = EXCLUDED.payload, data_source = EXCLUDED.data_source,
          confirmed_at = EXCLUDED.confirmed_at, updated_at = now()
    `, [taskId, plan, plan.dataSource, plan.confirmedAt])
    if (invalidateDownstream) await resetDownstreamFromPlan(client, taskId)
    await client.query(`
      UPDATE research_task_stages
      SET mode = $2, status = 'success', request_id = NULL,
          last_error_message = NULL, last_error_code = NULL, last_error_status = NULL,
          failed_at = NULL, completed_at = COALESCE(completed_at, now()), updated_at = now()
      WHERE task_id = $1 AND stage = 'plan'
    `, [taskId, plan.dataSource])
    await client.query(`
      UPDATE research_tasks
      SET task_status = $2, search_depth = COALESCE($4, search_depth),
          source_count = COALESCE($5, source_count),
          pool_version = pool_version + $3,
          outline_version = outline_version + $3,
          revision = revision + 1, updated_at = now()
      WHERE task_id = $1
    `, [
      taskId, plan.confirmedAt ? 'searching' : 'draft', invalidateDownstream ? 1 : 0,
      searchConfig?.searchDepth ?? null, searchConfig?.targetSourceCount ?? null,
    ])
    return getOwnedTaskDetailFromDatabase(client, ownerSessionId, taskId)
  }, pool)
}

export async function updateOwnedReportConfig(
  ownerSessionId: string,
  taskId: string,
  reportDepth: ResearchTask['reportDepth'],
  targetMinWords: number,
  targetMaxWords: number,
  pool: Pool = getDatabasePool(),
) {
  return withTransaction(async (client) => {
    await selectOwnedTask(client, ownerSessionId, taskId, true)
    await client.query('DELETE FROM research_reports WHERE task_id = $1', [taskId])
    await client.query(`
      UPDATE research_task_stages
      SET mode = 'idle', status = 'idle', request_id = NULL, started_at = NULL,
          completed_at = NULL, failed_at = NULL, last_error_message = NULL,
          last_error_code = NULL, last_error_status = NULL, updated_at = now()
      WHERE task_id = $1 AND stage = 'report'
    `, [taskId])
    await client.query(`
      UPDATE research_tasks
      SET report_depth = $2, report_target_min_words = $3,
          report_target_max_words = $4,
          report_config_version = report_config_version + 1,
          revision = revision + 1, updated_at = now()
      WHERE task_id = $1
    `, [taskId, reportDepth, targetMinWords, targetMaxWords])
    return getOwnedTaskDetailFromDatabase(client, ownerSessionId, taskId)
  }, pool)
}

export async function useOwnedMockStage(
  ownerSessionId: string,
  taskId: string,
  stage: ResearchStage,
  plan: ResearchPlan | null,
  pool: Pool = getDatabasePool(),
) {
  return withTransaction(async (client) => {
    await selectOwnedTask(client, ownerSessionId, taskId, true)
    if (stage === 'plan') {
      if (!plan) throw new Error('Mock plan payload is required.')
      await client.query(`
        INSERT INTO research_plans(task_id, payload, data_source, confirmed_at, created_at, updated_at)
        VALUES ($1, $2, 'mock', $3, now(), now())
        ON CONFLICT (task_id) DO UPDATE SET payload = EXCLUDED.payload,
          data_source = 'mock', confirmed_at = EXCLUDED.confirmed_at, updated_at = now()
      `, [taskId, plan, plan.confirmedAt])
    }
    if (stage === 'outline') {
      await client.query('DELETE FROM research_outlines WHERE task_id = $1', [taskId])
      await client.query('DELETE FROM research_reports WHERE task_id = $1', [taskId])
      await client.query(`
        UPDATE research_task_stages SET mode = 'idle', status = 'idle', request_id = NULL,
          last_error_message = NULL, last_error_code = NULL, last_error_status = NULL,
          failed_at = NULL, started_at = NULL, completed_at = NULL, updated_at = now()
        WHERE task_id = $1 AND stage = 'report'
      `, [taskId])
    }
    if (stage === 'report') {
      await client.query('DELETE FROM research_reports WHERE task_id = $1', [taskId])
    }
    await client.query(`
      UPDATE research_task_stages
      SET mode = 'mock', status = 'success', request_id = NULL,
          last_error_message = NULL, last_error_code = NULL, last_error_status = NULL,
          failed_at = NULL, started_at = NULL, completed_at = now(), updated_at = now()
      WHERE task_id = $1 AND stage = $2
    `, [taskId, stage])
    const taskStatus = stage === 'outline' ? 'outlined' : stage === 'report' ? 'reported' : null
    await client.query(`
      UPDATE research_tasks
      SET task_status = COALESCE($2, task_status),
          outline_version = outline_version + $3,
          revision = revision + 1, updated_at = now()
      WHERE task_id = $1
    `, [taskId, taskStatus, stage === 'outline' ? 1 : 0])
    return getOwnedTaskDetailFromDatabase(client, ownerSessionId, taskId)
  }, pool)
}

function citationRows(report: LiveReportResult | null) {
  return report?.report.sections.flatMap((section) =>
    section.paragraphs.flatMap((paragraph) =>
      paragraph.sourceIds.map((sourceId) => ({
        sectionId: section.id,
        paragraphId: paragraph.id,
        sourceId,
      })))) ?? []
}

export async function importOwnedTaskState(
  ownerSessionId: string,
  state: PersistedResearchStateDto,
  pool: Pool = getDatabasePool(),
) {
  return withTransaction(async (client) => {
    const existing = await client.query<{ owner_session_id: string }>(
      'SELECT owner_session_id FROM research_tasks WHERE task_id = $1 FOR UPDATE',
      [state.task.id],
    )
    if (existing.rows[0]) {
      if (existing.rows[0].owner_session_id !== ownerSessionId) {
        throw new TaskOwnershipConflictError()
      }
      return { imported: false, detail: await getOwnedTaskDetailFromDatabase(client, ownerSessionId, state.task.id) }
    }
    const task = state.task
    await client.query(`
      INSERT INTO research_tasks(
        task_id, owner_session_id, topic, original_query, topic_id, uses_prototype_data,
        data_source, research_depth, search_depth, source_count, report_depth,
        report_target_min_words, report_target_max_words, task_status,
        pool_version, outline_version, report_config_version, revision, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,now())
    `, [
      task.id, ownerSessionId, task.title, task.query, task.topicId, task.usesPrototypeData,
      task.dataSource, task.depth, task.searchDepth, task.targetSourceCount, task.reportDepth,
      task.reportTargetMinWords, task.reportTargetMaxWords, task.status,
      state.poolVersion, state.outlineVersion, state.reportConfigVersion, state.revision ?? 0,
      task.createdAt,
    ])
    const stages: Array<[ResearchStage, StageRowData]> = [
      ['plan', { ...state.requests.plan, mode: state.planMode, lastErrorMessage: state.planError, completedAt: null }],
      ['research', { ...state.requests.research, mode: state.searchMode, lastErrorMessage: state.searchError, completedAt: null }],
      ['outline', { ...state.requests.outline, mode: state.outlineMode, lastErrorMessage: state.outlineError, completedAt: null }],
      ['report', { ...state.requests.report, mode: state.reportMode, lastErrorMessage: state.reportError, completedAt: null }],
    ]
    for (const [stage, value] of stages) {
      await client.query(`
        INSERT INTO research_task_stages(
          task_id, stage, mode, status, request_id, last_error_message,
          last_error_code, last_error_status, failed_at, started_at, completed_at,
          pool_version, outline_version, report_config_version, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now())
      `, [
        task.id, stage, value.mode, value.status, value.requestId, value.lastErrorMessage,
        value.lastErrorCode, value.lastErrorStatus, value.failedAt, value.startedAt, value.completedAt,
        stage === 'outline' || stage === 'report' ? state.poolVersion : null,
        stage === 'report' ? state.outlineVersion : null,
        stage === 'report' ? state.reportConfigVersion : null,
      ])
    }
    if (state.researchPlan) {
      await client.query(`INSERT INTO research_plans(task_id,payload,data_source,confirmed_at) VALUES ($1,$2,$3,$4)`,
        [task.id, state.researchPlan, state.researchPlan.dataSource, state.researchPlan.confirmedAt])
    }
    if (state.liveResearchResult) {
      await client.query(`INSERT INTO research_results(task_id,payload,searched_at) VALUES ($1,$2,$3)`,
        [task.id, state.liveResearchResult, state.liveResearchResult.searchedAt])
    }
    for (const item of state.poolItems) {
      if (!item.sourceSnapshot) continue
      await client.query(`
        INSERT INTO research_pool_items(
          task_id,source_id,source_snapshot,credibility,review_status,note,data_source,added_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      `, [task.id, item.sourceId, item.sourceSnapshot, item.sourceSnapshot.credibility,
        item.reviewStatus, item.note, item.dataSource, item.addedAt])
    }
    if (state.liveOutline) {
      await client.query(`
        INSERT INTO research_outlines(task_id,payload,data_source,pool_version,outline_version,generated_at)
        VALUES ($1,$2,'real',$3,$4,$5)
      `, [task.id, state.liveOutline, state.poolVersion, state.outlineVersion, state.liveOutline.generatedAt])
    }
    if (state.liveReport) {
      const citations = citationRows(state.liveReport)
      const allowedSources = new Set(state.poolItems.map((item) => item.sourceId))
      if (citations.some((citation) => !allowedSources.has(citation.sourceId))) {
        throw new InvalidCitationError()
      }
      await client.query(`
        INSERT INTO research_reports(
          task_id,payload,data_source,pool_version,outline_version,report_config_version,generated_at
        ) VALUES ($1,$2,'real',$3,$4,$5,$6)
      `, [task.id, state.liveReport, state.poolVersion, state.outlineVersion,
        state.reportConfigVersion, state.liveReport.generatedAt])
      for (const [order, citation] of citations.entries()) {
        await client.query(`
          INSERT INTO report_citations(task_id,section_id,paragraph_id,source_id,citation_order)
          VALUES ($1,$2,$3,$4,$5)
        `, [task.id, citation.sectionId, citation.paragraphId, citation.sourceId, order])
      }
    }
    return { imported: true, detail: await getOwnedTaskDetailFromDatabase(client, ownerSessionId, task.id) }
  }, pool)
}

export async function recoverInterruptedStages(pool: Pool = getDatabasePool()) {
  await pool.query(`
    UPDATE research_task_stages
    SET status = 'error', last_error_message = '请求因服务重启而中断，请重试当前步骤。',
        last_error_code = 'REQUEST_INTERRUPTED', last_error_status = NULL,
        failed_at = now(), updated_at = now()
    WHERE status = 'loading'
  `)
}

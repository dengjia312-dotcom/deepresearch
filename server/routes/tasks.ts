import { Router, type Request, type Response } from 'express'
import type { PersistedResearchStateDto } from '../db/types'
import {
  addOwnedPoolItem,
  createOwnedTask,
  deleteOwnedPoolItem,
  getOwnedTaskDetail,
  importOwnedTaskState,
  listOwnedTasks,
  saveOwnedPlan,
  updateOwnedPoolItem,
  updateOwnedReportConfig,
  useOwnedMockStage,
} from '../db/repositories/taskRepository'
import { getOwnerSessionId } from '../middleware/sessionOwner'
import type { ResearchPlan, ResearchTask, Source } from '../../src/types'
import type { ResearchErrorResponse } from '../types/research'
import { isLikelyDatabaseError, sendPersistenceError } from './persistenceErrors'
import {
  exportOwnedReport,
  reportContentDisposition,
  type ReportExportFormat,
} from '../reporting/reportExportService'
import {
  ReportDocumentInvalidError,
  ReportNotReadyError,
} from '../reporting/reportDocument'

export const tasksRouter = Router()

function sendTaskError(error: unknown, response: Response) {
  if (sendPersistenceError(error, response as Response<ResearchErrorResponse>)) return
  if (isLikelyDatabaseError(error)) {
    response.status(503).json({
      error: { code: 'DATABASE_UNAVAILABLE', message: '任务数据暂时无法保存，请稍后重试。' },
    })
    return
  }
  console.error('[tasks] Unexpected persistence error', {
    name: error instanceof Error ? error.name : 'UnknownError',
  })
  response.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: '任务存储服务暂时不可用。' },
  })
}

function isTaskId(value: unknown): value is string {
  return typeof value === 'string'
    && /^task-[0-9a-z-]{8,150}$/i.test(value)
}

function isResearchTask(value: unknown): value is ResearchTask {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const task = value as Partial<ResearchTask>
  return isTaskId(task.id)
    && typeof task.title === 'string' && task.title.trim().length > 0 && task.title.length <= 200
    && typeof task.query === 'string' && task.query.length <= 200
    && typeof task.topicId === 'string' && task.topicId.length <= 160
    && typeof task.usesPrototypeData === 'boolean'
    && task.dataSource === 'real'
    && ['quick', 'deep', 'professional'].includes(task.depth ?? '')
    && ['concise', 'standard', 'deep', 'custom'].includes(task.searchDepth ?? '')
    && Number.isInteger(task.targetSourceCount)
    && (task.targetSourceCount ?? 0) >= 8 && (task.targetSourceCount ?? 0) <= 30
    && ['brief', 'standard', 'deep'].includes(task.reportDepth ?? '')
    && Number.isInteger(task.reportTargetMinWords) && (task.reportTargetMinWords ?? 0) > 0
    && Number.isInteger(task.reportTargetMaxWords)
    && (task.reportTargetMaxWords ?? 0) >= (task.reportTargetMinWords ?? 0)
    && ['draft', 'searching', 'collecting', 'outlined', 'reported'].includes(task.status ?? '')
    && typeof task.createdAt === 'string' && !Number.isNaN(Date.parse(task.createdAt))
}

function isPlan(value: unknown): value is ResearchPlan {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const plan = value as Partial<ResearchPlan>
  return typeof plan.objective === 'string'
    && typeof plan.scope === 'string'
    && Array.isArray(plan.questions)
    && Array.isArray(plan.sourcePreferences)
    && typeof plan.updatedAt === 'string'
    && (plan.dataSource === 'real' || plan.dataSource === 'mock')
}

function isSource(value: unknown): value is Source {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const source = value as Partial<Source>
  return typeof source.id === 'string' && source.id.length > 0 && source.id.length <= 200
    && typeof source.title === 'string' && source.title.length > 0
    && typeof source.url === 'string' && /^https?:\/\//i.test(source.url)
    && typeof source.publisher === 'string'
    && ['high', 'medium', 'low', 'unverified'].includes(source.credibility ?? '')
}

async function sendReportExport(
  format: ReportExportFormat,
  request: Request,
  response: Response,
) {
  if (!isTaskId(request.params.taskId)) {
    response.status(404).json({ error: { code: 'TASK_NOT_FOUND', message: '研究任务不存在。' } })
    return
  }
  try {
    const result = await exportOwnedReport(
      getOwnerSessionId(response),
      request.params.taskId,
      format,
    )
    response.setHeader('Content-Type', result.contentType)
    response.setHeader('Content-Disposition', reportContentDisposition(result.filename))
    response.setHeader('Content-Length', String(result.buffer.length))
    response.send(result.buffer)
  } catch (error) {
    if (error instanceof ReportNotReadyError) {
      response.status(409).json({
        error: { code: 'REPORT_NOT_READY', message: '研究报告尚未生成，暂时无法导出。' },
      })
      return
    }
    if (error instanceof ReportDocumentInvalidError) {
      response.status(422).json({
        error: { code: 'REPORT_DATA_INVALID', message: error.message },
      })
      return
    }
    if (sendPersistenceError(error, response as Response<ResearchErrorResponse>)) return
    if (isLikelyDatabaseError(error)) {
      sendTaskError(error, response)
      return
    }
    console.error('[report-export] Generation failed', {
      format,
      name: error instanceof Error ? error.name : 'UnknownError',
    })
    response.status(500).json({
      error: { code: 'REPORT_EXPORT_FAILED', message: '报告导出失败，请稍后重试。' },
    })
  }
}

tasksRouter.get('/', async (_request, response) => {
  try {
    response.json({ tasks: await listOwnedTasks(getOwnerSessionId(response)) })
  } catch (error) {
    sendTaskError(error, response)
  }
})

tasksRouter.post('/', async (request, response) => {
  const task = (request.body as { task?: unknown } | null)?.task
  if (!isResearchTask(task)) {
    response.status(400).json({ error: { code: 'INVALID_REQUEST', message: '任务数据格式无效。' } })
    return
  }
  try {
    response.status(201).json(await createOwnedTask(getOwnerSessionId(response), { task }))
  } catch (error) {
    sendTaskError(error, response)
  }
})

tasksRouter.post('/import-v4', async (request, response) => {
  const value = request.body as { version?: unknown; taskOrder?: unknown; tasksById?: unknown } | null
  if (
    value?.version !== 4
    || !Array.isArray(value.taskOrder)
    || !value.tasksById || typeof value.tasksById !== 'object' || Array.isArray(value.tasksById)
    || value.taskOrder.length > 200
  ) {
    response.status(400).json({ error: { code: 'INVALID_REQUEST', message: '旧版任务数据格式无效。' } })
    return
  }
  const states = value.taskOrder.map((taskId) =>
    typeof taskId === 'string'
      ? (value.tasksById as Record<string, PersistedResearchStateDto>)[taskId]
      : undefined)
  if (states.some((state) => !state || state.version !== 3 || !isResearchTask(state.task))) {
    response.status(400).json({ error: { code: 'INVALID_REQUEST', message: '旧版任务包含无效数据。' } })
    return
  }
  try {
    const ownerSessionId = getOwnerSessionId(response)
    const results = []
    for (const state of states as PersistedResearchStateDto[]) {
      results.push(await importOwnedTaskState(ownerSessionId, state))
    }
    response.json({ imported: results.filter((item) => item.imported).length, total: results.length })
  } catch (error) {
    sendTaskError(error, response)
  }
})

tasksRouter.get('/:taskId/report.pdf', async (request, response) => {
  await sendReportExport('pdf', request, response)
})

tasksRouter.get('/:taskId/report.docx', async (request, response) => {
  await sendReportExport('docx', request, response)
})

tasksRouter.get('/:taskId', async (request, response) => {
  if (!isTaskId(request.params.taskId)) {
    response.status(404).json({ error: { code: 'TASK_NOT_FOUND', message: '研究任务不存在。' } })
    return
  }
  try {
    response.json(await getOwnedTaskDetail(getOwnerSessionId(response), request.params.taskId))
  } catch (error) {
    sendTaskError(error, response)
  }
})

tasksRouter.put('/:taskId/plan', async (request, response) => {
  const body = request.body as {
    plan?: unknown
    invalidateDownstream?: unknown
    searchDepth?: unknown
    targetSourceCount?: unknown
  } | null
  if (
    !isTaskId(request.params.taskId) || !isPlan(body?.plan)
    || typeof body?.invalidateDownstream !== 'boolean'
    || typeof body.searchDepth !== 'string'
    || !['concise', 'standard', 'deep', 'custom'].includes(body.searchDepth)
    || !Number.isInteger(body.targetSourceCount)
    || (body.targetSourceCount as number) < 8 || (body.targetSourceCount as number) > 30
  ) {
    response.status(400).json({ error: { code: 'INVALID_REQUEST', message: '研究计划数据格式无效。' } })
    return
  }
  try {
    response.json(await saveOwnedPlan(
      getOwnerSessionId(response), request.params.taskId, body.plan, body.invalidateDownstream,
      {
        searchDepth: body.searchDepth as ResearchTask['searchDepth'],
        targetSourceCount: body.targetSourceCount as number,
      },
    ))
  } catch (error) {
    sendTaskError(error, response)
  }
})

tasksRouter.put('/:taskId/report-config', async (request, response) => {
  const body = request.body as Record<string, unknown> | null
  const depth = body?.reportDepth
  const min = body?.targetMinWords
  const max = body?.targetMaxWords
  if (
    !isTaskId(request.params.taskId)
    || typeof depth !== 'string' || !['brief', 'standard', 'deep'].includes(depth)
    || !Number.isInteger(min) || !Number.isInteger(max)
    || (min as number) <= 0 || (max as number) < (min as number)
  ) {
    response.status(400).json({ error: { code: 'INVALID_REQUEST', message: '报告配置无效。' } })
    return
  }
  try {
    response.json(await updateOwnedReportConfig(
      getOwnerSessionId(response), request.params.taskId,
      depth as ResearchTask['reportDepth'], min as number, max as number,
    ))
  } catch (error) {
    sendTaskError(error, response)
  }
})

tasksRouter.post('/:taskId/mock/:stage', async (request, response) => {
  const stage = request.params.stage
  const plan = (request.body as { plan?: unknown } | null)?.plan ?? null
  if (
    !isTaskId(request.params.taskId)
    || !['plan', 'research', 'outline', 'report'].includes(stage)
    || (stage === 'plan' && !isPlan(plan))
  ) {
    response.status(400).json({ error: { code: 'INVALID_REQUEST', message: '演示阶段数据无效。' } })
    return
  }
  try {
    response.json(await useOwnedMockStage(
      getOwnerSessionId(response), request.params.taskId,
      stage as 'plan' | 'research' | 'outline' | 'report',
      stage === 'plan' ? plan as ResearchPlan : null,
    ))
  } catch (error) {
    sendTaskError(error, response)
  }
})

tasksRouter.post('/:taskId/pool', async (request, response) => {
  const body = request.body as { source?: unknown; dataSource?: unknown } | null
  if (
    !isTaskId(request.params.taskId) || !isSource(body?.source)
    || (body?.dataSource !== 'real' && body?.dataSource !== 'mock')
  ) {
    response.status(400).json({ error: { code: 'INVALID_REQUEST', message: '来源数据无效。' } })
    return
  }
  try {
    response.status(201).json(await addOwnedPoolItem(
      getOwnerSessionId(response), request.params.taskId, body.source, body.dataSource,
    ))
  } catch (error) {
    sendTaskError(error, response)
  }
})

tasksRouter.patch('/:taskId/pool/:sourceId', async (request, response) => {
  const body = request.body as Record<string, unknown> | null
  if (!isTaskId(request.params.taskId) || !request.params.sourceId || !body) {
    response.status(400).json({ error: { code: 'INVALID_REQUEST', message: '资料池修改无效。' } })
    return
  }
  const reviewStatus = body.reviewStatus
  const credibility = body.credibility
  const note = body.note
  if (
    reviewStatus !== undefined && !['unreviewed', 'trusted', 'questionable', 'irrelevant'].includes(String(reviewStatus))
    || credibility !== undefined && !['high', 'medium', 'low', 'unverified'].includes(String(credibility))
    || note !== undefined && (typeof note !== 'string' || note.length > 10_000)
  ) {
    response.status(400).json({ error: { code: 'INVALID_REQUEST', message: '资料池修改无效。' } })
    return
  }
  try {
    response.json(await updateOwnedPoolItem(
      getOwnerSessionId(response), request.params.taskId, request.params.sourceId,
      {
        reviewStatus: reviewStatus as never,
        credibility: credibility as string | undefined,
        note: note as string | undefined,
      },
    ))
  } catch (error) {
    sendTaskError(error, response)
  }
})

tasksRouter.delete('/:taskId/pool/:sourceId', async (request, response) => {
  if (!isTaskId(request.params.taskId) || !request.params.sourceId) {
    response.status(400).json({ error: { code: 'INVALID_REQUEST', message: '资料池删除请求无效。' } })
    return
  }
  try {
    response.json(await deleteOwnedPoolItem(
      getOwnerSessionId(response), request.params.taskId, request.params.sourceId,
    ))
  } catch (error) {
    sendTaskError(error, response)
  }
})

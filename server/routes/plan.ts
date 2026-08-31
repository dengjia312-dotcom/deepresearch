import { Router, type Request, type Response } from 'express'
import { generatePlan } from '../services/planGenerationService'
import { ResearchServiceError } from '../services/serviceError'
import {
  completeOwnedPlan,
  failOwnedStage,
  getOwnedTaskDetail,
  startOwnedStage,
} from '../db/repositories/taskRepository'
import { getOwnerSessionId } from '../middleware/sessionOwner'
import { toPersistedPlan } from '../services/persistenceTransform'
import { isLikelyDatabaseError, sendPersistenceError } from './persistenceErrors'
import type {
  PlanRequest,
  PlanResponse,
  ResearchDepth,
  ResearchErrorResponse,
} from '../types/research'

export const planRouter = Router()
const researchDepths = new Set<ResearchDepth>(['quick', 'deep', 'professional'])

function parseRequest(body: unknown): PlanRequest | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const value = body as Record<string, unknown>
  const taskId = typeof value.taskId === 'string' ? value.taskId.trim() : ''
  const requestId = typeof value.requestId === 'string' ? value.requestId.trim() : ''
  const topic = typeof value.topic === 'string' ? value.topic.trim() : ''
  const depth = typeof value.depth === 'string'
    ? value.depth as ResearchDepth
    : 'deep'
  if (
    !taskId || taskId.length > 160
    || !requestId || requestId.length > 160
    || !topic || topic.length > 200
    || !researchDepths.has(depth)
  ) return null
  return { taskId, requestId, topic, depth }
}

planRouter.post(
  '/',
  async (
    request: Request<unknown, PlanResponse | ResearchErrorResponse, unknown>,
    response: Response<PlanResponse | ResearchErrorResponse>,
  ) => {
    const input = parseRequest(request.body)
    if (!input) {
      response.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: '研究主题不能为空，且研究深度必须有效。',
        },
      })
      return
    }

    const ownerSessionId = getOwnerSessionId(response)
    let stageStarted = false
    try {
      const currentTask = await getOwnedTaskDetail(ownerSessionId, input.taskId)
      await startOwnedStage(
        ownerSessionId,
        input.taskId,
        'plan',
        input.requestId,
        new Date().toISOString(),
      )
      stageStarted = true
      const generated = await generatePlan(input)
      const plan = toPersistedPlan(
        generated,
        currentTask.state.task.usesPrototypeData,
      )
      await completeOwnedPlan(ownerSessionId, input.taskId, input.requestId, plan)
      response.json(generated)
    } catch (error) {
      if (stageStarted) {
        try {
          await failOwnedStage(ownerSessionId, input.taskId, 'plan', input.requestId, {
            errorCode: error instanceof ResearchServiceError ? error.code : 'INTERNAL_ERROR',
            errorStatus: error instanceof ResearchServiceError ? error.statusCode : 500,
            errorMessage: error instanceof ResearchServiceError
              ? error.publicMessage
              : '研究计划生成或保存失败。',
            failedAt: new Date().toISOString(),
          })
        } catch {
          // A newer request or a database outage must not be hidden by this cleanup attempt.
        }
      }
      if (error instanceof ResearchServiceError) {
        console.error('[plan] generation request failed', {
          provider: 'qwen',
          code: error.code,
          diagnosticCode: error.diagnosticCode,
          statusCode: error.statusCode,
        })
        if (error.retryAfterSeconds) {
          response.setHeader('Retry-After', String(error.retryAfterSeconds))
        }
        response.status(error.statusCode).json({
          error: { code: error.code, message: error.publicMessage },
        })
        return
      }
      if (sendPersistenceError(error, response as Response<ResearchErrorResponse>)) return
      if (isLikelyDatabaseError(error)) {
        response.status(503).json({
          error: { code: 'DATABASE_UNAVAILABLE', message: '研究任务保存失败，请稍后重试。' },
        })
        return
      }
      console.error('[plan] Unexpected server error')
      response.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: '研究计划生成服务暂时不可用。' },
      })
    }
  },
)

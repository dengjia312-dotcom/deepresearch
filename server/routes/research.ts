import { Router, type Request, type Response } from 'express'
import {
  MimoServiceError,
} from '../services/mimoResearchService'
import { researchWithProviders } from '../services/researchService'
import {
  completeOwnedResearch,
  failOwnedStage,
  startOwnedStage,
} from '../db/repositories/taskRepository'
import { getOwnerSessionId } from '../middleware/sessionOwner'
import { toPersistedResearchResult } from '../services/persistenceTransform'
import { isLikelyDatabaseError, sendPersistenceError } from './persistenceErrors'
import type {
  ResearchErrorResponse,
  ResearchRequest,
  ResearchResponse,
} from '../types/research'

export const researchRouter = Router()

function sendError(
  response: Response<ResearchErrorResponse>,
  statusCode: number,
  code: ResearchErrorResponse['error']['code'],
  message: string,
) {
  response.status(statusCode).json({ error: { code, message } })
}

export function parseResearchRequest(body: unknown): ResearchRequest | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const candidate = body as Record<string, unknown>
  const taskId = typeof candidate.taskId === 'string' ? candidate.taskId.trim() : ''
  const requestId = typeof candidate.requestId === 'string' ? candidate.requestId.trim() : ''
  const topic = typeof candidate.topic === 'string' ? candidate.topic.trim() : ''
  const goal = typeof candidate.goal === 'string' ? candidate.goal.trim() : '行业研究'
  const rawPreferences = Array.isArray(candidate.sourcePreferences)
    ? candidate.sourcePreferences
    : []
  const sourcePreferences = rawPreferences
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 10)
  const targetSourceCount = typeof candidate.targetSourceCount === 'number'
    && Number.isInteger(candidate.targetSourceCount)
    ? candidate.targetSourceCount
    : Number.NaN

  if (
    !taskId
    || taskId.length > 160
    || !requestId
    || requestId.length > 160
    || !topic
    || topic.length > 200
    || goal.length > 200
    || targetSourceCount < 8
    || targetSourceCount > 30
  ) return null
  return {
    taskId,
    requestId,
    topic,
    goal: goal || '行业研究',
    sourcePreferences,
    targetSourceCount,
  }
}

researchRouter.post(
  '/',
  // Legacy synchronous endpoint. The production frontend creates asynchronous jobs instead.
  async (
    request: Request<unknown, ResearchResponse | ResearchErrorResponse, unknown>,
    response: Response<ResearchResponse | ResearchErrorResponse>,
  ) => {
    const researchRequest = parseResearchRequest(request.body)
    if (!researchRequest) {
      sendError(
        response as Response<ResearchErrorResponse>,
        400,
        'INVALID_REQUEST',
        '研究主题不能为空，且请求字段必须符合要求。',
      )
      return
    }

    const ownerSessionId = getOwnerSessionId(response)
    let stageStarted = false
    try {
      await startOwnedStage(
        ownerSessionId,
        researchRequest.taskId,
        'research',
        researchRequest.requestId,
        new Date().toISOString(),
      )
      stageStarted = true
      const generated = await researchWithProviders(researchRequest)
      const persisted = toPersistedResearchResult(generated, researchRequest.topic)
      await completeOwnedResearch(
        ownerSessionId,
        researchRequest.taskId,
        researchRequest.requestId,
        persisted,
      )
      response.json(generated)
    } catch (error) {
      if (stageStarted) {
        try {
          await failOwnedStage(
            ownerSessionId,
            researchRequest.taskId,
            'research',
            researchRequest.requestId,
            {
              errorCode: error instanceof MimoServiceError ? error.code : 'INTERNAL_ERROR',
              errorStatus: error instanceof MimoServiceError ? error.statusCode : 500,
              errorMessage: error instanceof MimoServiceError
                ? error.publicMessage
                : '联网研究生成或保存失败。',
              failedAt: new Date().toISOString(),
            },
          )
        } catch {
          // Ignore stale cleanup attempts; the response below still reports the original failure.
        }
      }
      if (error instanceof MimoServiceError) {
        console.error('[research] provider request failed', {
          code: error.code,
          statusCode: error.statusCode,
        })
        if (error.retryAfterSeconds) {
          response.setHeader('Retry-After', String(error.retryAfterSeconds))
        }
        sendError(
          response as Response<ResearchErrorResponse>,
          error.statusCode,
          error.code,
          error.publicMessage,
        )
        return
      }
      if (sendPersistenceError(error, response as Response<ResearchErrorResponse>)) return
      if (isLikelyDatabaseError(error)) {
        sendError(response as Response<ResearchErrorResponse>, 503, 'DATABASE_UNAVAILABLE', '研究任务保存失败，请稍后重试。')
        return
      }
      console.error('[research] Unexpected server error')
      sendError(
        response as Response<ResearchErrorResponse>,
        500,
        'INTERNAL_ERROR',
        '研究服务暂时不可用。',
      )
    }
  },
)

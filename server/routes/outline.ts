import { Router, type Request, type Response } from 'express'
import { generateOutlineWithMimo } from '../services/mimoOutlineService'
import { MimoServiceError } from '../services/mimoResearchService'
import {
  completeOwnedOutline,
  failOwnedStage,
  startOwnedStage,
} from '../db/repositories/taskRepository'
import { getOwnerSessionId } from '../middleware/sessionOwner'
import { toPersistedOutline } from '../services/persistenceTransform'
import { isLikelyDatabaseError, sendPersistenceError } from './persistenceErrors'
import type {
  OutlineRequest,
  OutlineResponse,
  ResearchErrorResponse,
  SelectedResearchSource,
  SourceReviewLabel,
} from '../types/research'

export const outlineRouter = Router()
const reviewLabels = new Set<SourceReviewLabel>(['可信', '存疑', '待评估'])

function parseSource(value: unknown): SelectedResearchSource | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const item = value as Record<string, unknown>
  const id = typeof item.id === 'string' ? item.id.trim() : ''
  const title = typeof item.title === 'string' ? item.title.trim() : ''
  const url = typeof item.url === 'string' ? item.url.trim() : ''
  const publisher = typeof item.publisher === 'string' ? item.publisher.trim() : ''
  const type = typeof item.type === 'string' ? item.type.trim() : ''
  const summary = typeof item.summary === 'string' ? item.summary.trim() : ''
  const keyInsight = typeof item.keyInsight === 'string' ? item.keyInsight.trim() : ''
  const origin = item.origin === 'real' ? 'real' : null
  const credibility = typeof item.credibility === 'string'
    ? item.credibility.trim() as SourceReviewLabel
    : '待评估'
  try {
    const parsedUrl = new URL(url)
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) return null
  } catch {
    return null
  }
  if (
    !id || id.length > 160
    || !title || title.length > 500
    || url.length > 2048
    || publisher.length > 300
    || type.length > 100
    || !summary || summary.length > 6000
    || !keyInsight || keyInsight.length > 6000
    || !reviewLabels.has(credibility)
    || origin !== 'real'
  ) return null
  return { id, title, url, publisher, type, summary, keyInsight, credibility, origin }
}

function parseRequest(body: unknown): OutlineRequest | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const value = body as Record<string, unknown>
  const taskId = typeof value.taskId === 'string' ? value.taskId.trim() : ''
  const requestId = typeof value.requestId === 'string' ? value.requestId.trim() : ''
  const topic = typeof value.topic === 'string' ? value.topic.trim() : ''
  const goal = typeof value.goal === 'string' ? value.goal.trim() : ''
  const sources = Array.isArray(value.sources)
    ? value.sources.map(parseSource)
    : []
  if (
    !taskId || taskId.length > 160
    || !requestId || requestId.length > 160
    || !topic || topic.length > 200
    || !goal || goal.length > 1000
    || sources.length < 2 || sources.length > 30
    || sources.some((source) => !source)
  ) return null
  const validSources = sources as SelectedResearchSource[]
  if (
    new Set(validSources.map((source) => source.id)).size !== validSources.length
    || new Set(validSources.map((source) => source.url)).size !== validSources.length
  ) return null
  return { taskId, requestId, topic, goal, sources: validSources }
}

outlineRouter.post(
  '/',
  async (
    request: Request<unknown, OutlineResponse | ResearchErrorResponse, unknown>,
    response: Response<OutlineResponse | ResearchErrorResponse>,
  ) => {
    const input = parseRequest(request.body)
    if (!input) {
      response.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: '至少需要 2 条字段完整、URL 有效且不重复的非无关来源。',
        },
      })
      return
    }
    const ownerSessionId = getOwnerSessionId(response)
    const poolVersion = Number(request.get('X-Pool-Version'))
    if (!Number.isSafeInteger(poolVersion) || poolVersion < 0) {
      response.status(400).json({
        error: { code: 'INVALID_REQUEST', message: '请求缺少有效的资料池版本。' },
      })
      return
    }
    let stageStarted = false
    try {
      await startOwnedStage(
        ownerSessionId,
        input.taskId,
        'outline',
        input.requestId,
        new Date().toISOString(),
        { poolVersion },
      )
      stageStarted = true
      const generated = await generateOutlineWithMimo(input)
      await completeOwnedOutline(
        ownerSessionId,
        input.taskId,
        input.requestId,
        poolVersion,
        toPersistedOutline(generated),
      )
      response.json(generated)
    } catch (error) {
      if (stageStarted) {
        try {
          await failOwnedStage(ownerSessionId, input.taskId, 'outline', input.requestId, {
            errorCode: error instanceof MimoServiceError ? error.code : 'INTERNAL_ERROR',
            errorStatus: error instanceof MimoServiceError ? error.statusCode : 500,
            errorMessage: error instanceof MimoServiceError
              ? error.publicMessage
              : '研究大纲生成或保存失败。',
            failedAt: new Date().toISOString(),
          })
        } catch {
          // Ignore stale cleanup attempts.
        }
      }
      if (error instanceof MimoServiceError) {
        console.error('[outline] MiMo request failed', { code: error.code, statusCode: error.statusCode })
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
      console.error('[outline] Unexpected server error')
      response.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: '大纲生成服务暂时不可用。' },
      })
    }
  },
)

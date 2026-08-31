import { Router, type Request, type Response } from 'express'
import { generateReport } from '../services/reportGenerationService'
import { ResearchServiceError } from '../services/serviceError'
import {
  completeOwnedReport,
  failOwnedStage,
  startOwnedStage,
} from '../db/repositories/taskRepository'
import { getOwnerSessionId } from '../middleware/sessionOwner'
import { toPersistedReport } from '../services/persistenceTransform'
import { isLikelyDatabaseError, sendPersistenceError } from './persistenceErrors'
import type {
  ReportOutlineSection,
  ReportRequest,
  ReportResponse,
  ReportDepth,
  ResearchErrorResponse,
  SelectedResearchSource,
  SourceReviewLabel,
} from '../types/research'

export const reportRouter = Router()
const reviewLabels = new Set<SourceReviewLabel>(['可信', '存疑', '待评估'])
const reportRanges = new Map<ReportDepth, {
  min: number
  max: number
  minimumSources: number
}>([
  ['brief', { min: 800, max: 1200, minimumSources: 2 }],
  ['standard', { min: 1500, max: 2500, minimumSources: 4 }],
  ['deep', { min: 3000, max: 5000, minimumSources: 8 }],
])

function parseSource(value: unknown): SelectedResearchSource | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const item = value as Record<string, unknown>
  const id = typeof item.id === 'string' ? item.id.trim() : ''
  const title = typeof item.title === 'string' ? item.title.trim() : ''
  const url = typeof item.url === 'string' ? item.url.trim() : ''
  const publisher = typeof item.publisher === 'string' ? item.publisher.trim() : ''
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
    || !summary || summary.length > 6000
    || !keyInsight || keyInsight.length > 6000
    || !reviewLabels.has(credibility)
    || origin !== 'real'
  ) return null
  return { id, title, url, publisher, summary, keyInsight, credibility, origin }
}

function parseOutlineSection(value: unknown): ReportOutlineSection | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const item = value as Record<string, unknown>
  const id = typeof item.id === 'string' ? item.id.trim() : ''
  const title = typeof item.title === 'string' ? item.title.trim() : ''
  const description = typeof item.description === 'string' ? item.description.trim() : ''
  const sourceIds = Array.isArray(item.sourceIds)
    ? [...new Set(item.sourceIds.filter((sourceId): sourceId is string =>
        typeof sourceId === 'string' && Boolean(sourceId.trim())).map((sourceId) => sourceId.trim()))]
    : []
  if (!id || id.length > 160 || !title || title.length > 500 || !description || description.length > 1000) {
    return null
  }
  return { id, title, description, sourceIds }
}

function parseRequest(body: unknown): ReportRequest | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const value = body as Record<string, unknown>
  const taskId = typeof value.taskId === 'string' ? value.taskId.trim() : ''
  const requestId = typeof value.requestId === 'string' ? value.requestId.trim() : ''
  const topic = typeof value.topic === 'string' ? value.topic.trim() : ''
  const goal = typeof value.goal === 'string' ? value.goal.trim() : ''
  const outlineValue = value.outline
  if (!outlineValue || typeof outlineValue !== 'object' || Array.isArray(outlineValue)) return null
  const outlineRecord = outlineValue as Record<string, unknown>
  const outlineTitle = typeof outlineRecord.title === 'string' ? outlineRecord.title.trim() : ''
  const sections = Array.isArray(outlineRecord.sections)
    ? outlineRecord.sections.map(parseOutlineSection)
    : []
  const sources = Array.isArray(value.sources) ? value.sources.map(parseSource) : []
  const reportDepth = typeof value.reportDepth === 'string'
    ? value.reportDepth as ReportDepth
    : null
  const targetMinWords = typeof value.targetMinWords === 'number'
    && Number.isInteger(value.targetMinWords)
    ? value.targetMinWords
    : Number.NaN
  const targetMaxWords = typeof value.targetMaxWords === 'number'
    && Number.isInteger(value.targetMaxWords)
    ? value.targetMaxWords
    : Number.NaN
  const reportRange = reportDepth ? reportRanges.get(reportDepth) : undefined
  if (
    !taskId || taskId.length > 160
    || !requestId || requestId.length > 160
    || !topic || topic.length > 200 || !goal || goal.length > 1000
    || !outlineTitle || outlineTitle.length > 240
    || sections.length < 2 || sections.length > 10 || sections.some((section) => !section)
    || sources.length < 2 || sources.length > 30 || sources.some((source) => !source)
    || !reportDepth
    || !reportRange
    || targetMinWords !== reportRange.min
    || targetMaxWords !== reportRange.max
    || sources.length < reportRange.minimumSources
  ) return null
  const validSections = sections as ReportOutlineSection[]
  const validSources = sources as SelectedResearchSource[]
  const sourceIds = new Set(validSources.map((source) => source.id))
  if (
    new Set(validSections.map((section) => section.id)).size !== validSections.length
    || new Set(validSources.map((source) => source.id)).size !== validSources.length
    || validSections.some((section) => section.sourceIds.some((sourceId) => !sourceIds.has(sourceId)))
    || validSections.some((section) => section.sourceIds.length === 0)
  ) return null
  return {
    taskId,
    requestId,
    topic,
    goal,
    outline: { title: outlineTitle, sections: validSections },
    sources: validSources,
    reportDepth,
    targetMinWords,
    targetMaxWords,
  }
}

reportRouter.post(
  '/',
  async (
    request: Request<unknown, ReportResponse | ResearchErrorResponse, unknown>,
    response: Response<ReportResponse | ResearchErrorResponse>,
  ) => {
    const input = parseRequest(request.body)
    if (!input) {
      response.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: '报告请求中的主题、大纲或来源不完整，或包含未知来源。',
        },
      })
      return
    }
    const ownerSessionId = getOwnerSessionId(response)
    const versions = {
      poolVersion: Number(request.get('X-Pool-Version')),
      outlineVersion: Number(request.get('X-Outline-Version')),
      reportConfigVersion: Number(request.get('X-Report-Config-Version')),
    }
    if (Object.values(versions).some((version) => !Number.isSafeInteger(version) || version < 0)) {
      response.status(400).json({
        error: { code: 'INVALID_REQUEST', message: '请求缺少有效的报告依赖版本。' },
      })
      return
    }
    let stageStarted = false
    try {
      await startOwnedStage(
        ownerSessionId,
        input.taskId,
        'report',
        input.requestId,
        new Date().toISOString(),
        versions,
      )
      stageStarted = true
      const generated = await generateReport(input)
      await completeOwnedReport(
        ownerSessionId,
        input.taskId,
        input.requestId,
        versions,
        toPersistedReport(generated),
      )
      response.json(generated)
    } catch (error) {
      if (stageStarted) {
        try {
          await failOwnedStage(ownerSessionId, input.taskId, 'report', input.requestId, {
            errorCode: error instanceof ResearchServiceError ? error.code : 'INTERNAL_ERROR',
            errorStatus: error instanceof ResearchServiceError ? error.statusCode : 500,
            errorMessage: error instanceof ResearchServiceError
              ? error.publicMessage
              : '研究报告生成或保存失败。',
            failedAt: new Date().toISOString(),
          })
        } catch {
          // Ignore stale cleanup attempts.
        }
      }
      if (error instanceof ResearchServiceError) {
        console.error('[report] generation request failed', {
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
      console.error('[report] Unexpected server error')
      response.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: '报告生成服务暂时不可用。' },
      })
    }
  },
)

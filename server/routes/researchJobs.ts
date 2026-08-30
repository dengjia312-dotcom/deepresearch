import { randomUUID } from 'node:crypto'
import { Router, type Request, type Response } from 'express'
import {
  createOrReuseOwnedResearchJob,
  getOwnedResearchJob,
} from '../db/repositories/researchJobRepository'
import { TaskNotFoundError } from '../db/errors'
import { getOwnerSessionId } from '../middleware/sessionOwner'
import { scheduleResearchJob } from '../services/researchJobService'
import type { ResearchErrorResponse } from '../types/research'
import type { ResearchJobDto } from '../types/researchJob'
import { isLikelyDatabaseError, sendPersistenceError } from './persistenceErrors'
import { parseResearchRequest } from './research'

export const researchJobsRouter = Router()
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

researchJobsRouter.post(
  '/',
  async (
    request: Request<unknown, { jobId: string; status: string } | ResearchErrorResponse, unknown>,
    response: Response<{ jobId: string; status: string } | ResearchErrorResponse>,
  ) => {
    const input = parseResearchRequest(request.body)
    if (!input) {
      response.status(400).json({
        error: { code: 'INVALID_REQUEST', message: '研究任务请求字段不符合要求。' },
      })
      return
    }
    try {
      const ownerSessionId = getOwnerSessionId(response)
      const created = await createOrReuseOwnedResearchJob(
        ownerSessionId,
        randomUUID(),
        input,
      )
      if (created.created) {
        console.info('[research-job] created', {
          jobId: created.job.jobId,
          taskId: input.taskId,
          requestId: input.requestId,
        })
        scheduleResearchJob({ jobId: created.job.jobId, ownerSessionId, request: input })
      }
      response.status(202).json({
        jobId: created.job.jobId,
        status: created.job.status,
      })
    } catch (error) {
      if (sendPersistenceError(error, response as Response<ResearchErrorResponse>)) return
      if (isLikelyDatabaseError(error)) {
        response.status(503).json({
          error: { code: 'DATABASE_UNAVAILABLE', message: '研究任务暂时无法保存，请稍后重试。' },
        })
        return
      }
      console.error('[research-job] creation failed')
      response.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: '研究任务暂时无法创建。' },
      })
    }
  },
)

researchJobsRouter.get(
  '/:jobId',
  async (
    request: Request<{ jobId: string }, ResearchJobDto | ResearchErrorResponse>,
    response: Response<ResearchJobDto | ResearchErrorResponse>,
  ) => {
    const jobId = request.params.jobId.trim()
    if (!UUID_PATTERN.test(jobId)) {
      response.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'Research Job 标识无效。' },
      })
      return
    }
    try {
      const job = await getOwnedResearchJob(getOwnerSessionId(response), jobId)
      response.json(job)
    } catch (error) {
      if (error instanceof TaskNotFoundError) {
        response.status(404).json({
          error: { code: 'TASK_NOT_FOUND', message: 'Research Job 不存在或不属于当前会话。' },
        })
        return
      }
      if (isLikelyDatabaseError(error)) {
        response.status(503).json({
          error: { code: 'DATABASE_UNAVAILABLE', message: 'Research Job 状态暂时无法读取。' },
        })
        return
      }
      console.error('[research-job] status read failed')
      response.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: 'Research Job 状态读取失败。' },
      })
    }
  },
)

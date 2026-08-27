import type { Response } from 'express'
import {
  InvalidCitationError,
  StaleTaskWriteError,
  TaskNotFoundError,
  TaskOwnershipConflictError,
} from '../db/errors'
import type { ResearchErrorResponse } from '../types/research'

export function sendPersistenceError(
  error: unknown,
  response: Response<ResearchErrorResponse>,
) {
  if (error instanceof TaskNotFoundError) {
    response.status(404).json({
      error: { code: 'TASK_NOT_FOUND', message: '研究任务不存在。' },
    })
    return true
  }
  if (error instanceof StaleTaskWriteError) {
    response.status(409).json({
      error: { code: 'STALE_TASK_WRITE', message: '任务状态已更新，本次旧请求结果未写入。' },
    })
    return true
  }
  if (error instanceof InvalidCitationError) {
    response.status(409).json({
      error: { code: 'STALE_TASK_WRITE', message: '报告包含当前任务资料池之外的引用，已拒绝写入。' },
    })
    return true
  }
  if (error instanceof TaskOwnershipConflictError) {
    response.status(409).json({
      error: { code: 'TASK_CONFLICT', message: '任务标识已被占用。' },
    })
    return true
  }
  return false
}

export function isLikelyDatabaseError(error: unknown) {
  return error !== null
    && typeof error === 'object'
    && ('code' in error || error instanceof AggregateError)
}

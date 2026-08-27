import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { getOrCreateAnonymousSession } from '../db/repositories/sessionRepository'
import type { ResearchErrorResponse } from '../types/research'

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const sessionOwnerMiddleware: RequestHandler = async (
  request: Request,
  response: Response<ResearchErrorResponse>,
  next: NextFunction,
) => {
  const sessionId = request.get('X-Client-Session')?.trim() ?? ''
  if (!UUID_V4_PATTERN.test(sessionId)) {
    response.status(400).json({
      error: { code: 'INVALID_REQUEST', message: '缺少有效的匿名会话标识。' },
    })
    return
  }
  try {
    response.locals.ownerSessionId = await getOrCreateAnonymousSession(sessionId)
    next()
  } catch (error) {
    console.error('[database] Anonymous session resolution failed', {
      name: error instanceof Error ? error.name : 'UnknownError',
    })
    response.status(503).json({
      error: { code: 'DATABASE_UNAVAILABLE', message: '任务存储暂时不可用，请稍后重试。' },
    })
  }
}

export function getOwnerSessionId(response: Response) {
  const ownerSessionId = response.locals.ownerSessionId
  if (typeof ownerSessionId !== 'string' || !ownerSessionId) {
    throw new Error('Anonymous session owner was not resolved.')
  }
  return ownerSessionId
}

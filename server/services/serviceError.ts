import type { ResearchErrorCode } from '../types/research'

export class ResearchServiceError extends Error {
  constructor(
    public readonly code: ResearchErrorCode,
    public readonly statusCode: number,
    public readonly publicMessage: string,
    public readonly retryAfterSeconds?: number,
    public readonly diagnosticCode?: string,
  ) {
    super(publicMessage)
    this.name = 'ResearchServiceError'
  }
}

import 'dotenv/config'
import { createHash } from 'node:crypto'
import express, { type NextFunction, type Request, type Response } from 'express'
import {
  ApiProtectionStore,
  createApiProtectionMiddleware,
  createResearchJobPollingProtectionMiddleware,
  getApiProtectionConfig,
  getConfiguredTrustProxy,
} from './middleware/apiProtection'
import { planRouter } from './routes/plan'
import { researchRouter } from './routes/research'
import { researchJobsRouter } from './routes/researchJobs'
import { outlineRouter } from './routes/outline'
import { reportRouter } from './routes/report'
import { tasksRouter } from './routes/tasks'
import { getMimoConfiguration } from './services/mimoResearchService'
import type { ResearchErrorResponse } from './types/research'
import { sessionOwnerMiddleware } from './middleware/sessionOwner'
import { runDatabaseMigrations } from './db/migrate'
import { recoverInterruptedStages } from './db/repositories/taskRepository'
import { recoverInterruptedResearchJobs } from './db/repositories/researchJobRepository'
import { closeDatabasePool } from './db/pool'
import { startMimoWebSearchStartupDiagnostic } from './services/mimoWebSearchStartupDiagnostic'

const app = express()
const port = Number.parseInt(process.env.PORT ?? '3001', 10) || 3001
const apiProtectionConfig = getApiProtectionConfig()
const apiProtectionStore = new ApiProtectionStore(apiProtectionConfig.cleanupIntervalMs)
const researchProtectionMiddleware = createApiProtectionMiddleware(
  'research',
  { config: apiProtectionConfig, store: apiProtectionStore },
)
const researchJobPollingProtectionMiddleware = createResearchJobPollingProtectionMiddleware(
  apiProtectionStore,
)
const trustProxy = getConfiguredTrustProxy()

app.disable('x-powered-by')
if (trustProxy !== false) app.set('trust proxy', trustProxy)
app.use('/api/tasks/import-v4', express.json({ limit: '5mb' }))
app.use(express.json({ limit: '128kb' }))

app.get('/api/health', (_request, response) => {
  const config = getMimoConfiguration()
  response.json({
    status: 'ok',
    mimoConfigured: config.configured,
    model: config.model,
  })
})

app.use('/api/tasks', sessionOwnerMiddleware, tasksRouter)

app.use(
  '/api/research/jobs',
  (request, response, next) => request.method === 'GET'
    ? researchJobPollingProtectionMiddleware(request, response, next)
    : researchProtectionMiddleware(request, response, next),
  sessionOwnerMiddleware,
  researchJobsRouter,
)
app.use(
  '/api/research',
  researchProtectionMiddleware,
  sessionOwnerMiddleware,
  researchRouter,
)
app.use(
  '/api/plan',
  createApiProtectionMiddleware('plan', { config: apiProtectionConfig, store: apiProtectionStore }),
  sessionOwnerMiddleware,
  planRouter,
)
app.use(
  '/api/outline',
  createApiProtectionMiddleware('outline', { config: apiProtectionConfig, store: apiProtectionStore }),
  sessionOwnerMiddleware,
  outlineRouter,
)
app.use(
  '/api/report',
  createApiProtectionMiddleware('report', { config: apiProtectionConfig, store: apiProtectionStore }),
  sessionOwnerMiddleware,
  reportRouter,
)

app.use(
  (
    error: unknown,
    _request: Request,
    response: Response<ResearchErrorResponse>,
    _next: NextFunction,
  ) => {
    if (error instanceof SyntaxError) {
      response.status(400).json({
        error: { code: 'INVALID_REQUEST', message: '请求 JSON 格式无效。' },
      })
      return
    }
    console.error('[server] Unexpected request error')
    response.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: '服务器暂时不可用。' },
    })
  },
)

async function startServer() {
  await runDatabaseMigrations()
  await recoverInterruptedResearchJobs()
  await recoverInterruptedStages()
  app.listen(port, '0.0.0.0', () => {
    const { apiKey, baseUrl, configured, model } = getMimoConfiguration()
    console.log(`[server] listening on 0.0.0.0:${port}`)
    console.log('[server] AI config fingerprint', {
      baseUrl,
      model,
      apiKeyConfigured: configured,
      apiKeyFingerprint: apiKey
        ? createHash('sha256').update(apiKey).digest('hex').slice(0, 8)
        : null,
    })
    void startMimoWebSearchStartupDiagnostic()
  })
}

void startServer().catch(async (error) => {
  console.error('[server] Database initialization failed', {
    name: error instanceof Error ? error.name : 'UnknownError',
    message: error instanceof Error ? error.message : 'Unknown database startup error',
  })
  await closeDatabasePool().catch(() => undefined)
  process.exitCode = 1
})

export { app, startServer }

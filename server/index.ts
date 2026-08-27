import 'dotenv/config'
import express, { type NextFunction, type Request, type Response } from 'express'
import {
  ApiProtectionStore,
  createApiProtectionMiddleware,
  getApiProtectionConfig,
  getConfiguredTrustProxy,
} from './middleware/apiProtection'
import { planRouter } from './routes/plan'
import { researchRouter } from './routes/research'
import { outlineRouter } from './routes/outline'
import { reportRouter } from './routes/report'
import { tasksRouter } from './routes/tasks'
import { getMimoConfiguration } from './services/mimoResearchService'
import type { ResearchErrorResponse } from './types/research'
import { sessionOwnerMiddleware } from './middleware/sessionOwner'
import { runDatabaseMigrations } from './db/migrate'
import { recoverInterruptedStages } from './db/repositories/taskRepository'
import { closeDatabasePool } from './db/pool'

const app = express()
const port = Number.parseInt(process.env.PORT ?? '3001', 10) || 3001
const apiProtectionConfig = getApiProtectionConfig()
const apiProtectionStore = new ApiProtectionStore(apiProtectionConfig.cleanupIntervalMs)
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
  '/api/research',
  createApiProtectionMiddleware('research', { config: apiProtectionConfig, store: apiProtectionStore }),
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
  await recoverInterruptedStages()
  app.listen(port, '0.0.0.0', () => {
    const { configured, model } = getMimoConfiguration()
    console.log(`[server] listening on 0.0.0.0:${port}`)
    console.log(`[server] MiMo configured: ${configured}; model: ${model}`)
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

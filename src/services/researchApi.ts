import type {
  ReportDepth,
  ResearchPlan,
  PublicIntentConfirmation,
  ResearchDepth,
  ResearchTask,
  SearchDepth,
  ReviewStatus,
  Source,
  SourcePreference,
} from '../types'

const CLIENT_SESSION_STORAGE_KEY = 'deep-research:client-session-id'
const CLIENT_SESSION_HEADER = 'X-Client-Session'
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
let volatileSessionId: string | null = null

interface ClientSessionStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function getBrowserStorage(): ClientSessionStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function createUuidV4() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0'))
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`
}

function isValidClientSessionId(value: string | null): value is string {
  return typeof value === 'string'
    && value.length === 36
    && UUID_V4_PATTERN.test(value)
}

export function getOrCreateClientSessionId(
  storage: ClientSessionStorage | null = getBrowserStorage(),
  createId: () => string = createUuidV4,
) {
  if (storage) {
    try {
      const stored = storage.getItem(CLIENT_SESSION_STORAGE_KEY)
      if (isValidClientSessionId(stored)) return stored
      const created = createId()
      if (!isValidClientSessionId(created)) throw new Error('Invalid client session UUID')
      storage.setItem(CLIENT_SESSION_STORAGE_KEY, created)
      volatileSessionId = created
      return created
    } catch {
      // Continue with a page-lifetime identifier when localStorage is unavailable.
    }
  }
  if (!isValidClientSessionId(volatileSessionId)) volatileSessionId = createUuidV4()
  return volatileSessionId
}

function createApiHeaders(extra: Record<string, string> = {}) {
  return {
    'Content-Type': 'application/json',
    [CLIENT_SESSION_HEADER]: getOrCreateClientSessionId(),
    ...extra,
  }
}

export interface TaskDetailResponse {
  state: unknown
  citations: Array<{
    sectionId: string
    paragraphId: string
    sourceId: string
    citationOrder: number
  }>
}

export interface TaskSummaryResponse {
  task: ResearchTask
  planStatus: string
  searchStatus: string
  outlineStatus: string
  reportStatus: string
  updatedAt: string
}

export interface LivePlanResponse {
  taskId: string
  requestId: string
  mode: 'live'
  dataSource: 'real'
  plan: {
    objective: string
    scope: string
    questions: Array<{
      id: string
      text: string
    }>
    sourcePreferences: SourcePreference[]
    estimatedSourceCount: number
    estimatedDurationMinutes: number
  }
  intentConfirmation?: PublicIntentConfirmation
  generatedAt: string
}

export interface LiveResearchRequest {
  taskId: string
  requestId: string
  topic: string
  goal: string
  sourcePreferences: string[]
  targetSourceCount: number
}

export interface LiveResearchSource {
  id: string
  title: string
  url: string
  publisher: string
  publishedAt: string
  type: string
  credibility: '待评估'
  summary: string
  keyInsight: string
}

export interface LiveResearchResponse {
  taskId: string
  requestId: string
  mode: 'live'
  dataSource: 'real'
  topic: string
  summary: string
  insights: Array<{
    id: string
    title: string
    content: string
    sourceIds: string[]
  }>
  sources: LiveResearchSource[]
  warnings: string[]
  targetSourceCount: number
  actualSourceCount: number
  deduplicatedSourceCount: number
  validSourceCount: number
  searchedAt: string
}

export type ResearchJobStatus = 'queued' | 'running' | 'completed' | 'failed'
export type ResearchJobPhase =
  | 'queued'
  | 'searching'
  | 'reading'
  | 'synthesizing'
  | 'completed'
  | 'failed'

export interface ResearchJobProgress {
  validSourceCount: number
  readerTargetCount: number
  readerCompletedCount: number
  fullTextCount: number
  partialCount: number
  insufficientCount: number
  readerFailedCount: number
  agent?: {
    currentRound: 1 | 2
    maxRounds: 2
    replanCount: 0 | 1
    phase: 'initializing' | 'round_search' | 'round_read' | 'evaluating' | 'replanning' | 'completed' | 'failed'
    evaluationStatus: 'not_started' | 'evaluating' | 'sufficient' | 'insufficient'
    evidenceNeedCount: number
    satisfiedEvidenceNeedCount: number
    followUpQueryCount: number
    evidenceCount: number
  }
}

export interface ResearchJobResponse {
  jobId: string
  taskId: string
  requestId: string
  status: ResearchJobStatus
  phase: ResearchJobPhase
  progress: ResearchJobProgress
  result: LiveResearchResponse | null
  error: { code: string; message: string; status: number | null } | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export interface ResearchHealthResponse {
  status: 'ok'
  mimoConfigured: boolean
  model: string
}

export type SourceReviewLabel = '可信' | '存疑' | '待评估'

export interface SelectedSourceRequest {
  id: string
  title: string
  url: string
  publisher: string
  type?: string
  summary: string
  keyInsight: string
  credibility: SourceReviewLabel
  origin: 'real'
}

export interface LiveOutlineResponse {
  taskId: string
  requestId: string
  mode: 'live'
  dataSource: 'real'
  outline: {
    title: string
    sections: Array<{
      id: string
      title: string
      description: string
      sourceIds: string[]
      evidenceStatus: 'sufficient' | 'limited' | 'insufficient'
    }>
  }
  warnings: string[]
  generatedAt: string
}

export interface LiveReportResponse {
  taskId: string
  requestId: string
  mode: 'live'
  dataSource: 'real'
  report: {
    title: string
    executiveSummary: string
    sections: Array<{
      id: string
      title: string
      paragraphs: Array<{
        id: string
        content: string
        sourceIds: string[]
        claimType: 'source_supported' | 'synthesis' | 'uncertain'
      }>
    }>
    conclusion: string
    limitations: string[]
  }
  warnings: string[]
  reportDepth: ReportDepth
  targetMinWords: number
  targetMaxWords: number
  actualWordCount: number
  generatedAt: string
}

interface ResearchApiErrorBody {
  error?: {
    code?: string
    message?: string
  }
}

export class ResearchApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'ResearchApiError'
  }
}

async function parseError(response: Response): Promise<never> {
  let body: ResearchApiErrorBody = {}
  try {
    body = await response.json() as ResearchApiErrorBody
  } catch {
    // Keep a safe generic error when the server returns a non-JSON body.
  }
  throw new ResearchApiError(
    body.error?.code ?? 'REQUEST_FAILED',
    body.error?.message ?? '研究服务请求失败。',
    response.status,
  )
}

export async function getResearchHealth(signal?: AbortSignal) {
  const response = await fetch('/api/health', { signal })
  if (!response.ok) await parseError(response)
  return response.json() as Promise<ResearchHealthResponse>
}

export async function requestLivePlan(
  request: { taskId: string; requestId: string; topic: string; depth: ResearchDepth },
  signal?: AbortSignal,
) {
  const response = await fetch('/api/plan', {
    method: 'POST',
    headers: createApiHeaders(),
    body: JSON.stringify(request),
    signal,
  })
  if (!response.ok) await parseError(response)
  return response.json() as Promise<LivePlanResponse>
}

export async function requestLiveResearch(
  request: LiveResearchRequest,
  signal?: AbortSignal,
) {
  const response = await fetch('/api/research', {
    method: 'POST',
    headers: createApiHeaders(),
    body: JSON.stringify(request),
    signal,
  })
  if (!response.ok) await parseError(response)
  return response.json() as Promise<LiveResearchResponse>
}

export async function requestCreateResearchJob(
  request: LiveResearchRequest,
  signal?: AbortSignal,
) {
  const response = await fetch('/api/research/jobs', {
    method: 'POST',
    headers: createApiHeaders(),
    body: JSON.stringify(request),
    signal,
  })
  if (!response.ok) await parseError(response)
  return response.json() as Promise<{ jobId: string; status: ResearchJobStatus }>
}

export async function requestResearchJob(jobId: string, signal?: AbortSignal) {
  const response = await fetch(`/api/research/jobs/${encodeURIComponent(jobId)}`, {
    headers: createApiHeaders(),
    signal,
  })
  if (!response.ok) await parseError(response)
  return response.json() as Promise<ResearchJobResponse>
}

export async function pollResearchJob(
  jobId: string,
  options: {
    signal?: AbortSignal
    intervalMs?: number
    onUpdate?: (job: ResearchJobResponse) => void
    request?: typeof requestResearchJob
  } = {},
) {
  const intervalMs = options.intervalMs ?? 2_000
  const request = options.request ?? requestResearchJob
  while (!options.signal?.aborted) {
    const job = await request(jobId, options.signal)
    options.onUpdate?.(job)
    if (job.status === 'completed' || job.status === 'failed') return job
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer)
        reject(new DOMException('Polling aborted', 'AbortError'))
      }
      const timer = setTimeout(() => {
        options.signal?.removeEventListener('abort', onAbort)
        resolve()
      }, intervalMs)
      options.signal?.addEventListener('abort', onAbort, { once: true })
    })
  }
  throw new DOMException('Polling aborted', 'AbortError')
}

export async function requestLiveOutline(
  request: {
    taskId: string
    requestId: string
    topic: string
    goal: string
    sources: SelectedSourceRequest[]
    poolVersion: number
  },
  signal?: AbortSignal,
) {
  const { poolVersion, ...body } = request
  const response = await fetch('/api/outline', {
    method: 'POST',
    headers: createApiHeaders({ 'X-Pool-Version': String(poolVersion) }),
    body: JSON.stringify(body),
    signal,
  })
  if (!response.ok) await parseError(response)
  return response.json() as Promise<LiveOutlineResponse>
}

export async function requestLiveReport(
  request: {
    taskId: string
    requestId: string
    topic: string
    goal: string
    outline: LiveOutlineResponse['outline']
    sources: SelectedSourceRequest[]
    reportDepth: ReportDepth
    targetMinWords: number
    targetMaxWords: number
    poolVersion: number
    outlineVersion: number
    reportConfigVersion: number
  },
  signal?: AbortSignal,
) {
  const { poolVersion, outlineVersion, reportConfigVersion, ...body } = request
  const response = await fetch('/api/report', {
    method: 'POST',
    headers: createApiHeaders({
      'X-Pool-Version': String(poolVersion),
      'X-Outline-Version': String(outlineVersion),
      'X-Report-Config-Version': String(reportConfigVersion),
    }),
    body: JSON.stringify(body),
    signal,
  })
  if (!response.ok) await parseError(response)
  return response.json() as Promise<LiveReportResponse>
}

export async function requestTaskList(signal?: AbortSignal) {
  const response = await fetch('/api/tasks', { headers: createApiHeaders(), signal })
  if (!response.ok) await parseError(response)
  return response.json() as Promise<{ tasks: TaskSummaryResponse[] }>
}

export async function requestTaskDetail(taskId: string, signal?: AbortSignal) {
  const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
    headers: createApiHeaders(),
    signal,
  })
  if (!response.ok) await parseError(response)
  return response.json() as Promise<TaskDetailResponse>
}

export type ReportExportFormat = 'pdf' | 'docx'

function reportExportFilename(response: Response, format: ReportExportFormat) {
  const disposition = response.headers.get('Content-Disposition') ?? ''
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  if (encoded) {
    try {
      return decodeURIComponent(encoded)
    } catch {
      // Fall back to a safe local filename when the response header is malformed.
    }
  }
  return `Deep_Research_Report.${format}`
}

export async function requestReportExport(
  taskId: string,
  format: ReportExportFormat,
  signal?: AbortSignal,
) {
  const response = await fetch(
    `/api/tasks/${encodeURIComponent(taskId)}/report.${format}`,
    { headers: createApiHeaders(), signal },
  )
  if (!response.ok) await parseError(response)
  const blob = await response.blob()
  if (blob.size === 0) {
    throw new ResearchApiError('REPORT_EXPORT_FAILED', '导出的报告文件为空。', 500)
  }
  return { blob, filename: reportExportFilename(response, format) }
}

export async function requestCreateTask(task: ResearchTask, signal?: AbortSignal) {
  const response = await fetch('/api/tasks', {
    method: 'POST',
    headers: createApiHeaders(),
    body: JSON.stringify({ task }),
    signal,
  })
  if (!response.ok) await parseError(response)
  return response.json() as Promise<TaskDetailResponse>
}

export async function requestImportV4(workspace: unknown, signal?: AbortSignal) {
  const response = await fetch('/api/tasks/import-v4', {
    method: 'POST',
    headers: createApiHeaders(),
    body: JSON.stringify(workspace),
    signal,
  })
  if (!response.ok) await parseError(response)
  return response.json() as Promise<{ imported: number; total: number }>
}

export async function requestSavePlan(
  taskId: string,
  plan: ResearchPlan,
  invalidateDownstream: boolean,
  searchDepth: SearchDepth,
  targetSourceCount: number,
) {
  const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/plan`, {
    method: 'PUT',
    headers: createApiHeaders(),
    body: JSON.stringify({ plan, invalidateDownstream, searchDepth, targetSourceCount }),
  })
  if (!response.ok) await parseError(response)
  return response.json() as Promise<TaskDetailResponse>
}

export async function requestConfirmResearchIntent(
  taskId: string,
  input: { candidateId: string } | { customDirection: string },
  signal?: AbortSignal,
) {
  const response = await fetch(
    `/api/tasks/${encodeURIComponent(taskId)}/research-intent/confirm`,
    {
      method: 'POST',
      headers: createApiHeaders(),
      body: JSON.stringify(input),
      signal,
    },
  )
  if (!response.ok) await parseError(response)
  return response.json() as Promise<TaskDetailResponse>
}

export async function requestReportConfig(
  taskId: string,
  reportDepth: ReportDepth,
  targetMinWords: number,
  targetMaxWords: number,
) {
  const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/report-config`, {
    method: 'PUT',
    headers: createApiHeaders(),
    body: JSON.stringify({ reportDepth, targetMinWords, targetMaxWords }),
  })
  if (!response.ok) await parseError(response)
  return response.json() as Promise<TaskDetailResponse>
}

export async function requestUseMockStage(
  taskId: string,
  stage: 'plan' | 'research' | 'outline' | 'report',
  plan?: ResearchPlan,
) {
  const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/mock/${stage}`, {
    method: 'POST',
    headers: createApiHeaders(),
    body: JSON.stringify({ plan }),
  })
  if (!response.ok) await parseError(response)
  return response.json() as Promise<TaskDetailResponse>
}

export async function requestAddPoolItem(taskId: string, source: Source) {
  const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/pool`, {
    method: 'POST',
    headers: createApiHeaders(),
    body: JSON.stringify({ source, dataSource: source.origin ?? 'mock' }),
  })
  if (!response.ok) await parseError(response)
  return response.json() as Promise<TaskDetailResponse>
}

export async function requestUpdatePoolItem(
  taskId: string,
  sourceId: string,
  mutation: { reviewStatus?: ReviewStatus; note?: string; credibility?: Source['credibility'] },
) {
  const response = await fetch(
    `/api/tasks/${encodeURIComponent(taskId)}/pool/${encodeURIComponent(sourceId)}`,
    {
      method: 'PATCH',
      headers: createApiHeaders(),
      body: JSON.stringify(mutation),
    },
  )
  if (!response.ok) await parseError(response)
  return response.json() as Promise<TaskDetailResponse>
}

export async function requestDeletePoolItem(taskId: string, sourceId: string) {
  const response = await fetch(
    `/api/tasks/${encodeURIComponent(taskId)}/pool/${encodeURIComponent(sourceId)}`,
    { method: 'DELETE', headers: createApiHeaders() },
  )
  if (!response.ok) await parseError(response)
  return response.json() as Promise<TaskDetailResponse>
}

export const clientSessionTestApi = {
  storageKey: CLIENT_SESSION_STORAGE_KEY,
  headerName: CLIENT_SESSION_HEADER,
  isValidClientSessionId,
}

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { researchWorkspaceTestApi } from '../src/context/ResearchContext'
import type {
  LiveOutlineResult,
  LiveReportResult,
  LiveResearchResult,
  ResearchPlan,
  Source,
} from '../src/types'

class MemoryStorage {
  private values = new Map<string, string>()

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

type Workspace = ReturnType<typeof researchWorkspaceTestApi.initWorkspaceState>
type WorkspaceAction = Parameters<typeof researchWorkspaceTestApi.workspaceReducer>[1]
type TaskAction = WorkspaceAction extends infer Action
  ? Action extends { type: 'UPDATE_TASK'; action: infer NestedAction }
    ? NestedAction
    : never
  : never

function updateTask(workspace: Workspace, action: TaskAction) {
  return researchWorkspaceTestApi.workspaceReducer(workspace, {
    type: 'UPDATE_TASK',
    taskId: 'task-A',
    action,
  })
}

function createPlan(): ResearchPlan {
  return {
    objective: '恢复测试目标',
    scope: '恢复测试范围',
    questions: [{ id: 'question-1', text: '核心问题' }],
    sourcePreferences: ['官方资料'],
    estimatedSourceCount: 12,
    estimatedDurationMinutes: 2,
    usesPrototypeData: true,
    dataSource: 'real',
    updatedAt: '2026-08-25T08:00:00.000Z',
    confirmedAt: null,
  }
}

function createSource(index: number): Source {
  return {
    id: `source-${index}`,
    rank: index,
    title: `来源 ${index}`,
    type: 'web',
    publisher: '测试发布方',
    url: `https://example.com/source-${index}`,
    publishDate: '2026-08-25',
    freshness: '测试',
    credibility: 'unverified',
    tags: [],
    summary: `摘要 ${index}`,
    keyInsight: `观点 ${index}`,
    addedToPool: false,
    excerpt: [],
    insights: [],
    origin: 'real',
  }
}

function createResearchResult(label: string): LiveResearchResult {
  return {
    mode: 'live',
    dataSource: 'real',
    topic: '恢复测试主题',
    summary: `${label}搜索结果`,
    insights: [],
    sources: [createSource(1), createSource(2)],
    warnings: [],
    targetSourceCount: 12,
    actualSourceCount: 2,
    deduplicatedSourceCount: 2,
    validSourceCount: 2,
    searchedAt: '2026-08-25T08:01:00.000Z',
  }
}

function createOutline(label: string): LiveOutlineResult {
  return {
    mode: 'live',
    dataSource: 'real',
    outline: {
      title: `${label}大纲`,
      sections: [1, 2].map((index) => ({
        id: `section-${index}`,
        title: `章节 ${index}`,
        description: `章节说明 ${index}`,
        sourceIds: [`source-${index}`],
        evidenceStatus: 'limited',
        children: [],
      })),
    },
    warnings: [],
    generatedAt: '2026-08-25T08:02:00.000Z',
  }
}

function createReport(label: string): LiveReportResult {
  return {
    mode: 'live',
    dataSource: 'real',
    report: {
      title: `${label}报告`,
      executiveSummary: '执行摘要',
      sections: [1, 2].map((index) => ({
        id: `section-${index}`,
        title: `章节 ${index}`,
        paragraphs: [{
          id: `paragraph-${index}`,
          content: `正文 ${index}`,
          sourceIds: [`source-${index}`],
          claimType: 'source_supported',
        }],
      })),
      conclusion: '结论',
      limitations: ['测试限制'],
    },
    warnings: [],
    reportDepth: 'brief',
    targetMinWords: 800,
    targetMaxWords: 1200,
    actualWordCount: 900,
    generatedAt: '2026-08-25T08:03:00.000Z',
  }
}

function createTaskWithPlan() {
  let workspace = researchWorkspaceTestApi.initWorkspaceState()
  workspace = researchWorkspaceTestApi.workspaceReducer(workspace, {
    type: 'CREATE_TASK',
    action: {
      type: 'PREPARE_RESEARCH',
      taskId: 'task-A',
      originalTopic: '恢复测试主题',
      standardizedTopic: '恢复测试主题',
      depth: 'deep',
      topicId: 'generic',
      usesPrototypeData: true,
    },
  })
  workspace = updateTask(workspace, {
    type: 'START_LIVE_PLAN',
    taskId: 'task-A',
    requestId: 'plan-r1',
    startedAt: '2026-08-25T08:00:00.000Z',
  })
  workspace = updateTask(workspace, {
    type: 'LIVE_PLAN_SUCCESS',
    taskId: 'task-A',
    requestId: 'plan-r1',
    researchPlan: createPlan(),
  })
  workspace = updateTask(workspace, {
    type: 'CONFIRM_PLAN',
    confirmedAt: '2026-08-25T08:00:30.000Z',
  })
  return workspace
}

function addCompletedResearch(workspace: Workspace) {
  workspace = updateTask(workspace, {
    type: 'START_LIVE_SEARCH',
    taskId: 'task-A',
    requestId: 'research-r1',
    startedAt: '2026-08-25T08:01:00.000Z',
  })
  return updateTask(workspace, {
    type: 'LIVE_SEARCH_SUCCESS',
    taskId: 'task-A',
    requestId: 'research-r1',
    result: createResearchResult('old'),
  })
}

function addCompletedOutlineAndReport(workspace: Workspace) {
  workspace = addCompletedResearch(workspace)
  workspace = updateTask(workspace, { type: 'ADD_SOURCE', source: createSource(1) })
  workspace = updateTask(workspace, { type: 'ADD_SOURCE', source: createSource(2) })
  let state = workspace.tasksById['task-A']
  workspace = updateTask(workspace, {
    type: 'START_LIVE_OUTLINE',
    taskId: 'task-A',
    requestId: 'outline-r1',
    startedAt: '2026-08-25T08:02:00.000Z',
    poolVersion: state.poolVersion,
  })
  workspace = updateTask(workspace, {
    type: 'LIVE_OUTLINE_SUCCESS',
    taskId: 'task-A',
    requestId: 'outline-r1',
    poolVersion: state.poolVersion,
    result: createOutline('old'),
  })
  state = workspace.tasksById['task-A']
  workspace = updateTask(workspace, {
    type: 'START_LIVE_REPORT',
    taskId: 'task-A',
    requestId: 'report-r1',
    startedAt: '2026-08-25T08:03:00.000Z',
    poolVersion: state.poolVersion,
    outlineVersion: state.outlineVersion,
    reportConfigVersion: state.reportConfigVersion,
  })
  return updateTask(workspace, {
    type: 'LIVE_REPORT_SUCCESS',
    taskId: 'task-A',
    requestId: 'report-r1',
    poolVersion: state.poolVersion,
    outlineVersion: state.outlineVersion,
    reportConfigVersion: state.reportConfigVersion,
    result: createReport('old'),
  })
}

test.beforeEach(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: new MemoryStorage() },
  })
})

test('已有完整研究链路时 Plan 重试失败保留全部旧数据', () => {
  let workspace = addCompletedOutlineAndReport(createTaskWithPlan())
  const before = workspace.tasksById['task-A']
  workspace = updateTask(workspace, {
    type: 'START_LIVE_PLAN', taskId: 'task-A', requestId: 'plan-r2', startedAt: 'start',
  })
  assert.equal(workspace.tasksById['task-A'].researchPlan, before.researchPlan)
  assert.equal(workspace.tasksById['task-A'].liveResearchResult, before.liveResearchResult)
  assert.equal(workspace.tasksById['task-A'].liveOutline, before.liveOutline)
  assert.equal(workspace.tasksById['task-A'].liveReport, before.liveReport)
  workspace = updateTask(workspace, {
    type: 'LIVE_PLAN_ERROR',
    taskId: 'task-A',
    requestId: 'plan-r2',
    message: '计划超时',
    errorCode: 'MIMO_TIMEOUT',
    errorStatus: 504,
    failedAt: 'failed-at',
  })

  const state = workspace.tasksById['task-A']
  assert.equal(state.researchPlan, before.researchPlan)
  assert.equal(state.liveResearchResult, before.liveResearchResult)
  assert.deepEqual(state.poolItems, before.poolItems)
  assert.equal(state.liveOutline, before.liveOutline)
  assert.equal(state.liveReport, before.liveReport)
  assert.equal(state.reportGenerated, true)
  assert.equal(state.planStatus, 'error')
  assert.equal(state.requests.plan.lastErrorCode, 'MIMO_TIMEOUT')
  assert.equal(state.requests.plan.lastErrorStatus, 504)
  assert.equal(state.requests.plan.failedAt, 'failed-at')
})

test('新 Plan 成功替换后失效本任务旧下游数据且不影响其他任务', () => {
  let workspace = addCompletedOutlineAndReport(createTaskWithPlan())
  workspace = researchWorkspaceTestApi.workspaceReducer(workspace, {
    type: 'CREATE_TASK',
    action: {
      type: 'PREPARE_RESEARCH',
      taskId: 'task-B',
      originalTopic: '任务 B 主题',
      standardizedTopic: '任务 B 主题',
      depth: 'quick',
      topicId: 'generic',
      usesPrototypeData: true,
    },
  })
  const taskBBefore = workspace.tasksById['task-B']
  const taskABefore = workspace.tasksById['task-A']
  const nextPlan = {
    ...createPlan(),
    objective: '新研究目标',
    updatedAt: '2026-08-25T09:00:00.000Z',
  }

  workspace = updateTask(workspace, {
    type: 'START_LIVE_PLAN',
    taskId: 'task-A',
    requestId: 'plan-r2',
    startedAt: 'start',
  })
  assert.equal(workspace.tasksById['task-A'].liveReport, taskABefore.liveReport)
  workspace = updateTask(workspace, {
    type: 'LIVE_PLAN_SUCCESS',
    taskId: 'task-A',
    requestId: 'plan-r2',
    researchPlan: nextPlan,
  })

  const taskAAfter = workspace.tasksById['task-A']
  assert.equal(taskAAfter.researchPlan, nextPlan)
  assert.equal(taskAAfter.task.status, 'draft')
  assert.equal(taskAAfter.liveResearchResult, null)
  assert.equal(taskAAfter.searchStatus, 'idle')
  assert.equal(taskAAfter.poolItems.length, 0)
  assert.equal(taskAAfter.liveOutline, null)
  assert.equal(taskAAfter.outlineGenerated, false)
  assert.equal(taskAAfter.outlineStatus, 'idle')
  assert.equal(taskAAfter.liveReport, null)
  assert.equal(taskAAfter.reportGenerated, false)
  assert.equal(taskAAfter.reportStatus, 'idle')
  assert.equal(taskAAfter.requests.research.status, 'idle')
  assert.equal(taskAAfter.requests.outline.status, 'idle')
  assert.equal(taskAAfter.requests.report.status, 'idle')
  assert.equal(taskAAfter.poolVersion, taskABefore.poolVersion + 1)
  assert.equal(taskAAfter.outlineVersion, taskABefore.outlineVersion + 1)
  assert.equal(workspace.tasksById['task-B'], taskBBefore)
})

test('Research 超时保留旧搜索结果和 Plan', () => {
  let workspace = addCompletedResearch(createTaskWithPlan())
  const oldPlan = workspace.tasksById['task-A'].researchPlan
  const oldResult = workspace.tasksById['task-A'].liveResearchResult
  workspace = updateTask(workspace, {
    type: 'START_LIVE_SEARCH', taskId: 'task-A', requestId: 'research-r2', startedAt: 'start',
  })
  workspace = updateTask(workspace, {
    type: 'LIVE_SEARCH_ERROR',
    taskId: 'task-A',
    requestId: 'research-r2',
    targetSourceCount: 12,
    message: 'MiMo 请求超时，请稍后重试。',
    errorCode: 'MIMO_TIMEOUT',
    errorStatus: 504,
    failedAt: 'failed-at',
  })

  const state = workspace.tasksById['task-A']
  assert.equal(state.researchPlan, oldPlan)
  assert.equal(state.liveResearchResult, oldResult)
  assert.equal(state.searchStatus, 'error')
  assert.equal(state.requests.research.lastErrorCode, 'MIMO_TIMEOUT')
})

test('Research 失败页保持旧结果可见并显示保留提示', () => {
  const page = readFileSync('src/pages/SearchResultsPage.tsx', 'utf8')
  assert.match(page, /本次联网研究失败，上次成功结果已保留。/)
  assert.match(page, /\|\| hasPreservedLiveResult/)
  assert.match(page, /继续查看旧结果/)
})

test('Outline 重试失败保留旧 Outline、Report 和 Sources', () => {
  let workspace = addCompletedOutlineAndReport(createTaskWithPlan())
  const before = workspace.tasksById['task-A']
  workspace = updateTask(workspace, {
    type: 'START_LIVE_OUTLINE',
    taskId: 'task-A',
    requestId: 'outline-r2',
    startedAt: 'start',
    poolVersion: before.poolVersion,
  })
  assert.equal(workspace.tasksById['task-A'].liveReport, before.liveReport)
  workspace = updateTask(workspace, {
    type: 'LIVE_OUTLINE_ERROR',
    taskId: 'task-A',
    requestId: 'outline-r2',
    poolVersion: before.poolVersion,
    message: '大纲生成失败',
    errorCode: 'MIMO_UPSTREAM_ERROR',
    errorStatus: 502,
    failedAt: 'failed-at',
  })

  const after = workspace.tasksById['task-A']
  assert.equal(after.liveOutline, before.liveOutline)
  assert.equal(after.liveReport, before.liveReport)
  assert.equal(after.reportGenerated, true)
  assert.deepEqual(after.poolItems, before.poolItems)
})

test('Outline 重试成功后才用新 Outline 替换并使旧 Report 失效', () => {
  let workspace = addCompletedOutlineAndReport(createTaskWithPlan())
  const before = workspace.tasksById['task-A']
  const newOutline = createOutline('new')
  workspace = updateTask(workspace, {
    type: 'START_LIVE_OUTLINE',
    taskId: 'task-A',
    requestId: 'outline-r2',
    startedAt: 'start',
    poolVersion: before.poolVersion,
  })
  assert.equal(workspace.tasksById['task-A'].liveReport, before.liveReport)
  workspace = updateTask(workspace, {
    type: 'LIVE_OUTLINE_SUCCESS',
    taskId: 'task-A',
    requestId: 'outline-r2',
    poolVersion: before.poolVersion,
    result: newOutline,
  })

  const after = workspace.tasksById['task-A']
  assert.equal(after.liveOutline, newOutline)
  assert.equal(after.liveReport, null)
  assert.equal(after.reportGenerated, false)
})

test('Report 重试失败保留旧 Report、Outline 和 Sources', () => {
  let workspace = addCompletedOutlineAndReport(createTaskWithPlan())
  const before = workspace.tasksById['task-A']
  workspace = updateTask(workspace, {
    type: 'START_LIVE_REPORT',
    taskId: 'task-A',
    requestId: 'report-r2',
    startedAt: 'start',
    poolVersion: before.poolVersion,
    outlineVersion: before.outlineVersion,
    reportConfigVersion: before.reportConfigVersion,
  })
  workspace = updateTask(workspace, {
    type: 'LIVE_REPORT_ERROR',
    taskId: 'task-A',
    requestId: 'report-r2',
    poolVersion: before.poolVersion,
    outlineVersion: before.outlineVersion,
    reportConfigVersion: before.reportConfigVersion,
    reportDepth: 'brief',
    message: '报告生成失败',
    errorCode: 'MIMO_RATE_LIMITED',
    errorStatus: 503,
    failedAt: 'failed-at',
  })

  const after = workspace.tasksById['task-A']
  assert.equal(after.liveReport, before.liveReport)
  assert.equal(after.liveOutline, before.liveOutline)
  assert.deepEqual(after.poolItems, before.poolItems)
  assert.equal(after.requests.report.lastErrorCode, 'MIMO_RATE_LIMITED')
})

test('已有 Report 时 Report 页显示失败原因和当前步骤重试按钮', () => {
  const page = readFileSync('src/pages/ReportPage.tsx', 'utf8')
  assert.match(page, /本次报告生成失败，上次成功报告已保留。/)
  assert.match(page, /重新生成当前报告/)
  assert.match(page, /onClick=\{\(\) => void generateReport\(\)\}/)
})

test('刷新 loading Report 恢复为可重试 error 且保留成功数据', () => {
  const storage = new MemoryStorage()
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: storage },
  })
  let workspace = addCompletedOutlineAndReport(createTaskWithPlan())
  const before = workspace.tasksById['task-A']
  workspace = updateTask(workspace, {
    type: 'START_LIVE_REPORT',
    taskId: 'task-A',
    requestId: 'report-r2',
    startedAt: 'start',
    poolVersion: before.poolVersion,
    outlineVersion: before.outlineVersion,
    reportConfigVersion: before.reportConfigVersion,
  })
  storage.setItem(
    'ai-research-workspace-v4',
    JSON.stringify(researchWorkspaceTestApi.persistWorkspaceState(workspace)),
  )

  const restored = researchWorkspaceTestApi.initWorkspaceState().tasksById['task-A']
  assert.equal(restored.reportStatus, 'error')
  assert.equal(restored.requests.report.lastErrorCode, 'REQUEST_INTERRUPTED')
  assert.equal(restored.requests.report.requestId, null)
  assert.equal(restored.liveReport?.report.title, 'old报告')
  assert.equal(restored.liveOutline?.outline.title, 'old大纲')
  assert.equal(restored.poolItems.length, 2)
})

test('API 失败链路不会自动调用 USE_MOCK', () => {
  const context = readFileSync('src/context/ResearchContext.tsx', 'utf8')
  const requestFunctions = [
    ['const requestPlanForTask', 'const prepareResearch'],
    ['const startLiveResearch', 'const useMockResearch'],
    ['const generateOutline', 'const useMockOutline'],
    ['const generateReport', 'const useMockReport'],
  ] as const
  requestFunctions.forEach(([start, end]) => {
    const functionBody = context.slice(context.indexOf(start), context.indexOf(end))
    assert.doesNotMatch(functionBody, /type: 'USE_MOCK_/)
  })
})

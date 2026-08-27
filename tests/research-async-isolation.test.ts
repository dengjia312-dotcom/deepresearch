import assert from 'node:assert/strict'
import test from 'node:test'
import { researchWorkspaceTestApi } from '../src/context/ResearchContext'
import type {
  LiveOutlineResult,
  LiveReportResult,
  LiveResearchResult,
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

function createWorkspace(...taskIds: string[]) {
  let workspace = researchWorkspaceTestApi.initWorkspaceState()
  for (const taskId of taskIds) {
    workspace = researchWorkspaceTestApi.workspaceReducer(workspace, {
      type: 'CREATE_TASK',
      action: {
        type: 'PREPARE_RESEARCH',
        taskId,
        originalTopic: `${taskId}主题`,
        standardizedTopic: `${taskId}主题`,
        depth: 'deep',
        topicId: 'generic',
        usesPrototypeData: true,
      },
    })
  }
  return workspace
}

function createResearchResult(label: string): LiveResearchResult {
  return {
    mode: 'live',
    dataSource: 'real',
    topic: `${label}主题`,
    summary: `${label}摘要`,
    insights: [],
    sources: [],
    warnings: [],
    targetSourceCount: 12,
    actualSourceCount: 0,
    deduplicatedSourceCount: 0,
    validSourceCount: 0,
    searchedAt: `2026-08-24T10:00:0${label.length}.000Z`,
  }
}

function createSource(id: string): Source {
  return {
    id,
    rank: 1,
    title: id,
    type: 'web',
    publisher: '测试发布方',
    url: `https://example.com/${id}`,
    publishDate: '2026-08-24',
    freshness: '测试',
    credibility: 'unverified',
    tags: [],
    summary: id,
    keyInsight: id,
    addedToPool: false,
    excerpt: [],
    insights: [],
    origin: 'real',
  }
}

function createOutline(label: string): LiveOutlineResult {
  return {
    mode: 'live',
    dataSource: 'real',
    outline: { title: label, sections: [] },
    warnings: [],
    generatedAt: '2026-08-24T10:00:00.000Z',
  }
}

function createReport(label: string): LiveReportResult {
  return {
    mode: 'live',
    dataSource: 'real',
    report: {
      title: label,
      executiveSummary: label,
      sections: [],
      conclusion: label,
      limitations: [],
    },
    warnings: [],
    reportDepth: 'brief',
    targetMinWords: 800,
    targetMaxWords: 1200,
    actualWordCount: 800,
    generatedAt: '2026-08-24T10:00:00.000Z',
  }
}

function updateTask(
  workspace: ReturnType<typeof researchWorkspaceTestApi.initWorkspaceState>,
  taskId: string,
  action: Parameters<typeof researchWorkspaceTestApi.workspaceReducer>[1] extends infer Action
    ? Action extends { type: 'UPDATE_TASK'; action: infer TaskAction }
      ? TaskAction
      : never
    : never,
) {
  return researchWorkspaceTestApi.workspaceReducer(workspace, {
    type: 'UPDATE_TASK',
    taskId,
    action,
  })
}

test('任务 A/B 请求乱序返回时各自写回所属任务', () => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: new MemoryStorage() },
  })
  let workspace = createWorkspace('task-A', 'task-B')
  workspace = updateTask(workspace, 'task-A', {
    type: 'START_LIVE_SEARCH', taskId: 'task-A', requestId: 'A-r1', startedAt: 'A-start',
  })
  workspace = updateTask(workspace, 'task-B', {
    type: 'START_LIVE_SEARCH', taskId: 'task-B', requestId: 'B-r1', startedAt: 'B-start',
  })
  workspace = updateTask(workspace, 'task-B', {
    type: 'LIVE_SEARCH_SUCCESS', taskId: 'task-B', requestId: 'B-r1', result: createResearchResult('B'),
  })
  workspace = updateTask(workspace, 'task-A', {
    type: 'LIVE_SEARCH_SUCCESS', taskId: 'task-A', requestId: 'A-r1', result: createResearchResult('A'),
  })

  assert.equal(workspace.activeTaskId, 'task-B')
  assert.equal(workspace.tasksById['task-A'].liveResearchResult?.summary, 'A摘要')
  assert.equal(workspace.tasksById['task-B'].liveResearchResult?.summary, 'B摘要')
})

test('同一任务同一操作仅接受最新 requestId', () => {
  let workspace = createWorkspace('task-A')
  workspace = updateTask(workspace, 'task-A', {
    type: 'START_LIVE_SEARCH', taskId: 'task-A', requestId: 'r1', startedAt: 'start-1',
  })
  workspace = updateTask(workspace, 'task-A', {
    type: 'START_LIVE_SEARCH', taskId: 'task-A', requestId: 'r2', startedAt: 'start-2',
  })
  workspace = updateTask(workspace, 'task-A', {
    type: 'LIVE_SEARCH_SUCCESS', taskId: 'task-A', requestId: 'r2', result: createResearchResult('new'),
  })
  workspace = updateTask(workspace, 'task-A', {
    type: 'LIVE_SEARCH_SUCCESS', taskId: 'task-A', requestId: 'r1', result: createResearchResult('old'),
  })

  assert.equal(workspace.tasksById['task-A'].liveResearchResult?.summary, 'new摘要')
  assert.equal(workspace.tasksById['task-A'].requests.research.requestId, 'r2')
})

test('大纲生成中资料池变化会废弃旧结果', () => {
  let workspace = createWorkspace('task-A')
  workspace = updateTask(workspace, 'task-A', { type: 'ADD_SOURCE', source: createSource('source-1') })
  const poolVersion = workspace.tasksById['task-A'].poolVersion
  workspace = updateTask(workspace, 'task-A', {
    type: 'START_LIVE_OUTLINE',
    taskId: 'task-A',
    requestId: 'outline-r1',
    startedAt: 'start',
    poolVersion,
  })
  workspace = updateTask(workspace, 'task-A', { type: 'ADD_SOURCE', source: createSource('source-2') })
  workspace = updateTask(workspace, 'task-A', {
    type: 'LIVE_OUTLINE_SUCCESS',
    taskId: 'task-A',
    requestId: 'outline-r1',
    poolVersion,
    result: createOutline('stale'),
  })

  assert.equal(workspace.tasksById['task-A'].liveOutline, null)
  assert.equal(workspace.tasksById['task-A'].outlineStatus, 'idle')
})

test('报告生成中大纲版本变化会废弃旧结果', () => {
  let workspace = createWorkspace('task-A')
  const state = workspace.tasksById['task-A']
  workspace = updateTask(workspace, 'task-A', {
    type: 'START_LIVE_REPORT',
    taskId: 'task-A',
    requestId: 'report-r1',
    startedAt: 'start',
    poolVersion: state.poolVersion,
    outlineVersion: state.outlineVersion,
    reportConfigVersion: state.reportConfigVersion,
  })
  workspace = updateTask(workspace, 'task-A', { type: 'USE_MOCK_OUTLINE' })
  workspace = updateTask(workspace, 'task-A', {
    type: 'LIVE_REPORT_SUCCESS',
    taskId: 'task-A',
    requestId: 'report-r1',
    poolVersion: state.poolVersion,
    outlineVersion: state.outlineVersion,
    reportConfigVersion: state.reportConfigVersion,
    result: createReport('stale'),
  })

  assert.equal(workspace.tasksById['task-A'].liveReport, null)
  assert.equal(workspace.tasksById['task-A'].reportGenerated, false)
})

test('任务 A/B 可同时保持独立的 loading 状态', () => {
  let workspace = createWorkspace('task-A', 'task-B')
  workspace = updateTask(workspace, 'task-A', {
    type: 'START_LIVE_SEARCH', taskId: 'task-A', requestId: 'A-r1', startedAt: 'A-start',
  })
  workspace = updateTask(workspace, 'task-B', {
    type: 'START_LIVE_SEARCH', taskId: 'task-B', requestId: 'B-r1', startedAt: 'B-start',
  })

  assert.equal(workspace.tasksById['task-A'].requests.research.status, 'loading')
  assert.equal(workspace.tasksById['task-B'].requests.research.status, 'loading')
})

test('刷新恢复时不会把已中断请求保持为 running', () => {
  const storage = new MemoryStorage()
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: storage },
  })
  let workspace = createWorkspace('task-A')
  workspace = updateTask(workspace, 'task-A', {
    type: 'START_LIVE_SEARCH', taskId: 'task-A', requestId: 'r1', startedAt: 'start',
  })
  storage.setItem(
    'ai-research-workspace-v4',
    JSON.stringify(researchWorkspaceTestApi.persistWorkspaceState(workspace)),
  )

  const restored = researchWorkspaceTestApi.initWorkspaceState()
  assert.notEqual(restored.tasksById['task-A'].searchStatus, 'loading')
  assert.notEqual(restored.tasksById['task-A'].requests.research.status, 'loading')
  assert.equal(restored.tasksById['task-A'].requests.research.requestId, null)
})

test('后台任务完成时不允许驱动当前任务跳转', () => {
  assert.equal(
    researchWorkspaceTestApi.shouldNavigateAfterRequest('task-B', 'task-A', 'A-r1', 'A-r1'),
    false,
  )
  assert.equal(
    researchWorkspaceTestApi.shouldNavigateAfterRequest('task-A', 'task-A', 'A-r2', 'A-r1'),
    false,
  )
  assert.equal(
    researchWorkspaceTestApi.shouldNavigateAfterRequest('task-A', 'task-A', 'A-r1', 'A-r1'),
    true,
  )
})

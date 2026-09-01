import assert from 'node:assert/strict'
import test from 'node:test'
import { researchWorkspaceTestApi } from '../src/context/ResearchContext'
import type { ResearchPlan, Source } from '../src/types'

class MemoryStorage {
  private values = new Map<string, string>()

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

function createPlan(topic: string): ResearchPlan {
  return {
    objective: `${topic}研究目标`,
    scope: `${topic}研究范围`,
    questions: [{ id: `${topic}-question`, text: `${topic}核心问题` }],
    sourcePreferences: ['官方资料'],
    estimatedSourceCount: 8,
    estimatedDurationMinutes: 2,
    usesPrototypeData: true,
    dataSource: 'mock',
    updatedAt: '2026-08-24T10:00:00.000Z',
    confirmedAt: null,
  }
}

function createSource(task: 'A' | 'B', index: number): Source {
  return {
    id: `${task}-source-${index}`,
    rank: index,
    title: `任务${task}资料${index}`,
    type: 'web',
    publisher: `任务${task}发布方`,
    url: `https://example.com/${task.toLowerCase()}/${index}`,
    publishDate: '2026-08-24',
    freshness: '测试',
    credibility: 'unverified',
    tags: [`任务${task}`],
    summary: `仅属于任务${task}的摘要`,
    keyInsight: `仅属于任务${task}的观点`,
    addedToPool: false,
    excerpt: [],
    insights: [],
    origin: 'mock',
  }
}

test('任务 A/B 切换并在刷新后恢复各自状态', () => {
  const storage = new MemoryStorage()
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: storage },
  })

  let workspace = researchWorkspaceTestApi.initWorkspaceState()
  workspace = researchWorkspaceTestApi.workspaceReducer(workspace, {
    type: 'CREATE_TASK',
    action: {
      type: 'PREPARE_RESEARCH',
      taskId: 'task-A',
      originalTopic: '任务A主题',
      standardizedTopic: '任务A主题',
      depth: 'deep',
      topicId: 'generic',
      usesPrototypeData: true,
    },
  })
  workspace = researchWorkspaceTestApi.workspaceReducer(workspace, {
    type: 'UPDATE_TASK',
    taskId: 'task-A',
    action: { type: 'USE_MOCK_PLAN', taskId: 'task-A', researchPlan: createPlan('任务A') },
  })
  workspace = researchWorkspaceTestApi.workspaceReducer(workspace, {
    type: 'UPDATE_TASK',
    taskId: 'task-A',
    action: { type: 'CONFIRM_PLAN', confirmedAt: '2026-08-24T10:01:00.000Z' },
  })
  for (const index of [1, 2]) {
    workspace = researchWorkspaceTestApi.workspaceReducer(workspace, {
      type: 'UPDATE_TASK',
      taskId: 'task-A',
      action: { type: 'ADD_SOURCE', source: createSource('A', index) },
    })
  }
  workspace = researchWorkspaceTestApi.workspaceReducer(workspace, {
    type: 'UPDATE_TASK',
    taskId: 'task-A',
    action: { type: 'USE_MOCK_OUTLINE' },
  })

  workspace = researchWorkspaceTestApi.workspaceReducer(workspace, {
    type: 'CREATE_TASK',
    action: {
      type: 'PREPARE_RESEARCH',
      taskId: 'task-B',
      originalTopic: '任务B主题',
      standardizedTopic: '任务B主题',
      depth: 'quick',
      topicId: 'generic',
      usesPrototypeData: true,
    },
  })
  workspace = researchWorkspaceTestApi.workspaceReducer(workspace, {
    type: 'UPDATE_TASK',
    taskId: 'task-B',
    action: { type: 'USE_MOCK_PLAN', taskId: 'task-B', researchPlan: createPlan('任务B') },
  })
  workspace = researchWorkspaceTestApi.workspaceReducer(workspace, {
    type: 'UPDATE_TASK',
    taskId: 'task-B',
    action: { type: 'CONFIRM_PLAN', confirmedAt: '2026-08-24T10:02:00.000Z' },
  })
  workspace = researchWorkspaceTestApi.workspaceReducer(workspace, {
    type: 'UPDATE_TASK',
    taskId: 'task-B',
    action: { type: 'ADD_SOURCE', source: createSource('B', 1) },
  })

  workspace = researchWorkspaceTestApi.workspaceReducer(workspace, {
    type: 'SWITCH_TASK',
    taskId: 'task-A',
  })
  assert.equal(workspace.activeTaskId, 'task-A')
  assert.deepEqual(workspace.tasksById['task-A'].poolItems.map((item) => item.sourceId), [
    'A-source-1',
    'A-source-2',
  ])
  assert.deepEqual(workspace.tasksById['task-B'].poolItems.map((item) => item.sourceId), [
    'B-source-1',
  ])

  storage.setItem(
    'ai-research-workspace-v4',
    JSON.stringify(researchWorkspaceTestApi.persistWorkspaceState(workspace)),
  )
  const restored = researchWorkspaceTestApi.initWorkspaceState()

  assert.equal(restored.activeTaskId, 'task-A')
  assert.equal(restored.tasksById['task-A'].researchPlan?.scope, '任务A研究范围')
  assert.equal(restored.tasksById['task-A'].outlineGenerated, true)
  assert.equal(restored.tasksById['task-B'].researchPlan?.scope, '任务B研究范围')
  assert.deepEqual(restored.tasksById['task-B'].poolItems.map((item) => item.sourceId), [
    'B-source-1',
  ])

  const switchedToB = researchWorkspaceTestApi.workspaceReducer(restored, {
    type: 'SWITCH_TASK',
    taskId: 'task-B',
  })
  assert.equal(switchedToB.activeTaskId, 'task-B')
  assert.equal(switchedToB.tasksById['task-B'].task.title, '任务B主题')
  assert.equal(switchedToB.tasksById['task-A'].task.title, '任务A主题')
})

test('Intent pending 与 confirmed 的公开状态在刷新恢复后保留', () => {
  const storage = new MemoryStorage()
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: storage },
  })
  let workspace = researchWorkspaceTestApi.initWorkspaceState()
  workspace = researchWorkspaceTestApi.workspaceReducer(workspace, {
    type: 'CREATE_TASK',
    action: {
      type: 'PREPARE_RESEARCH',
      taskId: 'task-intent-refresh',
      originalTopic: '环境设计的未来',
      standardizedTopic: '环境设计的未来',
      depth: 'deep',
      topicId: 'generic',
      usesPrototypeData: false,
    },
  })
  const pendingPlan: ResearchPlan = {
    ...createPlan('环境设计'),
    dataSource: 'real',
    usesPrototypeData: false,
    intentConfirmation: {
      status: 'pending',
      candidates: [
        { id: 'candidate-1', label: '专业与行业', description: '研究专业和行业', scope: ['环境设计专业'] },
        { id: 'candidate-2', label: '自然与生态', description: '研究自然和生态', scope: ['生态环境'] },
      ],
    },
  }
  workspace = researchWorkspaceTestApi.workspaceReducer(workspace, {
    type: 'UPDATE_TASK',
    taskId: 'task-intent-refresh',
    action: { type: 'USE_MOCK_PLAN', taskId: 'task-intent-refresh', researchPlan: pendingPlan },
  })
  const pendingRestored = researchWorkspaceTestApi.restorePersistedResearchState(
    researchWorkspaceTestApi.persistResearchState(workspace.tasksById['task-intent-refresh']),
  )
  assert.equal(pendingRestored?.researchPlan?.intentConfirmation?.status, 'pending')
  assert.equal(pendingRestored?.researchPlan?.intentConfirmation?.candidates?.length, 2)

  const confirmedPlan: ResearchPlan = {
    ...pendingPlan,
    intentConfirmation: {
      ...pendingPlan.intentConfirmation!,
      status: 'confirmed',
      confirmed: { source: 'candidate', label: '专业与行业' },
    },
  }
  const confirmedState = researchWorkspaceTestApi.researchReducer(
    workspace.tasksById['task-intent-refresh'],
    { type: 'USE_MOCK_PLAN', taskId: 'task-intent-refresh', researchPlan: confirmedPlan },
  )
  const confirmedRestored = researchWorkspaceTestApi.restorePersistedResearchState(
    researchWorkspaceTestApi.persistResearchState(confirmedState),
  )
  assert.equal(confirmedRestored?.researchPlan?.intentConfirmation?.status, 'confirmed')
  assert.equal(confirmedRestored?.researchPlan?.intentConfirmation?.confirmed?.label, '专业与行业')
})

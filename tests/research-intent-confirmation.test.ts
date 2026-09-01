import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { ResearchPlan } from '../src/types'
import { assertResearchExecutionAllowed } from '../server/services/researchExecutionGate'
import {
  confirmResearchIntent,
  rebuildQueryPlanForPlan,
} from '../server/services/researchIntentConfirmationService'
import { ResearchServiceError } from '../server/services/serviceError'
import {
  createFallbackResearchStrategy,
  invalidateResearchStrategyForPlanEdit,
  parseResearchStrategy,
  resolveResearchStrategy,
  toPublicIntentConfirmation,
} from '../server/services/researchStrategyService'
import { researchPlanSemanticFieldsChanged } from '../server/db/repositories/taskRepository'
import type { ResearchStrategy } from '../server/types/research'

const plan: ResearchPlan = {
  objective: '分析环境设计专业未来发展方向、就业前景、行业趋势和能力要求。',
  scope: '中国高校环境设计专业及室内、景观和空间设计行业',
  questions: [
    { id: 'q-1', text: '就业岗位如何变化？' },
    { id: 'q-2', text: 'AI 对设计师能力有什么影响？' },
    { id: 'q-3', text: '行业未来如何发展？' },
  ],
  sourcePreferences: ['行业研究', '专业媒体'],
  estimatedSourceCount: 12,
  estimatedDurationMinutes: 5,
  usesPrototypeData: false,
  dataSource: 'real',
  updatedAt: '2026-09-01T00:00:00.000Z',
  confirmedAt: '2026-09-01T00:01:00.000Z',
}

function pendingEnvironmentStrategy() {
  return createFallbackResearchStrategy({
    topic: '环境设计的未来',
    goal: plan.objective,
    scope: plan.scope,
  })
}

async function withMockedConfirmation<T>(
  content: Record<string, unknown>,
  callback: (requestBodies: Array<Record<string, unknown>>) => Promise<T>,
) {
  const originalFetch = globalThis.fetch
  const originalKey = process.env.QWEN_API_KEY
  const originalBase = process.env.QWEN_BASE_URL
  process.env.QWEN_API_KEY = 'test-key'
  process.env.QWEN_BASE_URL = 'https://qwen.test/v1'
  const requestBodies: Array<Record<string, unknown>> = []
  globalThis.fetch = async (_input, init) => {
    requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
    return new Response(JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  try {
    return await callback(requestBodies)
  } finally {
    globalThis.fetch = originalFetch
    if (originalKey === undefined) delete process.env.QWEN_API_KEY
    else process.env.QWEN_API_KEY = originalKey
    if (originalBase === undefined) delete process.env.QWEN_BASE_URL
    else process.env.QWEN_BASE_URL = originalBase
  }
}

const professionalFinal = {
  label: '环境设计专业与行业发展',
  researchIntent: {
    normalizedTopic: '中国环境设计专业与空间设计行业未来发展',
    researchObject: '环境设计专业及室内、景观与空间设计行业',
    userIntent: '分析就业前景、行业趋势、AI影响和未来能力要求',
    scope: ['环境设计专业', '室内设计', '景观设计', '空间设计', '就业', 'AI与数字化'],
    excludedMeanings: ['生态环境治理', '环境科学', '污染治理', '生态安全'],
    keyConcepts: ['环境设计专业', '空间设计', '就业', 'AI', '数字化'],
    ambiguityDetected: false,
  },
  queryPlan: { queries: [
    { query: '环境设计专业 就业前景 行业发展趋势', purpose: '就业与行业趋势', priority: 1 },
    { query: '室内设计 景观设计 空间设计 未来趋势', purpose: '专业方向', priority: 2 },
    { query: 'AI 数字化 空间设计岗位 能力要求', purpose: '技术与岗位能力', priority: 3 },
  ] },
}

function confirmedEnvironmentStrategy(): ResearchStrategy {
  const pending = pendingEnvironmentStrategy()
  const confirmedIntent = {
    source: 'candidate' as const,
    candidateId: 'candidate-1',
    label: '环境设计专业与行业发展',
    normalizedTopic: professionalFinal.researchIntent.normalizedTopic,
    researchObject: professionalFinal.researchIntent.researchObject,
    userIntent: professionalFinal.researchIntent.userIntent,
    scope: professionalFinal.researchIntent.scope,
    keyConcepts: professionalFinal.researchIntent.keyConcepts,
    excludedMeanings: professionalFinal.researchIntent.excludedMeanings,
  }
  return {
    version: 2,
    intent: { ...professionalFinal.researchIntent, ambiguityDetected: false },
    queryPlan: {
      queries: professionalFinal.queryPlan.queries.map((query, index) => ({
        id: `query-${index + 1}`,
        ...query,
      })),
    },
    intentConfirmation: {
      status: 'confirmed',
      candidates: pending.intentConfirmation.candidates,
      confirmedIntent,
    },
    queryPlanStatus: 'ready',
  }
}

test('环境设计真实歧义进入 pending 且没有可执行 QueryPlan', () => {
  const strategy = pendingEnvironmentStrategy()
  assert.equal(strategy.intent.ambiguityDetected, true)
  assert.equal(strategy.intentConfirmation.status, 'pending')
  assert.equal(strategy.intentConfirmation.candidates.length, 2)
  assert.equal(strategy.queryPlanStatus, 'pending_confirmation')
  assert.deepEqual(strategy.queryPlan.queries, [])
  const meanings = strategy.intentConfirmation.candidates
    .map((candidate) => `${candidate.label} ${candidate.researchObject}`)
    .join(' ')
  assert.match(meanings, /环境设计专业|空间设计行业/)
  assert.match(meanings, /自然环境|生态设计|环境治理/)
})

test('pending Strategy 被权威 Research Gate 阻止且不使用 fallback', () => {
  const strategy = pendingEnvironmentStrategy()
  assert.throws(
    () => assertResearchExecutionAllowed({
      taskId: 'task-pending',
      topic: '环境设计的未来',
      plan: {
        ...plan,
        _researchStrategyVersion: 2,
        _researchStrategy: strategy,
      },
      confirmedAt: plan.confirmedAt,
    }),
    (error) => error instanceof ResearchServiceError
      && error.code === 'RESEARCH_INTENT_CONFIRMATION_REQUIRED',
  )
})

test('v2 marker 缺失 Strategy 时 Gate 返回 INVALID_RESEARCH_INTENT 而不 fallback', () => {
  assert.throws(
    () => assertResearchExecutionAllowed({
      taskId: 'task-v2-missing', topic: '环境设计的未来',
      plan: { ...plan, _researchStrategyVersion: 2 }, confirmedAt: plan.confirmedAt,
    }),
    (error) => error instanceof ResearchServiceError
      && error.code === 'INVALID_RESEARCH_INTENT',
  )
})

test('未确认 Plan 被 Gate 阻止', () => {
  const strategy = createFallbackResearchStrategy({
    topic: '2026年中国新能源汽车市场竞争格局',
    goal: '分析市场竞争',
  })
  assert.throws(
    () => assertResearchExecutionAllowed({
      taskId: 'task-unconfirmed-plan',
      topic: '2026年中国新能源汽车市场竞争格局',
      plan: { ...plan, confirmedAt: null, _researchStrategyVersion: 2, _researchStrategy: strategy },
      confirmedAt: null,
    }),
    (error) => error instanceof ResearchServiceError
      && error.code === 'RESEARCH_PLAN_CONFIRMATION_REQUIRED',
  )
})

test('选择环境设计专业 Candidate 后 Flash 生成最终 Intent 与安全 QueryPlan', async () => {
  const pending = pendingEnvironmentStrategy()
  await withMockedConfirmation(professionalFinal, async () => {
    const confirmed = await confirmResearchIntent(
      '环境设计的未来',
      plan,
      pending,
      { source: 'candidate', candidateId: 'candidate-1' },
    )
    assert.equal(confirmed.intentConfirmation.status, 'confirmed')
    assert.equal(confirmed.intentConfirmation.confirmedIntent?.source, 'candidate')
    assert.equal(confirmed.intent.ambiguityDetected, false)
    assert.equal(confirmed.queryPlanStatus, 'ready')
    assert.ok(confirmed.queryPlan.queries.length >= 2)
    const queryText = confirmed.queryPlan.queries.map((query) => query.query).join(' ')
    assert.doesNotMatch(queryText, /生态安全|污染治理|环境科学/)
    const executable = assertResearchExecutionAllowed({
      taskId: 'task-confirmed',
      topic: '环境设计的未来',
      plan: { ...plan, _researchStrategyVersion: 2, _researchStrategy: confirmed },
      confirmedAt: plan.confirmedAt,
    })
    assert.equal(executable.intentConfirmation.status, 'confirmed')
  })
})

test('自定义方向经同一次 Flash 规范化并直接 confirmed', async () => {
  await withMockedConfirmation(professionalFinal, async (requestBodies) => {
    const confirmed = await confirmResearchIntent(
      '环境设计的未来',
      plan,
      pendingEnvironmentStrategy(),
      {
        source: 'custom',
        customDirection: '重点研究中国高校环境设计专业未来就业，以及 AI 对空间设计岗位的影响。',
      },
    )
    assert.equal(confirmed.intentConfirmation.status, 'confirmed')
    assert.equal(confirmed.intentConfirmation.confirmedIntent?.source, 'custom')
    assert.match(confirmed.intent.researchObject, /环境设计专业|空间设计行业/)
    assert.ok(confirmed.queryPlan.queries.some((query) => /AI|就业|岗位/.test(query.query)))
    assert.match(JSON.stringify(requestBodies[0]), /不得使用 site:/)
  })
})

test('确认阶段拒绝带站点限定的 QueryPlan 并保持可重试失败', async () => {
  await assert.rejects(
    () => withMockedConfirmation({
      ...professionalFinal,
      queryPlan: { queries: [
        { query: 'site:example.com 环境设计专业 就业', purpose: '就业', priority: 1 },
        { query: 'https://example.org 空间设计 AI', purpose: '技术', priority: 2 },
      ] },
    }, async () => confirmResearchIntent(
      '环境设计的未来',
      plan,
      pendingEnvironmentStrategy(),
      { source: 'custom', customDirection: '研究环境设计就业和 AI 影响' },
    )),
    (error) => error instanceof ResearchServiceError
      && error.code === 'INVALID_RESEARCH_INTENT',
  )
})

test('非歧义新能源汽车主题零额外步骤并可直接通过 Gate', () => {
  const strategy = createFallbackResearchStrategy({
    topic: '2026年中国新能源汽车市场竞争格局',
    goal: '分析企业、产品与市场份额竞争',
  })
  assert.equal(strategy.intentConfirmation.status, 'not_required')
  assert.deepEqual(strategy.intentConfirmation.candidates, [])
  assert.equal(strategy.queryPlanStatus, 'ready')
  assert.equal(assertResearchExecutionAllowed({
    taskId: 'task-ev',
    topic: '2026年中国新能源汽车市场竞争格局',
    plan: { ...plan, _researchStrategyVersion: 2, _researchStrategy: strategy },
    confirmedAt: plan.confirmedAt,
  }).intentConfirmation.status, 'not_required')
})

test('确认状态机只允许 pending -> confirmed', async () => {
  await assert.rejects(
    () => confirmResearchIntent(
      '环境设计的未来', plan, confirmedEnvironmentStrategy(),
      { source: 'candidate', candidateId: 'candidate-1' },
    ),
    (error) => error instanceof ResearchServiceError
      && error.statusCode === 409
      && error.code === 'INVALID_RESEARCH_INTENT',
  )
  const direct = createFallbackResearchStrategy({
    topic: '2026年中国新能源汽车市场竞争格局',
    goal: '分析企业、产品与市场份额竞争',
  })
  await assert.rejects(
    () => confirmResearchIntent(
      '2026年中国新能源汽车市场竞争格局', plan, direct,
      { source: 'custom', customDirection: '研究新能源汽车竞争' },
    ),
    (error) => error instanceof ResearchServiceError
      && error.statusCode === 409
      && error.code === 'INVALID_RESEARCH_INTENT',
  )
})

test('Plan 编辑保留确认元数据并使 QueryPlan 显式 stale，Gate 不会 fallback', () => {
  const strategy = confirmedEnvironmentStrategy()
  const invalidated = invalidateResearchStrategyForPlanEdit(strategy)
  assert.equal(invalidated.intentConfirmation.status, 'confirmed')
  assert.equal(invalidated.intentConfirmation.confirmedIntent?.candidateId, 'candidate-1')
  assert.equal(invalidated.intentConfirmation.candidates.length, 2)
  assert.equal(invalidated.queryPlanStatus, 'stale')
  assert.deepEqual(invalidated.queryPlan.queries, [])
  assert.throws(
    () => assertResearchExecutionAllowed({
      taskId: 'task-stale',
      topic: '环境设计的未来',
      plan: { ...plan, _researchStrategyVersion: 2, _researchStrategy: invalidated },
      confirmedAt: plan.confirmedAt,
    }),
    (error) => error instanceof ResearchServiceError && error.code === 'INVALID_RESEARCH_INTENT',
  )
})

test('Plan 再确认时只对 stale Strategy 调用 Flash 重建并保留 confirmedIntent', async () => {
  await withMockedConfirmation(professionalFinal, async (requestBodies) => {
    const confirmed = confirmedEnvironmentStrategy()
    const stale = invalidateResearchStrategyForPlanEdit(confirmed)
    const canonicalIntent = JSON.parse(JSON.stringify(stale.intent))
    const canonicalConfirmation = JSON.parse(JSON.stringify(stale.intentConfirmation))
    const rebuilt = await rebuildQueryPlanForPlan(
      '环境设计的未来',
      { ...plan, scope: '更新后的专业、就业与 AI 研究范围' },
      stale,
    )
    assert.equal(rebuilt.queryPlanStatus, 'ready')
    assert.equal(rebuilt.intentConfirmation.status, 'confirmed')
    assert.equal(rebuilt.intentConfirmation.confirmedIntent?.source, 'candidate')
    assert.equal(rebuilt.intentConfirmation.confirmedIntent?.candidateId, 'candidate-1')
    assert.deepEqual(rebuilt.intent, canonicalIntent)
    assert.deepEqual(rebuilt.intentConfirmation, canonicalConfirmation)
    assert.ok(rebuilt.queryPlan.queries.length >= 2)
    assert.equal(requestBodies.length, 1)
    const requestText = JSON.stringify(requestBodies[0])
    assert.match(requestText, /只生成 2 至 4 条/)
    assert.match(requestText, /不得输出新的 researchIntent/)
  })
})

test('not_required Plan rebuild 只更新 QueryPlan 并锁定 canonical Intent', async () => {
  const direct = createFallbackResearchStrategy({
    topic: '2026年中国新能源汽车市场竞争格局',
    goal: '分析企业、产品与市场份额竞争',
  })
  const stale = invalidateResearchStrategyForPlanEdit(direct)
  const canonicalIntent = JSON.parse(JSON.stringify(stale.intent))
  const canonicalConfirmation = JSON.parse(JSON.stringify(stale.intentConfirmation))
  await withMockedConfirmation(professionalFinal, async (requestBodies) => {
    const rebuilt = await rebuildQueryPlanForPlan(
      '2026年中国新能源汽车市场竞争格局',
      { ...plan, objective: '更新竞争格局研究重点' },
      stale,
    )
    assert.equal(rebuilt.queryPlanStatus, 'ready')
    assert.deepEqual(rebuilt.intent, canonicalIntent)
    assert.deepEqual(rebuilt.intentConfirmation, canonicalConfirmation)
    assert.equal(requestBodies.length, 1)
  })
})

test('v2 Strategy 执行期不被 Research request goal 改写 canonical Intent', () => {
  const strategy = confirmedEnvironmentStrategy()
  const resolved = resolveResearchStrategy({
    taskId: 'task-confirmed',
    requestId: 'request-confirmed',
    topic: '环境设计的未来',
    goal: '这是一个不得覆盖 canonical Intent 的新 goal',
    sourcePreferences: ['行业研究'],
    targetSourceCount: 12,
    researchStrategy: strategy,
  })
  assert.deepEqual(resolved.intent, strategy.intent)
  assert.deepEqual(
    resolved.intentConfirmation.confirmedIntent,
    strategy.intentConfirmation.confirmedIntent,
  )
})

test('pending/confirmed Strategy 经 JSONB 往返后保留 Candidates 与选择', async () => {
  const pendingReloaded = parseResearchStrategy(JSON.parse(JSON.stringify(pendingEnvironmentStrategy())))
  assert.equal(pendingReloaded?.intentConfirmation.status, 'pending')
  assert.equal(pendingReloaded?.intentConfirmation.candidates.length, 2)
  await withMockedConfirmation(professionalFinal, async () => {
    const confirmed = await confirmResearchIntent(
      '环境设计的未来', plan, pendingEnvironmentStrategy(),
      { source: 'candidate', candidateId: 'candidate-1' },
    )
    const reloaded = parseResearchStrategy(JSON.parse(JSON.stringify(confirmed)))
    assert.equal(reloaded?.intentConfirmation.status, 'confirmed')
    assert.equal(reloaded?.intentConfirmation.confirmedIntent?.label, '环境设计专业与行业发展')
    assert.equal(reloaded?.intent.ambiguityDetected, false)
    const publicDto = toPublicIntentConfirmation(reloaded!)
    assert.equal(publicDto.confirmed?.label, '环境设计专业与行业发展')
    assert.ok(publicDto.candidates?.every((candidate) => !('keyConcepts' in candidate)))
  })
})

test('parser 拒绝 ambiguityDetected=true 的 confirmed v2 Strategy', () => {
  const invalid = confirmedEnvironmentStrategy()
  invalid.intent = { ...invalid.intent, ambiguityDetected: true }
  assert.equal(parseResearchStrategy(JSON.parse(JSON.stringify(invalid))), null)
})

test('legacy Strategy 仍可通过兼容 Gate 执行', () => {
  const legacy = {
    intent: {
      normalizedTopic: '旧任务主题', researchObject: '旧任务对象', userIntent: '旧任务目标',
      scope: ['旧任务'], excludedMeanings: [], keyConcepts: ['旧任务'], ambiguityDetected: false,
    },
    queryPlan: { queries: [
      { query: '旧任务 行业趋势', purpose: '趋势', priority: 1 },
      { query: '旧任务 市场格局', purpose: '市场', priority: 2 },
      { query: '旧任务 风险挑战', purpose: '风险', priority: 3 },
    ] },
  }
  const executable = assertResearchExecutionAllowed({
    taskId: 'legacy-task', topic: '旧任务主题',
    plan: { ...plan, _researchStrategy: legacy }, confirmedAt: plan.confirmedAt,
  })
  assert.equal(executable.version, 1)
  assert.equal(executable.queryPlanStatus, 'ready')
})

test('Plan semantic fields 与检索配置使用不同的 invalidation 语义', () => {
  assert.equal(researchPlanSemanticFieldsChanged(plan, {
    ...plan, estimatedSourceCount: 30,
  }), false)
  assert.equal(researchPlanSemanticFieldsChanged(plan, {
    ...plan, objective: '新目标',
  }), true)
  assert.equal(researchPlanSemanticFieldsChanged(plan, {
    ...plan, scope: '新范围',
  }), true)
  assert.equal(researchPlanSemanticFieldsChanged(plan, {
    ...plan, questions: [{ id: 'different-id', text: '新问题' }],
  }), true)
  assert.equal(researchPlanSemanticFieldsChanged(plan, {
    ...plan, sourcePreferences: ['权威报告'],
  }), true)
  assert.equal(researchPlanSemanticFieldsChanged(plan, {
    ...plan, questions: plan.questions.map((question) => ({ ...question, id: `new-${question.id}` })),
    sourcePreferences: [...plan.sourcePreferences].reverse(),
  }), false)
})

test('Job 与 legacy route 都复用同一个权威 Gate 入口', () => {
  const jobRepository = readFileSync(
    new URL('../server/db/repositories/researchJobRepository.ts', import.meta.url),
    'utf8',
  )
  const legacyRoute = readFileSync(
    new URL('../server/routes/research.ts', import.meta.url),
    'utf8',
  )
  const gateIndex = jobRepository.indexOf('assertOwnedResearchExecutionAllowedWithClient(')
  const reuseIndex = jobRepository.indexOf('const existing = await client.query<ResearchJobRow>')
  assert.ok(gateIndex >= 0)
  assert.ok(reuseIndex > gateIndex)
  assert.match(legacyRoute, /startOwnedResearchStageWithGate/)
  assert.doesNotMatch(legacyRoute, /startOwnedStage\(/)
})

test('Plan 页面只公开 Candidate 标题、描述、scope 与确认交互', () => {
  const page = readFileSync(
    new URL('../src/pages/ResearchPlanPage.tsx', import.meta.url),
    'utf8',
  )
  assert.match(page, /确认研究方向/)
  assert.match(page, /这个主题可能存在多种理解/)
  assert.match(page, /选择这个方向/)
  assert.match(page, /都不是？自定义研究方向/)
  assert.match(page, /正在根据你的选择制定检索策略/)
  assert.match(page, /plan\.intentConfirmation\?\.status === 'pending'/)
  assert.doesNotMatch(page, /candidate\.excludedMeanings|candidate\.keyConcepts|candidate\.queryPlan/)
  assert.doesNotMatch(page, /修改研究方向|showDirectionEditor|canModifyDirection/)
})

test('Plan autosave 不调用 Qwen，只有最终确认 stale Plan 才 rebuild 一次', () => {
  const context = readFileSync(
    new URL('../src/context/ResearchContext.tsx', import.meta.url),
    'utf8',
  )
  const route = readFileSync(
    new URL('../server/routes/tasks.ts', import.meta.url),
    'utf8',
  )
  assert.match(context, /requestSavePlan\([\s\S]*?nextState\.researchPlan![\s\S]*?true,/)
  assert.match(route, /if \(!body\.invalidateDownstream && body\.plan\.confirmedAt\)/)
  assert.match(route, /await rebuildQueryPlanForPlan\(/)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyResearchStrategyGuardrails,
  createFallbackResearchStrategy,
  parseResearchStrategy,
} from '../server/services/researchStrategyService'

test('环境设计主题消歧到专业与空间设计行业', () => {
  const strategy = createFallbackResearchStrategy({
    topic: '环境设计的未来',
    goal: '分析环境设计专业未来发展方向、就业前景、行业趋势和能力要求。',
  })
  assert.match(strategy.intent.normalizedTopic, /环境设计专业|空间设计行业/)
  assert.equal(strategy.intent.ambiguityDetected, true)
  assert.ok(strategy.intent.excludedMeanings.some((item) => /生态环境/.test(item)))
  assert.ok(strategy.intent.excludedMeanings.some((item) => /环境科学/.test(item)))
  assert.ok(strategy.intent.excludedMeanings.some((item) => /环境治理/.test(item)))
  const queries = strategy.queryPlan.queries.map((item) => item.query).join(' ')
  assert.match(queries, /就业|行业发展趋势/)
  assert.match(queries, /室内设计.*景观设计.*空间设计/)
  assert.match(queries, /AI.*数字化/)
  assert.doesNotMatch(queries, /生态安全|污染治理|环境科学/)
})

test('topicHints 会纠正模型把环境设计误判为非歧义的结果', () => {
  const incorrect = createFallbackResearchStrategy({
    topic: '一般设计趋势',
    goal: '分析设计技术',
  })
  const guarded = applyResearchStrategyGuardrails(incorrect, {
    topic: '环境设计的未来',
    goal: '分析环境设计专业就业、行业趋势和能力要求',
  })
  assert.equal(guarded.intent.ambiguityDetected, true)
  assert.match(guarded.intent.normalizedTopic, /环境设计专业/)
  assert.ok(guarded.queryPlan.queries.some((query) => /就业/.test(query.query)))
  assert.ok(guarded.intent.excludedMeanings.some((meaning) => /生态环境/.test(meaning)))
})

test('苹果结合产品生态与 AI goal 时识别为 Apple 公司', () => {
  const strategy = createFallbackResearchStrategy({
    topic: '苹果的发展',
    goal: '分析其产品生态和 AI 战略',
  })
  assert.match(strategy.intent.researchObject, /Apple公司/)
  assert.ok(strategy.intent.excludedMeanings.some((item) => /水果苹果/.test(item)))
  assert.ok(strategy.queryPlan.queries.every((item) => !/种植|营养/.test(item.query)))
})

test('Python 结合开发者生态 goal 时识别为编程语言', () => {
  const strategy = createFallbackResearchStrategy({
    topic: 'Python 的未来',
    goal: '分析开发者生态和 AI 编程趋势',
  })
  assert.match(strategy.intent.researchObject, /编程语言/)
  assert.ok(strategy.intent.excludedMeanings.some((item) => /蟒蛇/.test(item)))
  assert.ok(strategy.queryPlan.queries.every((item) => !/蛇类|动物/.test(item.query)))
})

test('非歧义主题不生成复杂 excluded meanings', () => {
  const strategy = createFallbackResearchStrategy({
    topic: '中国新能源汽车市场竞争格局',
    goal: '分析市场份额、产品与企业竞争',
  })
  assert.equal(strategy.intent.ambiguityDetected, false)
  assert.deepEqual(strategy.intent.excludedMeanings, [])
  assert.ok(strategy.queryPlan.queries.length >= 2)
  assert.ok(strategy.queryPlan.queries.length <= 4)
})

test('建筑行业研究保持产业语义而非建筑物历史', () => {
  const strategy = createFallbackResearchStrategy({
    topic: '建筑行业未来',
    goal: '分析产业趋势、技术变化和市场机会',
  })
  assert.match(strategy.intent.researchObject, /建筑行业.*产业链|产业链.*建筑行业/)
  assert.ok(strategy.queryPlan.queries.every((item) => !/建筑物历史/.test(item.query)))
})

test('QueryPlan 只接受 2 至 4 条去重且有 purpose 的查询', () => {
  const parsed = parseResearchStrategy({
    researchIntent: {
      normalizedTopic: '测试主题',
      researchObject: '测试对象',
      userIntent: '测试意图',
      scope: ['范围'],
      excludedMeanings: [],
      keyConcepts: ['测试概念'],
      ambiguityDetected: false,
    },
    queryPlan: {
      queries: [
        { query: '角度一', purpose: '市场', priority: 1 },
        { query: '角度二', purpose: '产品', priority: 2 },
        { query: '角度三', purpose: '用户', priority: 3 },
        { query: '角度四', purpose: '商业模式', priority: 4 },
        { query: '角度五', purpose: '额外角度', priority: 5 },
      ],
    },
  })
  assert.ok(parsed)
  assert.equal(parsed.queryPlan.queries.length, 4)
  assert.equal(new Set(parsed.queryPlan.queries.map((item) => item.purpose)).size, 4)
})

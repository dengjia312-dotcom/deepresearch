import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { generateContent } from '../server/services/generation/generationService'
import {
  getQwenTimeoutMs,
  requestQwenGeneration,
} from '../server/services/generation/qwenGenerationProvider'
import { generateOutline } from '../server/services/outlineGenerationService'
import { generatePlan } from '../server/services/planGenerationService'
import { generateReport } from '../server/services/reportGenerationService'
import { synthesizeResearchResponse } from '../server/services/researchSynthesisService'
import { ResearchServiceError } from '../server/services/serviceError'
import type {
  OutlineRequest,
  ReportRequest,
  ResearchRequest,
  ResearchSynthesisEvidence,
  VerifiedSearchMetadata,
} from '../server/types/research'

interface MockedQwenOptions {
  response?: unknown
  status?: number
  fetchImpl?: typeof fetch
}

async function withMockedQwen<T>(
  options: MockedQwenOptions,
  callback: (bodies: Record<string, unknown>[]) => Promise<T>,
) {
  const originalFetch = globalThis.fetch
  const originalInfo = console.info
  const originalError = console.error
  const environment = {
    QWEN_API_KEY: process.env.QWEN_API_KEY,
    QWEN_BASE_URL: process.env.QWEN_BASE_URL,
    QWEN_FAST_MODEL: process.env.QWEN_FAST_MODEL,
    QWEN_STRONG_MODEL: process.env.QWEN_STRONG_MODEL,
    QWEN_FAST_TIMEOUT_MS: process.env.QWEN_FAST_TIMEOUT_MS,
    QWEN_STRONG_TIMEOUT_MS: process.env.QWEN_STRONG_TIMEOUT_MS,
  }
  const bodies: Record<string, unknown>[] = []
  process.env.QWEN_API_KEY = 'test-qwen-key'
  process.env.QWEN_BASE_URL = 'https://qwen.test/v1'
  process.env.QWEN_FAST_MODEL = 'qwen-test-fast'
  process.env.QWEN_STRONG_MODEL = 'qwen-test-strong'
  console.info = () => undefined
  console.error = () => undefined
  globalThis.fetch = options.fetchImpl ?? (async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
    return new Response(JSON.stringify(options.response ?? {
      choices: [{ finish_reason: 'stop', message: { content: '{}' } }],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    }), {
      status: options.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })

  try {
    return await callback(bodies)
  } finally {
    globalThis.fetch = originalFetch
    console.info = originalInfo
    console.error = originalError
    Object.entries(environment).forEach(([name, value]) => {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    })
  }
}

function completion(content: unknown) {
  return {
    choices: [{ finish_reason: 'stop', message: { content } }],
    usage: { prompt_tokens: 10, completion_tokens: 20 },
  }
}

const researchRequest: ResearchRequest = {
  taskId: 'task-a',
  requestId: 'request-a',
  topic: '具身智能产业发展',
  goal: '梳理发展方向与产业落地',
  sourcePreferences: ['行业研究'],
  targetSourceCount: 8,
}

test('Plan/Outline 使用 FAST，Synthesis/Report 使用 STRONG 且关闭推理', async () => {
  await withMockedQwen({}, async (bodies) => {
    for (const task of ['plan', 'outline', 'synthesis', 'report'] as const) {
      await generateContent(task, {
        messages: [{ role: 'user', content: 'test' }],
        maxCompletionTokens: 100,
      })
    }
    assert.deepEqual(bodies.map((body) => body.model), [
      'qwen-test-fast',
      'qwen-test-fast',
      'qwen-test-strong',
      'qwen-test-strong',
    ])
    assert.ok(bodies.every((body) => body.reasoning_effort === 'none'))
    assert.ok(bodies.every((body) => body.tools === undefined))
    assert.ok(bodies.every((body) => body.tool_choice === undefined))
  })
})

test('Plan 严格 JSON 可以按原 schema 解析', async () => {
  await withMockedQwen({
    response: completion(JSON.stringify({
      objective: '明确产业链与关键能力',
      scope: '中国市场，聚焦制造、物流与服务机器人',
      questions: ['技术如何演进？', '产业如何落地？', '主要限制是什么？'],
      sourcePreferences: ['权威报告', '行业研究'],
    })),
  }, async () => {
    const result = await generatePlan({
      taskId: 'task-a',
      requestId: 'request-plan',
      topic: '具身智能产业发展',
      depth: 'deep',
    })
    assert.equal(result.plan.questions.length, 3)
    assert.equal(result.mode, 'live')
    assert.equal(result.dataSource, 'real')
  })
})

test('Outline schema 与来源绑定保持不变', async () => {
  const request: OutlineRequest = {
    taskId: 'task-a',
    requestId: 'request-outline',
    topic: researchRequest.topic,
    goal: researchRequest.goal,
    sources: [1, 2].map((index) => ({
      id: `source-${index}`,
      title: `来源 ${index}`,
      url: `https://source-${index}.example.com/article`,
      publisher: `机构 ${index}`,
      summary: `摘要 ${index}`,
      keyInsight: `洞察 ${index}`,
      credibility: '可信' as const,
      origin: 'real' as const,
    })),
  }
  await withMockedQwen({
    response: completion(JSON.stringify({
      outline: {
        title: '具身智能产业研究',
        sections: [
          { title: '技术演进', description: '分析一体化能力', sourceIds: ['source-1'] },
          { title: '产业落地', description: '分析主要场景', sourceIds: ['source-1', 'source-2'] },
        ],
      },
      warnings: [],
    })),
  }, async () => {
    const result = await generateOutline(request)
    assert.deepEqual(result.outline.sections.map((section) => section.id), ['section-1', 'section-2'])
    assert.deepEqual(result.outline.sections.map((section) => section.evidenceStatus), ['limited', 'sufficient'])
  })
})

test('Synthesis 生成来源池外 URL 时不能建立来源或引用', async () => {
  const metadata: VerifiedSearchMetadata = {
    url: 'https://verified.example.com/article',
    title: '已验证来源',
    publisher: '研究机构',
    publishedAt: '2026-08-31',
    snippet: '检索摘要',
  }
  const evidence: ResearchSynthesisEvidence = {
    ...metadata,
    sourceId: 'source-1',
    evidenceType: 'full_text',
    content: '已验证正文证据',
  }
  await withMockedQwen({
    response: completion(JSON.stringify({
      summary: '研究摘要',
      insights: [{
        title: '洞察',
        content: '洞察正文',
        sourceUrls: ['https://outside.example.com/fabricated'],
      }],
      warnings: [],
    })),
  }, async (bodies) => {
    const result = await synthesizeResearchResponse(
      researchRequest,
      [metadata],
      [evidence],
      { actualSourceCount: 1, deduplicatedSourceCount: 1 },
    )
    assert.deepEqual(result.sources.map((source) => source.url), [metadata.url])
    assert.deepEqual(result.insights[0]?.sourceIds, [])
    assert.doesNotMatch(JSON.stringify(result.sources), /outside\.example/)
    assert.equal(bodies[0]?.tools, undefined)
  })
})

function reportRequest(): ReportRequest {
  const sources = [1, 2].map((index) => ({
    id: `source-${index}`,
    title: `来源 ${index}`,
    url: `https://source-${index}.example.com/article`,
    publisher: `机构 ${index}`,
    summary: `摘要 ${index}`,
    keyInsight: `洞察 ${index}`,
    credibility: '可信' as const,
    origin: 'real' as const,
  }))
  return {
    taskId: 'task-a',
    requestId: 'request-report',
    topic: researchRequest.topic,
    goal: researchRequest.goal,
    outline: {
      title: '具身智能产业研究',
      sections: [
        { id: 'section-1', title: '技术演进', description: '分析能力演进', sourceIds: ['source-1'] },
        { id: 'section-2', title: '产业落地', description: '分析应用场景', sourceIds: ['source-2'] },
      ],
    },
    sources,
    reportDepth: 'brief',
    targetMinWords: 800,
    targetMaxWords: 1200,
  }
}

test('Report 保持原 schema 且只接受章节绑定来源', async () => {
  await withMockedQwen({
    response: completion(JSON.stringify({
      report: {
        title: '具身智能产业研究',
        executiveSummary: '执行摘要'.repeat(10),
        sections: [
          {
            id: 'section-1',
            paragraphs: [{
              content: '甲'.repeat(350),
              sourceIds: ['source-1'],
              claimType: 'source_supported',
            }],
          },
          {
            id: 'section-2',
            paragraphs: [{
              content: '乙'.repeat(350),
              sourceIds: ['source-2'],
              claimType: 'source_supported',
            }],
          },
        ],
        conclusion: '研究总结'.repeat(10),
        limitations: ['证据范围有限'],
      },
      warnings: [],
    })),
  }, async () => {
    const result = await generateReport(reportRequest())
    assert.equal(result.report.sections.length, 2)
    assert.equal(result.reportDepth, 'brief')
    assert.equal(result.dataSource, 'real')
  })
})

test('Report 引用资料池外 sourceId 会被拒绝', async () => {
  await withMockedQwen({
    response: completion(JSON.stringify({
      report: {
        title: '具身智能产业研究',
        executiveSummary: '摘要',
        sections: [
          {
            id: 'section-1',
            paragraphs: [{
              content: '正文',
              sourceIds: ['source-outside'],
              claimType: 'source_supported',
            }],
          },
          {
            id: 'section-2',
            paragraphs: [{
              content: '正文二',
              sourceIds: ['source-2'],
              claimType: 'source_supported',
            }],
          },
        ],
        conclusion: '总结',
        limitations: ['限制'],
      },
      warnings: [],
    })),
  }, async () => {
    await assert.rejects(
      generateReport(reportRequest()),
      (error: unknown) => error instanceof ResearchServiceError
        && error.code === 'AI_GENERATION_RESPONSE_INVALID',
    )
  })
})

test('Flash/Max timeout 使用 60 秒和 120 秒安全默认值', async () => {
  await withMockedQwen({}, async () => {
    delete process.env.QWEN_FAST_TIMEOUT_MS
    delete process.env.QWEN_STRONG_TIMEOUT_MS
    assert.equal(getQwenTimeoutMs('fast'), 60_000)
    assert.equal(getQwenTimeoutMs('strong'), 120_000)
  })
})

test('Qwen timeout 映射为 AI_GENERATION_TIMEOUT', async () => {
  await withMockedQwen({
    fetchImpl: async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    }),
  }, async () => {
    process.env.QWEN_FAST_TIMEOUT_MS = '10'
    await assert.rejects(
      requestQwenGeneration({
        task: 'plan',
        modelClass: 'fast',
        messages: [{ role: 'user', content: 'test' }],
        maxCompletionTokens: 10,
      }),
      (error: unknown) => error instanceof ResearchServiceError
        && error.code === 'AI_GENERATION_TIMEOUT'
        && error.diagnosticCode === 'QWEN_TIMEOUT',
    )
  })
})

test('Qwen 429 与 5xx 使用可诊断的产品级错误映射', async () => {
  await withMockedQwen({ status: 429, response: { error: { code: 'rate_limited' } } }, async () => {
    await assert.rejects(
      generateContent('plan', {
        messages: [{ role: 'user', content: 'test' }],
        maxCompletionTokens: 10,
      }),
      (error: unknown) => error instanceof ResearchServiceError
        && error.code === 'AI_GENERATION_RATE_LIMITED'
        && error.diagnosticCode === 'QWEN_RATE_LIMITED',
    )
  })
  await withMockedQwen({ status: 503, response: { error: { code: 'unavailable' } } }, async () => {
    await assert.rejects(
      generateContent('report', {
        messages: [{ role: 'user', content: 'test' }],
        maxCompletionTokens: 10,
      }),
      (error: unknown) => error instanceof ResearchServiceError
        && error.code === 'AI_GENERATION_FAILED'
        && error.diagnosticCode === 'QWEN_UPSTREAM_5XX',
    )
  })
})

test('本地限流与 Qwen upstream 429 保留不同诊断标识', () => {
  const middleware = readFileSync('server/middleware/apiProtection.ts', 'utf8')
  const provider = readFileSync(
    'server/services/generation/qwenGenerationProvider.ts',
    'utf8',
  )
  assert.match(middleware, /LOCAL_RATE_LIMITED/)
  assert.match(provider, /QWEN_RATE_LIMITED/)
})

test('正式生成链路不引用 MiMo 且不存在自动 fallback', () => {
  const formalFiles = [
    'server/routes/plan.ts',
    'server/routes/outline.ts',
    'server/routes/report.ts',
    'server/services/researchService.ts',
    'server/services/planGenerationService.ts',
    'server/services/outlineGenerationService.ts',
    'server/services/reportGenerationService.ts',
    'server/services/researchSynthesisService.ts',
  ]
  const source = formalFiles.map((file) => readFileSync(file, 'utf8')).join('\n')
  assert.doesNotMatch(source, /mimo|requestMimo|WithMimo/i)
  assert.doesNotMatch(source, /fallback.*mimo|USE_MOCK/i)
})

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import type { TaskDetailDto } from '../server/db/types'
import { generateDocxReport } from '../server/reporting/docxReport'
import { generatePdfReport } from '../server/reporting/pdfReport'
import {
  buildReportDocument,
  ReportNotReadyError,
  sanitizeReportFilename,
} from '../server/reporting/reportDocument'
import type { Source } from '../src/types'

const generatedAt = '2026-08-30T13:45:00.000Z'

function source(id: string, overrides: Partial<Source> = {}): Source {
  return {
    id,
    rank: 1,
    title: `中文来源 ${id}`,
    type: 'web',
    publisher: '权威发布方',
    url: `https://example.com/research/${id}/${'long-path-'.repeat(18)}`,
    publishDate: '2026-08-28',
    freshness: '最新',
    credibility: 'high',
    tags: ['产品研究'],
    summary: '用于验证正式报告引用映射的来源摘要。',
    keyInsight: '关键观点',
    addedToPool: true,
    excerpt: [],
    insights: [],
    origin: 'real',
    ...overrides,
  }
}

function detail(options: { noReport?: boolean; sources?: Source[] } = {}): TaskDetailDto {
  const sources = options.sources ?? [source('source-a'), source('source-b'), source('unused')]
  return {
    state: {
      task: {
        id: 'task-report-export-test',
        title: 'C端产品经理基础',
        query: 'C端产品经理基础',
        topicId: 'generic',
        usesPrototypeData: false,
        dataSource: 'real',
        depth: 'professional',
        searchDepth: 'deep',
        targetSourceCount: 12,
        reportDepth: 'deep',
        reportTargetMinWords: 2000,
        reportTargetMaxWords: 4000,
        status: 'reported',
        createdAt: '2026-08-30T12:00:00.000Z',
      },
      researchPlan: {
        objective: '构建适用于中国互联网环境的C端产品经理基础能力框架。',
      },
      liveOutline: {
        outline: {
          sections: [{
            id: 'section-1', title: '核心能力', sourceIds: [], description: '',
            children: [{
              id: 'section-2', title: '用户研究', sourceIds: [], description: '',
              children: [{ id: 'section-3', title: '研究方法', sourceIds: [], description: '', children: [] }],
            }],
          }],
        },
      },
      liveReport: options.noReport ? null : {
        mode: 'live',
        dataSource: 'real',
        report: {
          title: 'C端产品经理基础：核心能力、工作流程与决策框架',
          executiveSummary: '本报告系统梳理C端产品经理的能力结构与决策方法。',
          sections: [
            {
              id: 'section-1', title: '核心能力模型',
              paragraphs: [{
                id: 'paragraph-1', content: '产品经理需要连接用户需求、商业目标与交付约束。',
                sourceIds: ['source-b', 'source-a'], claimType: 'source_supported',
              }],
            },
            {
              id: 'section-2', title: '用户研究与产品决策',
              paragraphs: [{
                id: 'paragraph-2', content: '研究证据应进入清晰、可复核的决策过程。',
                sourceIds: ['source-a'], claimType: 'source_supported',
              }],
            },
            {
              id: 'section-3', title: '研究方法与证据边界',
              paragraphs: [{
                id: 'paragraph-3', content: '研究方法需要与问题类型和证据边界匹配。',
                sourceIds: ['source-a'], claimType: 'source_supported',
              }],
            },
          ],
          conclusion: '稳定的研究、决策和复盘闭环是核心能力落地的关键。',
          limitations: [],
        },
        warnings: [],
        reportDepth: 'deep',
        targetMinWords: 2000,
        targetMaxWords: 4000,
        actualWordCount: 2268,
        generatedAt,
      },
      poolItems: sources.map((item) => ({
        sourceId: item.id,
        sourceSnapshot: item,
        reviewStatus: 'trusted',
        note: '',
        addedAt: generatedAt,
        dataSource: 'real',
      })),
    },
    citations: [],
  } as TaskDetailDto
}

test('ReportDocument 映射真实元信息、章节层级和稳定引用编号', () => {
  const report = buildReportDocument(detail())
  assert.equal(report.title, 'C端产品经理基础：核心能力、工作流程与决策框架')
  assert.equal(report.researchGoal, '构建适用于中国互联网环境的C端产品经理基础能力框架。')
  assert.equal(report.generatedAt, generatedAt)
  assert.equal(report.wordCount, 2268)
  assert.equal(report.sourceCount, 2)
  assert.deepEqual(report.sections.map((section) => [section.title, section.level]), [
    ['核心能力模型', 1],
    ['用户研究与产品决策', 2],
    ['研究方法与证据边界', 3],
  ])
  assert.deepEqual(report.sections[0].paragraphs[0].citationIndexes, [1, 2])
  assert.deepEqual(report.sections[1].paragraphs[0].citationIndexes, [2])
  assert.deepEqual(report.sections[2].paragraphs[0].citationIndexes, [2])
  assert.deepEqual(report.references.map((reference) => [reference.index, reference.title]), [
    [1, '中文来源 source-b'],
    [2, '中文来源 source-a'],
  ])
  assert.equal(report.references.some((reference) => reference.title.includes('unused')), false)
})

test('无有效引用仍可构建文档并记录缺失来源 warning', () => {
  const input = detail({ sources: [] })
  const report = buildReportDocument(input)
  assert.equal(report.sourceCount, 0)
  assert.equal(report.references.length, 0)
  assert.deepEqual(report.sections[0].paragraphs[0].citationIndexes, [])
  assert.match(report.warnings.at(-1) ?? '', /跳过了 2 个/)
  assert.equal(report.limitations.length, 1)
})

test('报告未生成时拒绝构建导出文档', () => {
  assert.throws(() => buildReportDocument(detail({ noReport: true })), ReportNotReadyError)
})

test('PDF/DOCX 文件名清理非法字符并保留中文', () => {
  assert.equal(
    sanitizeReportFilename('C端产品经理：核心/能力*框架? ', generatedAt, 'pdf'),
    'C端产品经理_核心_能力_框架__2026-08-30.pdf',
  )
  assert.equal(
    sanitizeReportFilename('C端产品经理：核心/能力*框架? ', generatedAt, 'docx'),
    'C端产品经理_核心_能力_框架__2026-08-30.docx',
  )
  assert.equal(
    sanitizeReportFilename('跨日报告', '2026-08-30T18:00:00.000Z', 'pdf'),
    '跨日报告_2026-08-31.pdf',
  )
})

test('中文、多页内容和长 URL 可生成非空 PDF', async () => {
  const report = buildReportDocument(detail())
  report.sections[0].paragraphs[0].content = '中文正文用于验证自动分页与段落跨页。'.repeat(120)
  const buffer = await generatePdfReport(report)
  assert.equal(buffer.subarray(0, 5).toString('ascii'), '%PDF-')
  assert.equal(buffer.length > 10_000, true)
  assert.equal((buffer.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length > 2, true)
})

test('中文、Heading、引用和超链接可生成真实 DOCX', async () => {
  const report = buildReportDocument(detail())
  const buffer = await generateDocxReport(report)
  assert.equal(buffer.subarray(0, 2).toString('ascii'), 'PK')
  assert.equal(buffer.length > 5_000, true)
})

test('报告导出层不依赖任何 AI、Search 或 Reader 服务', async () => {
  const files = await Promise.all([
    'server/reporting/reportDocument.ts',
    'server/reporting/pdfReport.ts',
    'server/reporting/docxReport.ts',
    'server/reporting/reportExportService.ts',
  ].map((file) => readFile(file, 'utf8')))
  const imports = files.join('\n')
  assert.doesNotMatch(imports, /mimoResearch|glmResearch|Reader|requestMimo|researchWithMimo/i)
})

test('Report 页面使用服务端 PDF/Word 导出且不再调用 window.print', async () => {
  const page = await readFile('src/pages/ReportPage.tsx', 'utf8')
  assert.match(page, /requestReportExport\(state\.task\.id, format\)/)
  assert.match(page, /导出 PDF/)
  assert.match(page, /导出 Word/)
  assert.doesNotMatch(page, /window\.print\(/)
})

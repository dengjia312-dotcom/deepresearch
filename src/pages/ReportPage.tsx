import {
  ArrowRight,
  BookOpenCheck,
  Download,
  FileText,
  Share2,
  Sparkles,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CitationPanel } from '../components/CitationPanel'
import { PrototypeDataNotice } from '../components/PrototypeDataNotice'
import { StatusBadge } from '../components/StatusBadge'
import {
  getTaskRoute,
  getTaskSourceRoute,
  useResearch,
} from '../context/ResearchContext'
import {
  requestReportExport,
  type ReportExportFormat,
} from '../services/researchApi'

const reportDepthLabels = {
  brief: '简要报告',
  standard: '标准报告',
  deep: '深度报告',
} as const

export function ReportPage() {
  const navigate = useNavigate()
  const {
    state,
    currentTopic,
    reportSections,
    getSource,
    generateReport,
    useMockReport,
    setNotice,
  } = useResearch()

  const citedSources = useMemo(() => {
    const ids: string[] = []
    if (state.reportMode === 'real' && state.liveReport) {
      state.liveReport.report.sections.forEach((section) => {
        section.paragraphs.forEach((paragraph) => {
          paragraph.sourceIds.forEach((sourceId) => {
            if (!ids.includes(sourceId)) ids.push(sourceId)
          })
        })
      })
    } else {
      reportSections.forEach((section) => {
        section.paragraphs.forEach((paragraph) => {
          paragraph.segments.forEach((segment) => {
            if (segment.type === 'citation' && !ids.includes(segment.sourceId)) ids.push(segment.sourceId)
          })
        })
      })
    }
    return ids.flatMap((id) => (getSource(id) ? [getSource(id)!] : []))
  }, [getSource, reportSections, state.liveReport, state.reportMode])

  const [activeSourceId, setActiveSourceId] = useState<string | null>(
    citedSources[0]?.id ?? null,
  )
  const [exportingFormat, setExportingFormat] = useState<ReportExportFormat | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)

  useEffect(() => {
    if (citedSources.length === 0) {
      if (activeSourceId) setActiveSourceId(null)
      return
    }
    if (!activeSourceId || !citedSources.some((source) => source.id === activeSourceId)) {
      setActiveSourceId(citedSources[0].id)
    }
  }, [activeSourceId, citedSources])

  const citationNumberBySource = useMemo(
    () => new Map(citedSources.map((source, index) => [source.id, index + 1])),
    [citedSources],
  )

  const selectFromPanel = (sourceId: string) => {
    setActiveSourceId(sourceId)
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(`[data-citation-source="${sourceId}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }

  const exportReport = async (format: ReportExportFormat) => {
    setExportingFormat(format)
    setExportError(null)
    try {
      const { blob, filename } = await requestReportExport(state.task.id, format)
      const objectUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
    } catch (error) {
      const label = format === 'pdf' ? 'PDF' : 'Word'
      const detail = error instanceof Error ? error.message : '请稍后重试。'
      setExportError(`${label} 导出失败：${detail}`)
    } finally {
      setExportingFormat(null)
    }
  }

  if (!state.reportGenerated) {
    return (
      <div className="page-shell flex min-h-[calc(100dvh-56px)] items-center justify-center py-10">
        <section className="surface-card w-full max-w-2xl p-8 text-center sm:p-10">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <FileText size={26} />
          </span>
          <span className="section-label mt-5 inline-block">Research Report</span>
          <h1 className="mt-2 text-2xl font-semibold text-ink">研究报告尚未生成</h1>
          {state.reportMode === 'mock' && (
            <PrototypeDataNotice topic={currentTopic.topic} className="mt-5 text-left" />
          )}
          <p className="mx-auto mt-3 max-w-lg text-sm leading-[22px] text-ink-muted">
            报告需要先有研究大纲，并且所有正文引用都将映射到大纲使用的资料池来源。
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-2">
            <button type="button" onClick={() => navigate(getTaskRoute(state.task.id, 'outline'))} className="btn-secondary h-10 px-4">
              查看研究大纲
            </button>
            <button
              type="button"
              onClick={async () => {
                if (await generateReport()) return
                if (state.reportStatus !== 'error') navigate(getTaskRoute(state.task.id, 'outline'))
              }}
              disabled={!state.outlineGenerated || state.reportStatus === 'loading'}
              className="btn-primary"
            >
              生成研究报告
              <ArrowRight size={15} />
            </button>
          </div>
          {state.reportStatus === 'loading' && (
            <p className="mt-4 text-xs text-ink-muted">正在撰写章节 · 正在绑定来源引用 · 正在检查证据完整性</p>
          )}
          {state.reportStatus === 'error' && state.reportError && (
            <div className="mt-5 rounded-lg border border-rose-200 bg-rose-50 p-4 text-left">
              <p className="text-sm text-rose-700">{state.reportError}</p>
              <button type="button" onClick={useMockReport} className="btn-secondary mt-3">使用演示报告</button>
            </div>
          )}
        </section>
      </div>
    )
  }

  return (
    <div className="page-shell max-w-[1540px]">
      <section className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between" data-print-hidden="true">
        <div>
          <span className="section-label">Research Report</span>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold leading-8 tracking-[-0.01em] text-ink">研究报告</h1>
            <StatusBadge value="reported" />
            {state.reportMode === 'real' && <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-primary-deep">真实报告</span>}
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            正文包含 {citedSources.length} 条可追溯引用；目标 {state.liveReport?.targetMinWords ?? state.task.reportTargetMinWords}—{state.liveReport?.targetMaxWords ?? state.task.reportTargetMaxWords} 字，实际 {state.liveReport?.actualWordCount ?? '—'} 字。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setNotice('演示链接已准备，可在团队空间中共享。')}
            className="btn-secondary h-10 px-4"
          >
            <Share2 size={15} />
            分享
          </button>
          <button
            type="button"
            onClick={() => void exportReport('pdf')}
            disabled={!state.liveReport || exportingFormat !== null}
            className="btn-primary"
          >
            <Download size={16} />
            {exportingFormat === 'pdf' ? '正在导出 PDF' : '导出 PDF'}
          </button>
          <button
            type="button"
            onClick={() => void exportReport('docx')}
            disabled={!state.liveReport || exportingFormat !== null}
            className="btn-secondary h-10 px-4"
          >
            <FileText size={16} />
            {exportingFormat === 'docx' ? '正在导出 Word' : '导出 Word'}
          </button>
        </div>
      </section>

      {exportError && (
        <section className="mb-5 rounded-lg border border-rose-200 bg-rose-50 p-4" role="alert">
          <p className="text-sm text-rose-700">{exportError}</p>
        </section>
      )}

      {state.reportStatus === 'loading' && (
        <section className="ai-response-block mb-5 p-4" aria-live="polite">
          <p className="text-sm font-semibold text-ink">正在重新生成当前报告</p>
          <p className="mt-1 text-xs text-ink-muted">新报告成功前，上次成功报告会继续保留。</p>
        </section>
      )}

      {state.reportStatus === 'error' && state.reportError && (
        <section className="mb-5 rounded-lg border border-rose-200 bg-rose-50 p-4" role="alert">
          <p className="text-sm font-semibold text-rose-800">本次报告生成失败，上次成功报告已保留。</p>
          <p className="mt-1 text-sm text-rose-700">{state.reportError}</p>
          <button
            type="button"
            onClick={() => void generateReport()}
            className="btn-secondary mt-3"
          >
            重新生成当前报告
          </button>
        </section>
      )}

      {state.reportMode === 'mock' && (
        <PrototypeDataNotice topic={currentTopic.topic} className="mb-5" />
      )}

      <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <article className="mx-auto w-full max-w-[860px] rounded-lg border border-outline bg-white px-6 py-8 shadow-panel sm:px-10 sm:py-10 lg:px-14 lg:py-12">
          <div className="border-b border-outline pb-7">
            <div className="mb-4 flex items-center gap-2 text-primary-deep">
              <BookOpenCheck size={18} />
              <span className="section-label">AI Research Workspace</span>
            </div>
            <h1 className="text-[30px] font-bold leading-[40px] tracking-[-0.02em] text-ink sm:text-[36px] sm:leading-[46px]">
              {state.reportMode === 'real' && state.liveReport
                ? state.liveReport.report.title
                : currentTopic.report.title}
            </h1>
            <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink-subtle">
              <span>研究深度：{state.task.depth === 'professional' ? '专业分析' : state.task.depth === 'quick' ? '快速概览' : '深度研究'}</span>
              <span>·</span>
              <span>来源：{citedSources.length} 条</span>
              <span>·</span>
              <span>
                {reportDepthLabels[state.liveReport?.reportDepth ?? state.task.reportDepth]}
              </span>
              <span>·</span>
              <span>
                目标 {state.liveReport?.targetMinWords ?? state.task.reportTargetMinWords}—{state.liveReport?.targetMaxWords ?? state.task.reportTargetMaxWords} 字
              </span>
              <span>·</span>
              <span>实际 {state.liveReport?.actualWordCount ?? '—'} 字</span>
              <span>·</span>
              <span>AI 辅助生成草稿</span>
            </div>
          </div>

          <div className="mt-8 space-y-9">
            {state.reportMode === 'real' && state.liveReport ? (
              <>
                <section className="rounded-lg bg-slate-50 p-5">
                  <h2 className="text-lg font-semibold text-ink">执行摘要</h2>
                  <p className="mt-3 text-base leading-[30px] text-ink-muted">{state.liveReport.report.executiveSummary}</p>
                </section>
                {state.liveReport.report.sections.map((section) => (
                  <section key={section.id}>
                    <h2 className="mb-4 text-xl font-semibold leading-8 text-ink">{section.title}</h2>
                    <div className="space-y-5">
                      {section.paragraphs.map((paragraph) => (
                        <div key={paragraph.id}>
                          <p className="text-base leading-[30px] text-ink-muted">
                            {paragraph.content}
                            {paragraph.sourceIds.map((sourceId) => {
                              const citationNumber = citationNumberBySource.get(sourceId)
                              return (
                                <button
                                  key={sourceId}
                                  type="button"
                                  data-citation-source={sourceId}
                                  onClick={() => setActiveSourceId(sourceId)}
                                  className={`focus-ring mx-0.5 inline-flex -translate-y-0.5 items-center rounded px-1.5 py-0.5 text-[11px] font-semibold ${activeSourceId === sourceId ? 'bg-primary text-white ring-2 ring-blue-100' : 'bg-primary-fixed text-primary-deep hover:bg-blue-200'}`}
                                  aria-label={`查看引用 ${citationNumber}`}
                                >
                                  [{citationNumber}]
                                </button>
                              )
                            })}
                          </p>
                          {paragraph.claimType !== 'source_supported' && (
                            <span className={`mt-2 inline-flex rounded-full px-2 py-1 text-[10px] font-semibold ${paragraph.claimType === 'synthesis' ? 'bg-blue-50 text-primary-deep' : 'bg-amber-50 text-amber-700'}`}>
                              {paragraph.claimType === 'synthesis' ? 'AI 综合分析' : '待验证'}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
                <section>
                  <h2 className="mb-3 text-xl font-semibold text-ink">总结</h2>
                  <p className="text-base leading-[30px] text-ink-muted">{state.liveReport.report.conclusion}</p>
                </section>
                <section className="rounded-lg border border-amber-200 bg-amber-50 p-5">
                  <h2 className="text-sm font-semibold text-amber-900">研究限制与待验证内容</h2>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-amber-800">
                    {state.liveReport.report.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
                  </ul>
                </section>
                {state.liveReport.warnings.length > 0 && (
                  <section className="rounded-lg border border-slate-200 bg-slate-50 p-5">
                    <h2 className="text-sm font-semibold text-ink">生成提示</h2>
                    {state.liveReport.warnings.map((warning) => (
                      <p key={warning} className="mt-2 text-sm text-ink-muted">{warning}</p>
                    ))}
                  </section>
                )}
                <section>
                  <h2 className="mb-4 text-xl font-semibold text-ink">References / 参考来源</h2>
                  {citedSources.length === 0 ? (
                    <p className="text-sm leading-6 text-ink-muted">本报告暂无可追溯引用来源。</p>
                  ) : (
                    <ol className="space-y-4">
                      {citedSources.map((source, index) => (
                        <li key={source.id} className="text-sm leading-6 text-ink-muted">
                          <p className="font-semibold text-ink">[{index + 1}] {source.title}</p>
                          <p className="text-xs text-ink-subtle">
                            {[source.publisher, source.publishDate].filter(Boolean).join(' · ')}
                          </p>
                          <a
                            href={source.url}
                            target="_blank"
                            rel="noreferrer"
                            className="break-all text-xs text-primary-deep hover:underline"
                          >
                            {source.url}
                          </a>
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
              </>
            ) : reportSections.map((section) => (
              <section key={section.id}>
                {section.heading && (
                  <h2 className="mb-4 text-xl font-semibold leading-8 tracking-[-0.01em] text-ink">
                    {section.heading}
                  </h2>
                )}
                <div className="space-y-5">
                  {section.paragraphs.map((paragraph) => (
                    <p key={paragraph.id} className="text-base leading-[30px] text-ink-muted">
                      {paragraph.segments.map((segment, index) => {
                        if (segment.type === 'text') return <span key={index}>{segment.text}</span>
                        const citationNumber = citationNumberBySource.get(segment.sourceId)
                        const active = activeSourceId === segment.sourceId
                        return (
                          <button
                            key={`${segment.sourceId}-${index}`}
                            type="button"
                            data-citation-source={segment.sourceId}
                            onClick={() => setActiveSourceId(segment.sourceId)}
                            className={`focus-ring mx-0.5 inline-flex -translate-y-0.5 items-center rounded px-1.5 py-0.5 text-[11px] font-semibold leading-4 transition ${
                              active
                                ? 'bg-primary text-white ring-2 ring-blue-100'
                                : 'bg-primary-fixed text-primary-deep hover:bg-blue-200'
                            }`}
                            aria-label={`查看引用 ${citationNumber}`}
                          >
                            [{citationNumber}]
                          </button>
                        )
                      })}
                    </p>
                  ))}
                </div>
                {section.insight && (
                  <div className="ai-response-block mt-6 p-5">
                    <div className="mb-2 flex items-center gap-2 text-primary-deep">
                      <Sparkles size={16} />
                      <span className="text-xs font-semibold">AI 综合笔记</span>
                    </div>
                    <p className="text-sm leading-[23px] text-ink-muted">{section.insight}</p>
                  </div>
                )}
              </section>
            ))}
          </div>

          <footer className="mt-12 border-t border-outline pt-6 text-xs leading-5 text-ink-subtle">
            {state.reportMode === 'real'
              ? '当前报告基于来源摘要和关键观点生成，建议通过原文链接复核重要结论。'
              : '当前为用户主动选择的演示报告，不代表真实搜索结果或正式研究结论。'}
          </footer>
        </article>

        <CitationPanel
          sources={citedSources}
          activeSourceId={activeSourceId}
          onSelect={selectFromPanel}
          onOpenSource={(sourceId) => navigate(getTaskSourceRoute(state.task.id, sourceId), {
            state: { from: getTaskRoute(state.task.id, 'report') },
          })}
        />
      </div>
    </div>
  )
}

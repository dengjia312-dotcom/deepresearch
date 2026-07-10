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
import { useResearch } from '../context/ResearchContext'

export function ReportPage() {
  const navigate = useNavigate()
  const {
    state,
    currentTopic,
    reportSections,
    getSource,
    generateReport,
    setNotice,
  } = useResearch()

  const citedSources = useMemo(() => {
    const ids: string[] = []
    reportSections.forEach((section) => {
      section.paragraphs.forEach((paragraph) => {
        paragraph.segments.forEach((segment) => {
          if (segment.type === 'citation' && !ids.includes(segment.sourceId)) {
            ids.push(segment.sourceId)
          }
        })
      })
    })
    return ids.flatMap((id) => (getSource(id) ? [getSource(id)!] : []))
  }, [getSource, reportSections])

  const [activeSourceId, setActiveSourceId] = useState<string | null>(
    citedSources[0]?.id ?? null,
  )

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

  if (!state.reportGenerated) {
    return (
      <div className="page-shell flex min-h-[calc(100dvh-56px)] items-center justify-center py-10">
        <section className="surface-card w-full max-w-2xl p-8 text-center sm:p-10">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <FileText size={26} />
          </span>
          <span className="section-label mt-5 inline-block">Research Report</span>
          <h1 className="mt-2 text-2xl font-semibold text-ink">研究报告尚未生成</h1>
          {currentTopic.usesPrototypeData && (
            <PrototypeDataNotice topic={currentTopic.topic} className="mt-5 text-left" />
          )}
          <p className="mx-auto mt-3 max-w-lg text-sm leading-[22px] text-ink-muted">
            报告需要先有研究大纲，并且所有正文引用都将映射到大纲使用的资料池来源。
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-2">
            <button type="button" onClick={() => navigate('/outline')} className="btn-secondary h-10 px-4">
              查看研究大纲
            </button>
            <button
              type="button"
              onClick={() => {
                if (generateReport()) return
                navigate('/outline')
              }}
              disabled={!state.outlineGenerated}
              className="btn-primary"
            >
              生成研究报告
              <ArrowRight size={15} />
            </button>
          </div>
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
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            正文包含 {citedSources.length} 条可追溯引用，点击标记可定位到来源。
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
          <button type="button" onClick={() => window.print()} className="btn-primary">
            <Download size={16} />
            导出 PDF
          </button>
        </div>
      </section>

      {currentTopic.usesPrototypeData && (
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
              {currentTopic.report.title}
            </h1>
            <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink-subtle">
              <span>研究深度：{state.task.depth === 'professional' ? '专业分析' : state.task.depth === 'quick' ? '快速概览' : '深度研究'}</span>
              <span>·</span>
              <span>来源：{citedSources.length} 条</span>
              <span>·</span>
              <span>AI 辅助生成草稿</span>
            </div>
          </div>

          <div className="mt-8 space-y-9">
            {reportSections.map((section) => (
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
            {currentTopic.usesPrototypeData
              ? '当前为产品原型演示数据，不代表真实搜索结果或正式研究结论。'
              : '本报告使用预设演示数据生成，用于展示研究流程与引用追溯能力。'}
          </footer>
        </article>

        <CitationPanel
          sources={citedSources}
          activeSourceId={activeSourceId}
          onSelect={selectFromPanel}
        />
      </div>
    </div>
  )
}

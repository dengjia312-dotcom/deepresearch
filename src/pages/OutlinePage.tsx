import {
  ArrowRight,
  BookOpen,
  FileText,
  Link2,
  ListTree,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { OutlineSection } from '../components/OutlineSection'
import { PrototypeDataNotice } from '../components/PrototypeDataNotice'
import { StatusBadge } from '../components/StatusBadge'
import { TagBadge } from '../components/TagBadge'
import { useResearch } from '../context/ResearchContext'
import type { OutlineSectionData } from '../types'

function findSection(
  sections: OutlineSectionData[],
  sectionId: string,
): OutlineSectionData | undefined {
  for (const section of sections) {
    if (section.id === sectionId) return section
    const nested = findSection(section.children, sectionId)
    if (nested) return nested
  }
  return undefined
}

export function OutlinePage() {
  const navigate = useNavigate()
  const {
    state,
    currentTopic,
    eligibleSources,
    outlineSections,
    generateOutline,
    generateReport,
    getSource,
    getPoolItem,
    setNotice,
  } = useResearch()
  const [selectedSectionId, setSelectedSectionId] = useState('')

  const selectedSection = useMemo(
    () =>
      findSection(outlineSections, selectedSectionId) ??
      outlineSections[0],
    [outlineSections, selectedSectionId],
  )

  const associatedSources = useMemo(
    () => selectedSection?.sourceIds.flatMap((id) => (getSource(id) ? [getSource(id)!] : [])) ?? [],
    [getSource, selectedSection],
  )

  const handleGenerateReport = () => {
    if (generateReport()) navigate('/report')
  }

  if (!state.outlineGenerated) {
    return (
      <div className="page-shell flex min-h-[calc(100dvh-56px)] items-center justify-center py-10">
        <section className="surface-card w-full max-w-2xl p-7 text-center sm:p-10">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <ListTree size={26} />
          </span>
          <span className="section-label mt-5 inline-block">Outline Builder</span>
          <h1 className="mt-2 text-2xl font-semibold text-ink">生成研究大纲</h1>
          {currentTopic.usesPrototypeData && (
            <PrototypeDataNotice topic={currentTopic.topic} className="mt-5 text-left" />
          )}
          <p className="mx-auto mt-3 max-w-lg text-sm leading-[22px] text-ink-muted">
            AI 将只使用资料池中的可用来源组织章节。“无关”资料会保留在资料池，但不会参与本次大纲。
          </p>

          <div className="mt-7 grid grid-cols-3 gap-3 text-left">
            <div className="rounded-lg bg-slate-50 p-4">
              <p className="text-[11px] text-ink-subtle">资料池来源</p>
              <p className="mt-1 text-xl font-semibold text-ink">{state.poolItems.length}</p>
            </div>
            <div className="rounded-lg bg-blue-50 p-4">
              <p className="text-[11px] text-blue-600">可用来源</p>
              <p className="mt-1 text-xl font-semibold text-primary-deep">{eligibleSources.length}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-4">
              <p className="text-[11px] text-ink-subtle">排除来源</p>
              <p className="mt-1 text-xl font-semibold text-ink">
                {state.poolItems.length - eligibleSources.length}
              </p>
            </div>
          </div>

          <div className="mt-7 flex flex-wrap justify-center gap-2">
            <button type="button" onClick={() => navigate('/pool')} className="btn-secondary h-10 px-4">
              返回资料池检查
            </button>
            <button
              type="button"
              onClick={() => generateOutline()}
              disabled={eligibleSources.length === 0}
              className="btn-primary"
            >
              <Sparkles size={16} />
              基于 {eligibleSources.length} 条资料生成大纲
            </button>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className="page-shell">
      <section className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <span className="section-label">Outline Builder</span>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold leading-8 tracking-[-0.01em] text-ink">研究大纲</h1>
            <StatusBadge value="outlined" />
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            基于资料池中的 {eligibleSources.length} 条可用来源自动组织，章节来源数量实时计算。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setNotice('大纲编辑将在完整版本中开放；当前可切换章节查看来源。')}
            className="btn-secondary h-10 px-4"
          >
            <Pencil size={15} />
            编辑大纲
          </button>
          <button type="button" onClick={handleGenerateReport} className="btn-primary">
            <FileText size={16} />
            生成研究报告
            <ArrowRight size={14} />
          </button>
        </div>
      </section>

      {currentTopic.usesPrototypeData && (
        <PrototypeDataNotice topic={currentTopic.topic} className="mb-5" />
      )}

      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,0.75fr)]">
        <section className="surface-card min-h-[720px] overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-outline px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div className="flex items-center gap-2">
              <ListTree size={19} className="text-primary" />
              <div>
                <h2 className="text-base font-semibold text-ink">报告大纲（AI 生成）</h2>
                <p className="text-[11px] text-ink-subtle">选择章节以查看关联来源</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => generateOutline()}
              className="btn-secondary self-start sm:self-auto"
            >
              <RefreshCw size={14} />
              重新生成
            </button>
          </div>

          <div className="p-5 sm:p-6">
            <div className="ai-response-block mb-6 p-5">
              <div className="flex gap-3">
                <Sparkles size={18} className="mt-0.5 shrink-0 text-primary" />
                <div>
                  <h3 className="text-sm font-semibold text-ink">AI 大纲洞察</h3>
                  <p className="mt-1 text-sm leading-[22px] text-ink-muted">
                    结构已围绕“{currentTopic.insights[0]?.title}”
                    {currentTopic.insights[1] ? `与“${currentTopic.insights[1].title}”` : ''}
                    组织；存疑来源仍可参与，但会在右侧关联来源中保留状态提示。
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              {outlineSections.map((section) => (
                <OutlineSection
                  key={section.id}
                  section={section}
                  selectedSectionId={selectedSection?.id ?? ''}
                  onSelect={setSelectedSectionId}
                />
              ))}
            </div>

            <button
              type="button"
              onClick={() => setNotice('已添加一个空白章节草稿（演示状态）。')}
              className="focus-ring mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 text-sm font-medium text-ink-muted transition hover:border-primary hover:bg-blue-50 hover:text-primary-deep"
            >
              <Plus size={17} />
              手动添加新章节
            </button>
          </div>
        </section>

        <aside className="surface-card min-h-[620px] overflow-hidden xl:sticky xl:top-20 xl:self-start">
          <div className="flex items-center justify-between border-b border-outline px-5 py-4">
            <div>
              <div className="flex items-center gap-2">
                <BookOpen size={18} className="text-primary" />
                <h2 className="text-base font-semibold text-ink">关联来源</h2>
              </div>
              <p className="mt-1 line-clamp-1 text-[11px] text-ink-subtle">
                当前章节：{selectedSection?.title}
              </p>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
              <Link2 size={12} />
              {associatedSources.length}
            </span>
          </div>

          <div className="space-y-3 p-4">
            {associatedSources.length > 0 ? (
              associatedSources.map((source) => {
                const poolItem = getPoolItem(source.id)
                return (
                  <button
                    key={source.id}
                    type="button"
                    onClick={() =>
                      navigate(`/sources/${source.id}`, { state: { from: '/pool' } })
                    }
                    className="focus-ring w-full rounded-lg border border-outline bg-white p-4 text-left transition hover:border-blue-200 hover:shadow-ambient"
                  >
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <span className="section-label">{source.publisher}</span>
                      {poolItem && <StatusBadge value={poolItem.reviewStatus} />}
                    </div>
                    <h3 className="text-sm font-semibold leading-[22px] text-ink">
                      {source.title}
                    </h3>
                    <p className="mt-2 line-clamp-3 text-xs leading-5 text-ink-muted">
                      {source.summary}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {source.tags.slice(0, 2).map((tag) => (
                        <TagBadge key={tag}>{tag}</TagBadge>
                      ))}
                    </div>
                  </button>
                )
              })
            ) : (
              <div className="py-14 text-center">
                <Link2 size={26} className="mx-auto text-slate-300" />
                <p className="mt-3 text-sm font-semibold text-ink">本章节暂无可用来源</p>
                <p className="mt-1 text-xs text-ink-subtle">可返回资料池补充或调整资料判断。</p>
                <button
                  type="button"
                  onClick={() => navigate('/pool')}
                  className="focus-ring mt-3 rounded-md text-xs font-semibold text-primary-deep hover:underline"
                >
                  返回资料池
                </button>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}

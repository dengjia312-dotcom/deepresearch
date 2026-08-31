import {
  ArrowRight,
  BookOpen,
  FileText,
  Link2,
  ListTree,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { OutlineSection } from '../components/OutlineSection'
import { PrototypeDataNotice } from '../components/PrototypeDataNotice'
import { StatusBadge } from '../components/StatusBadge'
import { TagBadge } from '../components/TagBadge'
import {
  getTaskRoute,
  getTaskSourceRoute,
  MIN_OUTLINE_SOURCE_COUNT,
  REPORT_DEPTH_RANGES,
  useResearch,
} from '../context/ResearchContext'
import type { OutlineSectionData, ReportDepth } from '../types'

const outlineProgressMessages = ['正在分析资料来源', '正在组织研究结构', '正在检查证据覆盖']
const reportProgressMessages = ['正在撰写章节', '正在绑定来源引用', '正在检查证据完整性']
const reportDepthOrder: ReportDepth[] = ['brief', 'standard', 'deep']

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
    eligibleRealSources,
    outlineSections,
    generateOutline,
    useMockOutline,
    generateReport,
    useMockReport,
    setReportDepth,
    getSource,
    getPoolItem,
    setNotice,
  } = useResearch()
  const [selectedSectionId, setSelectedSectionId] = useState('')
  const [outlineProgressIndex, setOutlineProgressIndex] = useState(0)
  const [reportProgressIndex, setReportProgressIndex] = useState(0)

  useEffect(() => {
    if (state.outlineStatus !== 'loading') return setOutlineProgressIndex(0)
    const timer = window.setInterval(() => setOutlineProgressIndex(
      (index) => (index + 1) % outlineProgressMessages.length,
    ), 1200)
    return () => window.clearInterval(timer)
  }, [state.outlineStatus])

  useEffect(() => {
    if (state.reportStatus !== 'loading') return setReportProgressIndex(0)
    const timer = window.setInterval(() => setReportProgressIndex(
      (index) => (index + 1) % reportProgressMessages.length,
    ), 1200)
    return () => window.clearInterval(timer)
  }, [state.reportStatus])

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
  const emptySourceSections = useMemo(
    () => outlineSections.filter((section) => section.sourceIds.length === 0),
    [outlineSections],
  )
  const selectedReportRange = REPORT_DEPTH_RANGES[state.task.reportDepth]
  const selectedDepthReason = emptySourceSections.length > 0
    ? `有 ${emptySourceSections.length} 个章节没有来源`
    : eligibleRealSources.length < selectedReportRange.minimumSources
      ? `至少需要 ${selectedReportRange.minimumSources} 条有效真实资料`
      : ''
  const canGenerateReport = state.outlineMode === 'real'
    && !selectedDepthReason

  const handleGenerateReport = async () => {
    if (await generateReport()) navigate(getTaskRoute(state.task.id, 'report'))
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
          {state.outlineMode === 'mock' && (
            <PrototypeDataNotice topic={currentTopic.topic} className="mt-5 text-left" />
          )}
          <p className="mx-auto mt-3 max-w-lg text-sm leading-[22px] text-ink-muted">
            AI 将只使用资料池中至少 {MIN_OUTLINE_SOURCE_COUNT} 条有效来源组织章节。“无关”资料会保留在资料池，但不会参与本次大纲。
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
            <button type="button" onClick={() => navigate(getTaskRoute(state.task.id, 'pool'))} className="btn-secondary h-10 px-4">
              返回资料池检查
            </button>
            <button
              type="button"
              onClick={() => void generateOutline()}
              disabled={eligibleRealSources.length < MIN_OUTLINE_SOURCE_COUNT || state.outlineStatus === 'loading'}
              className="btn-primary"
            >
              {state.outlineStatus === 'loading'
                ? <LoaderCircle size={16} className="animate-spin" />
                : <Sparkles size={16} />}
              基于 {eligibleRealSources.length} 条真实资料生成大纲
            </button>
          </div>
          {state.outlineStatus === 'loading' && (
            <p className="mt-4 text-xs text-ink-muted">{outlineProgressMessages[outlineProgressIndex]}</p>
          )}
          {state.outlineStatus === 'error' && state.outlineError && (
            <div className="mt-5 rounded-lg border border-rose-200 bg-rose-50 p-4 text-left">
              <p className="text-sm text-rose-700">{state.outlineError}</p>
              <button type="button" onClick={useMockOutline} className="btn-secondary mt-3">使用演示大纲</button>
            </div>
          )}
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
            {state.outlineMode === 'real' && <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-primary-deep">真实大纲</span>}
            {state.outlineMode === 'mock' && <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">演示大纲</span>}
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
          <button
            type="button"
            onClick={handleGenerateReport}
            disabled={state.reportStatus === 'loading' || !canGenerateReport}
            title={selectedDepthReason || undefined}
            className="btn-primary"
          >
            {state.reportStatus === 'loading' ? <LoaderCircle size={16} className="animate-spin" /> : <FileText size={16} />}
            生成研究报告
            <ArrowRight size={14} />
          </button>
        </div>
      </section>

      {state.outlineStatus === 'loading' && (
        <section className="ai-response-block mb-5 p-4" aria-live="polite">
          <p className="text-sm font-semibold text-ink">正在重新生成大纲</p>
          <p className="mt-1 text-xs text-ink-muted">新大纲成功前，已有大纲和报告会继续保留。</p>
        </section>
      )}

      {state.outlineStatus === 'error' && state.outlineError && (
        <section className="mb-5 rounded-lg border border-rose-200 bg-rose-50 p-4" role="alert">
          <p className="text-sm font-semibold text-rose-800">本次大纲生成失败，上次成功大纲和报告已保留。</p>
          <p className="mt-1 text-sm text-rose-700">{state.outlineError}</p>
          <button
            type="button"
            onClick={() => void generateOutline()}
            className="btn-secondary mt-3"
          >
            重新生成大纲
          </button>
        </section>
      )}

      {state.reportStatus === 'loading' && (
        <section className="ai-response-block mb-5 p-4" aria-live="polite">
          <p className="text-sm font-semibold text-ink">AI 正在基于当前大纲撰写真实报告</p>
          <p className="mt-2 text-xs text-ink-muted">{reportProgressMessages[reportProgressIndex]}</p>
        </section>
      )}
      {state.reportStatus === 'error' && state.reportError && (
        <section className="mb-5 rounded-lg border border-rose-200 bg-rose-50 p-4">
          <p className="text-sm font-semibold text-rose-800">真实报告生成失败</p>
          <p className="mt-1 text-sm text-rose-700">{state.reportError}</p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => void handleGenerateReport()} className="btn-secondary">重新生成</button>
            <button type="button" onClick={() => { useMockReport(); navigate(getTaskRoute(state.task.id, 'report')) }} className="btn-secondary">使用演示报告</button>
          </div>
        </section>
      )}

      {state.outlineMode === 'mock' && (
        <PrototypeDataNotice topic={currentTopic.topic} className="mb-5" />
      )}

      {state.outlineMode === 'real' && (
        <section className="surface-card mb-5 p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-ink">报告深度</h2>
              <p className="mt-1 text-xs text-ink-subtle">
                根据当前 {eligibleRealSources.length} 条有效真实资料选择报告长度。
              </p>
            </div>
            <p className="text-xs font-medium text-primary-deep">
              当前目标：{state.task.reportTargetMinWords}—{state.task.reportTargetMaxWords} 字
            </p>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {reportDepthOrder.map((depth) => {
              const range = REPORT_DEPTH_RANGES[depth]
              const disabled = eligibleRealSources.length < range.minimumSources
              const selected = state.task.reportDepth === depth
              return (
                <button
                  key={depth}
                  type="button"
                  disabled={disabled}
                  onClick={() => setReportDepth(depth)}
                  className={`focus-ring rounded-lg border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-55 ${
                    selected
                      ? 'border-blue-200 bg-primary-soft text-primary-deep'
                      : 'border-outline bg-white text-ink-muted hover:border-slate-300'
                  }`}
                >
                  <span className="block text-sm font-semibold">{range.label}</span>
                  <span className="mt-1 block text-xs">{range.min}—{range.max} 字</span>
                  <span className="mt-2 block text-[11px]">
                    {disabled
                      ? `需至少 ${range.minimumSources} 条资料，当前 ${eligibleRealSources.length} 条`
                      : depth === 'brief'
                        ? '一次生成'
                        : '按章节生成后合并'}
                  </span>
                </button>
              )
            })}
          </div>
          {emptySourceSections.length > 0 && (
            <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-4">
              <p className="text-sm font-semibold text-rose-800">存在无来源章节，暂不能生成报告</p>
              <p className="mt-1 text-xs leading-5 text-rose-700">
                {emptySourceSections.map((section) => section.title).join('、')}。请补充资料并重新生成大纲，或删除这些章节。
              </p>
              <button type="button" onClick={() => navigate(getTaskRoute(state.task.id, 'pool'))} className="btn-secondary mt-3">
                返回资料池补充来源
              </button>
            </div>
          )}
          {!emptySourceSections.length && selectedDepthReason && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p className="text-xs text-amber-800">
                当前选择不可用：{selectedDepthReason}。请选择更短报告或补充资料。
              </p>
              <button type="button" onClick={() => navigate(getTaskRoute(state.task.id, 'pool'))} className="btn-secondary">
                返回资料池
              </button>
            </div>
          )}
        </section>
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
              onClick={() => void generateOutline()}
              disabled={state.outlineStatus === 'loading'}
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
                    {state.outlineMode === 'real' && state.liveOutline
                      ? `${state.liveOutline.outline.title}。本大纲仅使用资料池中的有效来源，并标注各章节证据覆盖状态。`
                      : '结构已基于当前演示资料组织；存疑来源仍可参与，并保留状态提示。'}
                  </p>
                  {state.liveOutline?.warnings.map((warning) => (
                    <p key={warning} className="mt-2 text-xs text-amber-700">提示：{warning}</p>
                  ))}
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
                      navigate(getTaskSourceRoute(state.task.id, source.id), {
                        state: { from: getTaskRoute(state.task.id, 'outline') },
                      })
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
                  onClick={() => navigate(getTaskRoute(state.task.id, 'pool'))}
                  className="focus-ring mt-3 rounded-md text-xs font-semibold text-primary-deep hover:underline"
                >
                  返回资料池
                </button>
              </div>
            )}

            {selectedSection
              && selectedSection.evidenceStatus !== 'sufficient'
              && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                  <p className="text-sm font-semibold text-amber-900">
                    {selectedSection.evidenceStatus === 'insufficient'
                      ? '本章证据不足'
                      : '本章证据有限'}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-amber-800">
                    当前关联 {associatedSources.length} 条来源，建议补充资料后重新生成大纲。
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={() => navigate(getTaskRoute(state.task.id, 'pool'))} className="btn-secondary">
                      返回资料池补充来源
                    </button>
                    <button
                      type="button"
                      onClick={() => void generateOutline()}
                      disabled={state.outlineStatus === 'loading'}
                      className="btn-secondary"
                    >
                      <RefreshCw size={14} />
                      重新生成
                    </button>
                  </div>
                </div>
              )}
          </div>
        </aside>
      </div>
    </div>
  )
}

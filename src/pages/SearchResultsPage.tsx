import {
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Clock3,
  Filter,
  LoaderCircle,
  RefreshCw,
  Search,
  Sparkles,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { PrototypeDataNotice } from '../components/PrototypeDataNotice'
import { SourceCard } from '../components/SourceCard'
import { TagBadge } from '../components/TagBadge'
import {
  getTaskRoute,
  getTaskSourceRoute,
  useResearch,
} from '../context/ResearchContext'

const liveProgressPhases = ['queued', 'searching', 'reading', 'synthesizing'] as const

export function SearchResultsPage() {
  const navigate = useNavigate()
  const {
    state,
    currentTopic,
    sources,
    eligibleRealSources,
    addSourceToPool,
    getPoolItem,
    startLiveResearch,
    useMockResearch,
  } = useResearch()
  const [searchTerm, setSearchTerm] = useState(state.task.title)
  const [activeFilter, setActiveFilter] = useState('全部')
  const [showAllSources, setShowAllSources] = useState(false)

  useEffect(() => {
    setSearchTerm(state.task.title)
    setActiveFilter('全部')
    setShowAllSources(false)
  }, [state.task.id, state.task.title])

  useEffect(() => {
    setShowAllSources(false)
  }, [state.searchedAt])

  const filteredSources = useMemo(() => {
    const byKind = activeFilter === '全部'
      ? sources
      : sources.filter((source) => {
          if (activeFilter === '报告') return source.type === 'report' || source.type === 'pdf'
          if (activeFilter === '新闻') return source.type === 'news'
          return source.type === 'web'
        })
    const keyword = searchTerm.trim().toLocaleLowerCase()
    if (!keyword || keyword === state.task.title.toLocaleLowerCase()) return byKind
    return byKind.filter((source) =>
      source.title.toLocaleLowerCase().includes(keyword)
      || source.summary.toLocaleLowerCase().includes(keyword)
      || source.publisher.toLocaleLowerCase().includes(keyword)
      || source.tags.some((tag) => tag.toLocaleLowerCase().includes(keyword)))
  }, [activeFilter, searchTerm, sources, state.task.title])

  const visibleSources = state.searchMode === 'real' && !showAllSources
    ? filteredSources.slice(0, 8)
    : filteredSources

  const topicTags = useMemo(
    () => [...new Set(sources.flatMap((source) => source.tags))].slice(0, 5),
    [sources],
  )

  const displayedInsights = state.searchMode === 'real' && state.liveResearchResult
    ? state.liveResearchResult.insights
    : currentTopic.insights.map((insight) => ({
        id: insight.id,
        title: insight.title,
        content: insight.description,
        sourceIds: [insight.sourceId],
      }))
  const displayedSummary = state.searchMode === 'real' && state.liveResearchResult
    ? state.liveResearchResult.summary
    : currentTopic.summary
  const hasPreservedLiveResult = state.searchStatus === 'error'
    && state.searchMode === 'real'
    && Boolean(state.liveResearchResult)
  const isResultVisible = (
    state.searchStatus === 'success'
    && (state.searchMode === 'real' || state.searchMode === 'mock')
  ) || hasPreservedLiveResult
  const hasCompletedLiveSearch = Boolean(state.liveResearchResult)
  const intentConfirmationPending = state.researchPlan?.intentConfirmation?.status === 'pending'
  const progress = state.researchJobProgress
  const currentProgressPhase = state.researchJobPhase ?? 'queued'
  const activeProgressStep = Math.max(0, liveProgressPhases.indexOf(
    currentProgressPhase === 'completed' || currentProgressPhase === 'failed'
      ? 'synthesizing'
      : currentProgressPhase,
  ))
  const liveProgressSteps = [
    '正在准备研究任务',
    progress?.validSourceCount
      ? `已找到 ${progress.validSourceCount} 条有效来源`
      : '正在检索真实互联网来源',
    progress?.readerTargetCount
      ? `正在深度阅读网页 ${progress.readerCompletedCount} / ${progress.readerTargetCount}`
      : '正在准备深度阅读网页',
    `正在基于 ${progress?.validSourceCount ?? 0} 条真实来源进行综合分析`,
  ]

  if (!state.researchPlan) return <Navigate to="/" replace />
  if (!state.researchPlan.confirmedAt) {
    return <Navigate to={getTaskRoute(state.task.id, 'plan')} replace />
  }

  const openSource = (sourceId: string) => {
    navigate(getTaskSourceRoute(state.task.id, sourceId), {
      state: { from: getTaskRoute(state.task.id, 'search') },
    })
  }

  const handleLiveSearch = async () => {
    if (state.searchStatus === 'loading' || intentConfirmationPending) return
    if (
      hasCompletedLiveSearch
      && !window.confirm('重新联网搜索将覆盖当前搜索结果，但不会删除已经加入资料池的来源。是否继续？')
    ) {
      return
    }
    await startLiveResearch()
  }

  const statusLabel = state.searchStatus === 'loading'
    ? '联网研究进行中'
    : state.searchStatus === 'error'
      ? '联网研究失败'
      : state.searchMode === 'real' && state.searchStatus === 'success'
        ? '真实联网研究'
        : state.searchMode === 'mock' && state.searchStatus === 'success'
          ? '产品原型演示数据'
          : '等待开始联网研究'

  return (
    <div className="page-shell">
      <section className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="section-label">Research Discovery</span>
            <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${
              state.searchStatus === 'error' ? 'text-red-600' : 'text-primary-deep'
            }`}>
              <span className={`h-1.5 w-1.5 rounded-full ${
                state.searchStatus === 'loading'
                  ? 'animate-pulse bg-primary'
                  : state.searchStatus === 'error'
                    ? 'bg-red-500'
                    : state.searchStatus === 'success'
                      ? 'bg-emerald-500'
                      : 'bg-slate-300'
              }`} />
              {statusLabel}
            </span>
          </div>
          <h1 className="text-2xl font-semibold leading-8 tracking-[-0.01em] text-ink">AI 搜索</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {state.searchMode === 'real' && state.searchStatus === 'success'
              ? `已为“${state.task.title}”整理 ${sources.length} 条真实互联网来源。`
              : `当前研究主题：“${state.task.title}”。联网研究只会在你主动点击后执行。`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleLiveSearch}
            disabled={state.searchStatus === 'loading' || intentConfirmationPending}
            className="btn-primary h-10 px-4"
          >
            {state.searchStatus === 'loading' ? (
              <LoaderCircle size={16} className="animate-spin" />
            ) : (
              <Wifi size={16} />
            )}
            {hasCompletedLiveSearch ? '重新联网搜索' : '开始联网研究'}
          </button>
          {intentConfirmationPending && (
            <p className="text-xs font-medium text-amber-700">请先确认研究方向。</p>
          )}
          <button
            type="button"
            onClick={() => navigate(getTaskRoute(state.task.id, 'pool'))}
            className="btn-secondary h-10 px-4"
          >
            查看资料池
            <ArrowRight size={15} />
          </button>
        </div>
      </section>

      {state.searchMode === 'mock' && (
        <PrototypeDataNotice topic={state.task.title} className="mb-5" />
      )}

      {state.searchStatus === 'idle' && (
        <section className="surface-card flex min-h-[560px] flex-col items-center justify-center p-8 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <Wifi size={26} />
          </span>
          <span className="section-label mt-5">Live Research</span>
          <h2 className="mt-2 text-xl font-semibold text-ink">准备开始真实联网研究</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-ink-muted">
            将根据当前研究计划中的目标与来源偏好执行 GLM 检索与网页阅读，再由 AI 综合分析。进入页面或刷新页面不会自动发起新任务。
          </p>
          <p className="mt-2 text-xs font-medium text-primary-deep">
            本次目标检索 {state.task.targetSourceCount} 条
          </p>
          <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-ink-subtle">
            <Clock3 size={14} />
            联网研究通常需要 10～45 秒
          </p>
          <button type="button" onClick={handleLiveSearch} disabled={intentConfirmationPending} className="btn-primary mt-6 disabled:opacity-60">
            <Wifi size={16} />
            开始联网研究
          </button>
        </section>
      )}

      {state.searchStatus === 'loading' && (
        <section className="surface-card flex min-h-[560px] flex-col items-center justify-center p-6 sm:p-10">
          <LoaderCircle size={30} className="animate-spin text-primary" />
          <span className="section-label mt-5">Live Research in progress</span>
          <h2 className="mt-2 text-xl font-semibold text-ink">正在进行真实联网研究</h2>
          <p className="mt-2 text-sm text-ink-muted">任务已在后端执行，可以刷新页面或切换任务，返回后会继续恢复进度。</p>
          <div className="mt-7 w-full max-w-lg space-y-2.5">
            {liveProgressSteps.map((step, index) => {
              const completed = index < activeProgressStep
              const active = index === activeProgressStep
              return (
                <div
                  key={step}
                  className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-sm font-medium ${
                    active
                      ? 'border-blue-200 bg-blue-50 text-primary-deep'
                      : completed
                        ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
                        : 'border-outline bg-white text-ink-subtle'
                  }`}
                >
                  {completed ? (
                    <Check size={16} />
                  ) : active ? (
                    <LoaderCircle size={16} className="animate-spin" />
                  ) : (
                    <span className="h-2 w-2 rounded-full bg-slate-300" />
                  )}
                  {step}
                </div>
              )
            })}
          </div>
          {currentProgressPhase === 'reading' && progress && (
            <p className="mt-5 text-xs leading-5 text-ink-subtle">
              全文来源 {progress.fullTextCount} · 部分内容 {progress.partialCount} ·
              内容不足 {progress.insufficientCount} · 读取失败 {progress.readerFailedCount}
            </p>
          )}
        </section>
      )}

      {state.searchStatus === 'error' && (
        <section className={`surface-card flex flex-col items-center justify-center p-8 text-center ${
          hasPreservedLiveResult ? 'mb-5' : 'min-h-[500px]'
        }`} role="alert">
          <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-red-50 text-red-600">
            <WifiOff size={26} />
          </span>
          <h2 className="mt-5 text-xl font-semibold text-ink">联网研究未完成</h2>
          {hasPreservedLiveResult && (
            <p className="mt-2 text-sm font-semibold text-rose-700">
              本次联网研究失败，上次成功结果已保留。
            </p>
          )}
          <p className="mt-2 max-w-xl text-sm leading-6 text-ink-muted">
            {state.searchError ?? '联网研究失败，请稍后重试。'}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <button type="button" onClick={handleLiveSearch} disabled={intentConfirmationPending} className="btn-primary disabled:opacity-60">
              <RefreshCw size={15} />
              重新搜索
            </button>
            {hasPreservedLiveResult && (
              <a href="#preserved-research-results" className="btn-secondary h-10 px-4">
                继续查看旧结果
              </a>
            )}
            <button type="button" onClick={useMockResearch} className="btn-secondary h-10 px-4">
              使用演示数据继续
            </button>
          </div>
          <p className="mt-3 text-xs text-ink-subtle">不会自动切换为演示数据，只有你主动选择后才会加载。</p>
        </section>
      )}

      {isResultVisible && (
        <div id="preserved-research-results">
          {state.searchMode === 'real' && state.liveResearchResult?.warnings.length ? (
            <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900" role="note">
              <div className="flex items-start gap-2">
                <CircleAlert size={17} className="mt-0.5 shrink-0 text-amber-600" />
                <div>
                  <p className="text-sm font-semibold">联网研究提示</p>
                  <ul className="mt-1 space-y-1 text-xs leading-5 text-amber-800">
                    {state.liveResearchResult.warnings.map((warning) => (
                      <li key={warning}>· {warning}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ) : null}

          <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ['目标检索数', state.searchMode === 'real'
                ? state.liveResearchResult?.targetSourceCount ?? state.task.targetSourceCount
                : state.task.targetSourceCount],
              ['实际返回数', state.searchMode === 'real'
                ? state.liveResearchResult?.actualSourceCount ?? sources.length
                : sources.length],
              ['去重后数量', state.searchMode === 'real'
                ? state.liveResearchResult?.deduplicatedSourceCount ?? sources.length
                : sources.length],
              ['有效资料数量', state.searchMode === 'real'
                ? state.liveResearchResult?.validSourceCount ?? sources.length
                : sources.length],
            ].map(([label, value]) => (
              <div key={label} className="surface-card p-4">
                <p className="text-[11px] text-ink-subtle">{label}</p>
                <p className="mt-1 text-xl font-semibold text-ink">{value} 条</p>
              </div>
            ))}
          </section>
          <p className="mb-5 text-xs leading-5 text-ink-subtle">
            实际数量可能受搜索覆盖、重复 URL、链接有效性和主题相关性影响；当前资料池已选有效真实资料 {eligibleRealSources.length} 条。
          </p>

          <div className="surface-card mb-6 flex flex-col gap-2 p-2 sm:flex-row sm:items-center sm:rounded-xl">
            <label className="flex min-w-0 flex-1 items-center gap-3 px-3">
              <Search size={18} className="shrink-0 text-ink-subtle" />
              <span className="sr-only">筛选搜索结果</span>
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                className="h-10 min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-slate-400"
                placeholder="在当前结果中搜索标题、摘要、发布机构或标签"
              />
            </label>
            <div className="flex flex-wrap items-center gap-1.5 border-t border-outline pt-2 sm:border-l sm:border-t-0 sm:pl-2 sm:pt-0">
              <Filter size={15} className="ml-1 text-ink-subtle" />
              {['全部', '报告', '新闻', '网页'].map((filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setActiveFilter(filter)}
                  className={`focus-ring rounded-full px-3 py-2 text-xs font-semibold transition ${
                    activeFilter === filter
                      ? 'bg-primary text-white'
                      : 'text-ink-muted hover:bg-slate-100'
                  }`}
                >
                  {filter}
                </button>
              ))}
            </div>
          </div>

          <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.08fr)_minmax(380px,0.92fr)]">
            <section className="surface-card flex min-h-[660px] flex-col overflow-hidden">
              <div className="flex items-center justify-between border-b border-outline px-5 py-4 sm:px-6">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-soft text-primary-deep">
                    <Bot size={18} />
                  </span>
                  <div>
                    <h2 className="text-base font-semibold text-ink">研究洞察生成</h2>
                    <p className="text-[11px] text-ink-subtle">{state.task.title}</p>
                  </div>
                </div>
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                  state.searchMode === 'real'
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-slate-100 text-slate-600'
                }`}>
                  <CheckCircle2 size={12} />
                  {state.searchMode === 'real' ? '真实联网研究' : '演示数据'}
                </span>
              </div>

              <div className="flex-1 p-5 sm:p-7">
                <div className="ai-response-block p-5 sm:p-6">
                  <div className="mb-3 flex items-center gap-2 text-primary-deep">
                    <Sparkles size={18} />
                    <span className="text-sm font-semibold">AI 综合摘要</span>
                  </div>
                  <p className="text-base leading-[28px] text-ink-muted">{displayedSummary}</p>
                </div>

                <div className="mt-7">
                  <h3 className="text-base font-semibold text-ink">关键发现</h3>
                  <div className="mt-4 space-y-5">
                    {displayedInsights.map((finding, index) => (
                      <div key={finding.id} className="flex gap-3">
                        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-white">
                          {index + 1}
                        </span>
                        <div>
                          <p className="text-sm font-semibold text-ink">{finding.title}</p>
                          <p className="mt-1 text-sm leading-[22px] text-ink-muted">{finding.content}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            {finding.sourceIds.length > 0 ? finding.sourceIds.map((sourceId) => (
                              <button
                                key={sourceId}
                                type="button"
                                onClick={() => openSource(sourceId)}
                                className="focus-ring rounded bg-primary-fixed px-1.5 py-0.5 text-[11px] font-semibold text-primary-deep hover:bg-blue-200"
                              >
                                查看证据来源
                              </button>
                            )) : (
                              <span className="rounded bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700">
                                证据关联待确认
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-8 flex flex-wrap gap-2">
                  {topicTags.map((tag) => <TagBadge key={tag}>{tag}</TagBadge>)}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-outline bg-slate-50 px-5 py-4 sm:px-6">
                <p className="text-xs text-ink-subtle">
                  {state.searchMode === 'real' && state.searchedAt
                    ? `搜索时间：${new Date(state.searchedAt).toLocaleString('zh-CN')}`
                    : '当前为用户主动选择的产品原型演示数据'}
                </p>
                <button type="button" onClick={() => navigate(getTaskRoute(state.task.id, 'pool'))} className="btn-primary h-9">
                  查看资料池
                  <ArrowRight size={14} />
                </button>
              </div>
            </section>

            <section>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-ink">参考来源</h2>
                  <p className="mt-0.5 text-xs text-ink-subtle">
                    共 {filteredSources.length} 条{state.searchMode === 'real' ? '真实联网' : '演示'}来源
                  </p>
                </div>
                {state.searchMode === 'real' && state.searchedAt && (
                  <span className="shrink-0 text-[11px] text-ink-subtle">
                    {new Date(state.searchedAt).toLocaleDateString('zh-CN')}
                  </span>
                )}
              </div>

              {visibleSources.length > 0 ? (
                <div className="space-y-4">
                  {visibleSources.map((source) => (
                    <SourceCard
                      key={source.id}
                      source={source}
                      isInPool={Boolean(getPoolItem(source.id))}
                      onAddToPool={addSourceToPool}
                      onOpen={openSource}
                    />
                  ))}
                  {state.searchMode === 'real'
                    && !showAllSources
                    && filteredSources.length > 8 && (
                      <button
                        type="button"
                        onClick={() => setShowAllSources(true)}
                        className="btn-secondary h-10 w-full"
                      >
                        查看更多来源（剩余 {filteredSources.length - 8} 条）
                        <ChevronDown size={15} />
                      </button>
                    )}
                </div>
              ) : (
                <div className="surface-card p-8 text-center">
                  <Search className="mx-auto text-slate-300" size={28} />
                  <p className="mt-3 text-sm font-semibold text-ink">没有匹配的当前结果</p>
                  <p className="mt-1 text-xs text-ink-subtle">尝试更短的关键词或切换来源类型。</p>
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  )
}

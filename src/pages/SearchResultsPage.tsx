import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Filter,
  RefreshCw,
  Search,
  Sparkles,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { PrototypeDataNotice } from '../components/PrototypeDataNotice'
import { SourceCard } from '../components/SourceCard'
import { TagBadge } from '../components/TagBadge'
import { useResearch } from '../context/ResearchContext'

export function SearchResultsPage() {
  const navigate = useNavigate()
  const {
    state,
    currentTopic,
    sources,
    addSourceToPool,
    getPoolItem,
    setNotice,
  } = useResearch()
  const [searchTerm, setSearchTerm] = useState(state.task.title)
  const [activeFilter, setActiveFilter] = useState('全部')

  useEffect(() => {
    setSearchTerm(state.task.title)
  }, [state.task.id, state.task.title])

  const filteredSources = useMemo(() => {
    const byKind =
      activeFilter === '全部'
        ? sources
        : sources.filter((source) => {
            if (activeFilter === '报告') return source.type === 'report' || source.type === 'pdf'
            if (activeFilter === '新闻') return source.type === 'news'
            return source.type === 'web'
          })
    const keyword = searchTerm.trim().toLowerCase()
    if (!keyword || keyword === state.task.title.toLowerCase()) return byKind
    return byKind.filter(
      (source) =>
        source.title.toLowerCase().includes(keyword) ||
        source.summary.toLowerCase().includes(keyword) ||
        source.tags.some((tag) => tag.toLowerCase().includes(keyword)),
    )
  }, [activeFilter, searchTerm, sources, state.task.title])

  const topicTags = useMemo(
    () => [...new Set(sources.flatMap((source) => source.tags))].slice(0, 4),
    [sources],
  )

  if (!state.researchPlan) return <Navigate to="/" replace />
  if (!state.researchPlan.confirmedAt) return <Navigate to="/plan" replace />

  const openSource = (sourceId: string) => {
    navigate(`/sources/${sourceId}`, { state: { from: '/search' } })
  }

  return (
    <div className="page-shell">
      <section className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="section-label">Research Discovery</span>
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary-deep">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
              AI 分析完成
            </span>
          </div>
          <h1 className="text-2xl font-semibold leading-8 tracking-[-0.01em] text-ink">AI 搜索</h1>
          <p className="mt-1 text-sm text-ink-muted">
            已为“{state.task.title}”找到 {sources.length} 条高相关候选来源。
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/pool')}
          className="btn-secondary h-10 self-start px-4 xl:self-auto"
        >
          查看资料池
          <ArrowRight size={15} />
        </button>
      </section>

      {currentTopic.usesPrototypeData && (
        <PrototypeDataNotice topic={state.task.title} className="mb-5" />
      )}

      <div className="surface-card mb-6 flex flex-col gap-2 p-2 sm:flex-row sm:items-center sm:rounded-xl">
        <label className="flex min-w-0 flex-1 items-center gap-3 px-3">
          <Search size={18} className="shrink-0 text-ink-subtle" />
          <span className="sr-only">筛选搜索结果</span>
          <input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            className="h-10 min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-slate-400"
            placeholder="在当前结果中搜索标题、摘要或标签"
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
                <p className="text-[11px] text-ink-subtle">基于多来源交叉整理</p>
              </div>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
              <CheckCircle2 size={12} />
              分析完成
            </span>
          </div>

          <div className="flex-1 p-5 sm:p-7">
            <div className="ai-response-block p-5 sm:p-6">
              <div className="mb-3 flex items-center gap-2 text-primary-deep">
                <Sparkles size={18} />
                <span className="text-sm font-semibold">AI 综合摘要</span>
              </div>
              <p className="text-base leading-[28px] text-ink-muted">
                {currentTopic.summary}
              </p>
            </div>

            <div className="mt-7">
              <h3 className="text-base font-semibold text-ink">关键发现</h3>
              <div className="mt-4 space-y-5">
                {currentTopic.insights.map((finding, index) => (
                  <div key={finding.title} className="flex gap-3">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-white">
                      {index + 1}
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-ink">{finding.title}</p>
                      <p className="mt-1 text-sm leading-[22px] text-ink-muted">
                        {finding.description}{' '}
                        <button
                          type="button"
                          onClick={() => openSource(finding.sourceId)}
                          className="focus-ring rounded bg-primary-fixed px-1.5 py-0.5 text-[11px] font-semibold text-primary-deep hover:bg-blue-200"
                        >
                          [{index + 1}]
                        </button>
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-8 flex flex-wrap gap-2">
              {topicTags.map((tag) => (
                <TagBadge key={tag}>{tag}</TagBadge>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap justify-end gap-2 border-t border-outline bg-slate-50 px-5 py-4 sm:px-6">
            <button
              type="button"
              onClick={() => setNotice('AI 洞察已根据当前来源重新整理。')}
              className="btn-secondary"
            >
              <RefreshCw size={14} />
              重新生成
            </button>
            <button type="button" onClick={() => navigate('/pool')} className="btn-primary h-9">
              查看资料池
              <ArrowRight size={14} />
            </button>
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-ink">参考来源</h2>
              <p className="mt-0.5 text-xs text-ink-subtle">
                当前显示 {filteredSources.length} 条结果
              </p>
            </div>
          </div>

          {filteredSources.length > 0 ? (
            <div className="space-y-4">
              {filteredSources.map((source) => (
                <SourceCard
                  key={source.id}
                  source={source}
                  isInPool={Boolean(getPoolItem(source.id))}
                  onAddToPool={addSourceToPool}
                  onOpen={openSource}
                />
              ))}
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
  )
}

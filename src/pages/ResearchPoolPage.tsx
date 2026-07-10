import {
  ArrowRight,
  BarChart3,
  Database,
  Filter,
  ListTree,
  Search,
  ShieldCheck,
  Tags,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PrototypeDataNotice } from '../components/PrototypeDataNotice'
import { ResearchPoolCard } from '../components/ResearchPoolCard'
import { StatusBadge } from '../components/StatusBadge'
import { TagBadge } from '../components/TagBadge'
import { useResearch } from '../context/ResearchContext'
import type { ReviewStatus } from '../types'

const filterOptions: Array<{ label: string; value: 'all' | ReviewStatus }> = [
  { label: '全部', value: 'all' },
  { label: '可信', value: 'trusted' },
  { label: '存疑', value: 'questionable' },
  { label: '待评估', value: 'unreviewed' },
  { label: '无关', value: 'irrelevant' },
]

export function ResearchPoolPage() {
  const navigate = useNavigate()
  const {
    poolSources,
    eligibleSources,
    currentTopic,
    setReviewStatus,
    generateOutline,
  } = useResearch()
  const [filter, setFilter] = useState<'all' | ReviewStatus>('all')

  const filteredSources = useMemo(
    () =>
      filter === 'all'
        ? poolSources
        : poolSources.filter(({ item }) => item.reviewStatus === filter),
    [filter, poolSources],
  )

  const counts = useMemo(() => {
    const result: Record<ReviewStatus, number> = {
      unreviewed: 0,
      trusted: 0,
      questionable: 0,
      irrelevant: 0,
    }
    poolSources.forEach(({ item }) => {
      result[item.reviewStatus] += 1
    })
    return result
  }, [poolSources])

  const tagCounts = useMemo(() => {
    const countsByTag = new Map<string, number>()
    poolSources.forEach(({ source }) => {
      source.tags.forEach((tag) => countsByTag.set(tag, (countsByTag.get(tag) ?? 0) + 1))
    })
    return [...countsByTag.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  }, [poolSources])

  const reviewedCount = poolSources.length - counts.unreviewed
  const reviewedPercent = poolSources.length
    ? Math.round((reviewedCount / poolSources.length) * 100)
    : 0
  const trustedPercent = poolSources.length
    ? Math.round((counts.trusted / poolSources.length) * 100)
    : 0

  const handleGenerateOutline = () => {
    if (generateOutline()) navigate('/outline')
  }

  return (
    <div className="page-shell">
      <section className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <span className="section-label">Curated Knowledge</span>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold leading-8 tracking-[-0.01em] text-ink">资料池</h1>
            <span className="rounded-full bg-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600">
              {poolSources.length} 项
            </span>
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            先判断资料是否可信、存疑或无关，再用可用资料生成研究大纲。
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => navigate('/search')} className="btn-secondary h-10 px-4">
            <Search size={15} />
            继续添加资料
          </button>
          <button
            type="button"
            onClick={handleGenerateOutline}
            disabled={eligibleSources.length === 0}
            className="btn-primary"
          >
            <ListTree size={16} />
            生成研究大纲
            <span className="rounded bg-white/15 px-1.5 py-0.5 text-[10px]">
              {eligibleSources.length}
            </span>
          </button>
        </div>
      </section>

      {currentTopic.usesPrototypeData && (
        <PrototypeDataNotice topic={currentTopic.topic} className="mb-5" />
      )}

      <div className="mb-5 flex items-center gap-2 overflow-x-auto pb-1">
        <Filter size={15} className="shrink-0 text-ink-subtle" />
        {filterOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setFilter(option.value)}
            className={`focus-ring inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
              filter === option.value
                ? 'border-primary bg-primary text-white'
                : 'border-outline bg-white text-ink-muted hover:border-slate-300'
            }`}
          >
            {option.label}
            {option.value !== 'all' && (
              <span className={filter === option.value ? 'text-blue-100' : 'text-ink-subtle'}>
                {counts[option.value]}
              </span>
            )}
          </button>
        ))}
      </div>

      {poolSources.length === 0 ? (
        <section className="surface-card flex min-h-[480px] flex-col items-center justify-center p-8 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <Database size={26} />
          </span>
          <h2 className="mt-5 text-lg font-semibold text-ink">资料池还是空的</h2>
          <p className="mt-2 max-w-md text-sm leading-[22px] text-ink-muted">
            研究大纲只能使用资料池中的来源。请先从 AI 搜索结果中选择至少一条可用资料。
          </p>
          <button type="button" onClick={() => navigate('/search')} className="btn-primary mt-6">
            前往 AI 搜索
            <ArrowRight size={15} />
          </button>
        </section>
      ) : (
        <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
          <section>
            {filteredSources.length > 0 ? (
              <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                {filteredSources.map(({ source, item }) => (
                  <ResearchPoolCard
                    key={source.id}
                    source={source}
                    item={item}
                    onReviewStatusChange={setReviewStatus}
                    onOpen={(sourceId) =>
                      navigate(`/sources/${sourceId}`, { state: { from: '/pool' } })
                    }
                  />
                ))}
              </div>
            ) : (
              <div className="surface-card p-10 text-center">
                <Filter size={26} className="mx-auto text-slate-300" />
                <p className="mt-3 text-sm font-semibold text-ink">当前筛选下没有资料</p>
                <button
                  type="button"
                  onClick={() => setFilter('all')}
                  className="focus-ring mt-2 rounded-md text-xs font-semibold text-primary-deep hover:underline"
                >
                  查看全部资料
                </button>
              </div>
            )}
          </section>

          <aside className="space-y-4 xl:sticky xl:top-20 xl:self-start">
            <section className="surface-card p-5">
              <div className="mb-5 flex items-center gap-2">
                <BarChart3 size={18} className="text-primary" />
                <h2 className="text-base font-semibold text-ink">资料统计</h2>
              </div>

              <div className="space-y-5">
                <div>
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="inline-flex items-center gap-1.5 text-ink-muted">
                      <ShieldCheck size={15} />
                      已完成人工判断
                    </span>
                    <span className="font-semibold text-ink">{reviewedPercent}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${reviewedPercent}%` }}
                    />
                  </div>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="text-ink-muted">标记为可信</span>
                    <span className="font-semibold text-ink">{trustedPercent}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all"
                      style={{ width: `${trustedPercent}%` }}
                    />
                  </div>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-2 border-t border-outline pt-5">
                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="text-[11px] text-ink-subtle">可用于大纲</p>
                  <p className="mt-1 text-xl font-semibold text-ink">{eligibleSources.length}</p>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="text-[11px] text-ink-subtle">排除无关</p>
                  <p className="mt-1 text-xl font-semibold text-ink">{counts.irrelevant}</p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-1.5">
                <StatusBadge value="trusted" label={`可信 ${counts.trusted}`} />
                <StatusBadge value="questionable" label={`存疑 ${counts.questionable}`} />
                <StatusBadge value="unreviewed" label={`待评估 ${counts.unreviewed}`} />
              </div>
            </section>

            <section className="surface-card p-5">
              <div className="mb-4 flex items-center gap-2">
                <Tags size={18} className="text-primary" />
                <h2 className="text-base font-semibold text-ink">标签分布</h2>
              </div>
              <div className="flex flex-wrap gap-2">
                {tagCounts.map(([tag, count], index) => (
                  <TagBadge key={tag} active={index === 0}>
                    {tag} · {count}
                  </TagBadge>
                ))}
              </div>
            </section>
          </aside>
        </div>
      )}
    </div>
  )
}

import {
  ArrowLeft,
  Check,
  CircleMinus,
  FileText,
  Lightbulb,
  Save,
  TriangleAlert,
} from 'lucide-react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { PrototypeDataNotice } from '../components/PrototypeDataNotice'
import { SourceDetailPanel } from '../components/SourceDetailPanel'
import { StatusBadge } from '../components/StatusBadge'
import { getTaskRoute, useResearch } from '../context/ResearchContext'
import type { ReviewStatus } from '../types'

const reviewActions: Array<{
  value: Exclude<ReviewStatus, 'unreviewed'>
  label: string
  icon: typeof Check
}> = [
  { value: 'trusted', label: '可信', icon: Check },
  { value: 'questionable', label: '存疑', icon: TriangleAlert },
  { value: 'irrelevant', label: '无关', icon: CircleMinus },
]

export function SourceDetailPage() {
  const { sourceId = '' } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const {
    state,
    getSource,
    getPoolItem,
    addSourceToPool,
    setReviewStatus,
    updateNote,
  } = useResearch()
  const source = getSource(sourceId)
  const poolItem = getPoolItem(sourceId)
  const sourceRoute = (location.state as { from?: string } | null)?.from
  const currentTaskPrefix = `/tasks/${encodeURIComponent(state.task.id)}/`
  const backPath = sourceRoute?.startsWith(currentTaskPrefix)
    ? sourceRoute
    : getTaskRoute(state.task.id, 'pool')
  const backLabel = sourceRoute?.endsWith('/search')
    ? '返回 AI 搜索'
    : sourceRoute?.endsWith('/report')
      ? '返回研究报告'
      : sourceRoute?.endsWith('/outline')
        ? '返回研究大纲'
      : '返回资料池'

  if (!source) {
    return (
      <div className="page-shell flex min-h-[70vh] items-center justify-center">
        <div className="surface-card max-w-md p-8 text-center">
          <FileText size={30} className="mx-auto text-slate-300" />
          <h1 className="mt-3 text-lg font-semibold text-ink">未找到该来源</h1>
          <button type="button" onClick={() => navigate(getTaskRoute(state.task.id, 'search'))} className="btn-primary mt-5">
            返回 AI 搜索
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="page-shell">
      <button
        type="button"
        onClick={() => navigate(backPath)}
        className="focus-ring mb-5 inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-ink-muted hover:text-primary-deep"
      >
        <ArrowLeft size={16} />
        {backLabel}
      </button>

      {source.origin === 'mock' && (
        <PrototypeDataNotice topic={source.title} className="mb-5" />
      )}

      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.65fr)]">
        <SourceDetailPanel
          source={source}
          isInPool={Boolean(poolItem)}
          onAddToPool={addSourceToPool}
        />

        <aside className="space-y-5">
          <section className="surface-card overflow-hidden">
            <div className="flex items-center gap-2 border-b border-outline px-5 py-4">
              <Lightbulb size={18} className="text-primary" />
              <h2 className="text-base font-semibold text-ink">AI 提取关键洞察</h2>
            </div>
            <div className="space-y-4 p-5">
              {source.insights.map((insight, index) => (
                <div key={insight} className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-white">
                    {index + 1}
                  </span>
                  <p className="text-sm leading-[22px] text-ink-muted">{insight}</p>
                </div>
              ))}
            </div>
          </section>

          {poolItem && (
            <section className="surface-card p-5">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-ink">资料池判断</h2>
                  <p className="mt-0.5 text-[11px] text-ink-subtle">无关资料不会进入研究大纲</p>
                </div>
                <StatusBadge value={poolItem.reviewStatus} />
              </div>
              <div className="grid grid-cols-3 gap-2">
                {reviewActions.map((action) => {
                  const Icon = action.icon
                  const active = poolItem.reviewStatus === action.value
                  return (
                    <button
                      key={action.value}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setReviewStatus(source.id, action.value)}
                      className={`focus-ring inline-flex h-9 items-center justify-center gap-1 rounded-md border text-xs font-semibold transition ${
                        active
                          ? 'border-blue-200 bg-blue-50 text-primary-deep'
                          : 'border-outline bg-white text-ink-muted hover:bg-slate-50'
                      }`}
                    >
                      <Icon size={13} />
                      {action.label}
                    </button>
                  )
                })}
              </div>
            </section>
          )}

          <section className="surface-card overflow-hidden">
            <div className="flex items-center justify-between border-b border-outline px-5 py-4">
              <div className="flex items-center gap-2">
                <Save size={17} className="text-primary" />
                <h2 className="text-sm font-semibold text-ink">研究笔记</h2>
              </div>
              <span className="text-[11px] text-ink-subtle">自动保存</span>
            </div>
            <textarea
              value={poolItem?.note ?? ''}
              onChange={(event) => {
                if (poolItem) updateNote(source.id, event.target.value)
              }}
              disabled={!poolItem}
              placeholder={
                poolItem
                  ? '记录对这条来源的判断、引用计划或待验证事项…'
                  : '加入资料池后可记录研究笔记。'
              }
              className="min-h-[220px] w-full resize-none bg-white p-5 text-sm leading-[22px] text-ink outline-none placeholder:text-slate-400 disabled:bg-slate-50"
            />
            <div className="border-t border-outline bg-slate-50 px-5 py-3 text-right">
              <button type="button" onClick={() => navigate(getTaskRoute(state.task.id, 'pool'))} className="btn-secondary">
                返回资料池
              </button>
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}

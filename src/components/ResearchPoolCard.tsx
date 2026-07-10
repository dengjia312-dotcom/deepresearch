import {
  AlertTriangle,
  CalendarDays,
  Check,
  ChevronRight,
  CircleMinus,
  FileText,
} from 'lucide-react'
import type { ResearchPoolItem, ReviewStatus, Source } from '../types'
import { StatusBadge } from './StatusBadge'
import { TagBadge } from './TagBadge'

interface ResearchPoolCardProps {
  source: Source
  item: ResearchPoolItem
  onReviewStatusChange: (sourceId: string, status: ReviewStatus) => void
  onOpen: (sourceId: string) => void
}

const reviewOptions: Array<{
  value: Exclude<ReviewStatus, 'unreviewed'>
  label: string
  icon: typeof Check
  activeClass: string
}> = [
  {
    value: 'trusted',
    label: '可信',
    icon: Check,
    activeClass: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  },
  {
    value: 'questionable',
    label: '存疑',
    icon: AlertTriangle,
    activeClass: 'border-amber-300 bg-amber-50 text-amber-700',
  },
  {
    value: 'irrelevant',
    label: '无关',
    icon: CircleMinus,
    activeClass: 'border-slate-300 bg-slate-100 text-slate-700',
  },
]

export function ResearchPoolCard({
  source,
  item,
  onReviewStatusChange,
  onOpen,
}: ResearchPoolCardProps) {
  return (
    <article
      className={`surface-card flex min-h-[300px] flex-col p-5 transition duration-200 hover:-translate-y-0.5 hover:shadow-ambient ${
        item.reviewStatus === 'irrelevant' ? 'opacity-70' : ''
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-deep">
          <FileText size={19} />
        </span>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => onOpen(source.id)}
            className="focus-ring line-clamp-2 rounded-md text-left text-base font-semibold leading-6 text-ink hover:text-primary-deep"
          >
            {source.title}
          </button>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-ink-subtle">
            <span>{source.publisher}</span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1">
              <CalendarDays size={12} />
              {source.publishDate}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {source.tags.slice(0, 2).map((tag) => (
          <TagBadge key={tag}>{tag}</TagBadge>
        ))}
        <StatusBadge value={source.credibility} />
      </div>

      <div className="my-5 flex-1 rounded-lg border border-slate-200 bg-slate-50 p-4">
        <p className="line-clamp-4 text-sm leading-[22px] text-ink-muted">
          {source.keyInsight}
        </p>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-ink-subtle">
            人工判断
          </span>
          <StatusBadge value={item.reviewStatus} />
        </div>
        <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="资料判断">
          {reviewOptions.map((option) => {
            const Icon = option.icon
            const active = item.reviewStatus === option.value
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={active}
                onClick={() => onReviewStatusChange(source.id, option.value)}
                className={`focus-ring inline-flex h-9 items-center justify-center gap-1 rounded-md border text-xs font-semibold transition ${
                  active
                    ? option.activeClass
                    : 'border-outline bg-white text-ink-muted hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <Icon size={13} />
                {option.label}
              </button>
            )
          })}
        </div>
        <button
          type="button"
          onClick={() => onOpen(source.id)}
          className="focus-ring mt-3 inline-flex w-full items-center justify-center gap-1 rounded-md py-1.5 text-xs font-semibold text-primary-deep hover:bg-blue-50"
        >
          查看来源详情
          <ChevronRight size={14} />
        </button>
      </div>
    </article>
  )
}

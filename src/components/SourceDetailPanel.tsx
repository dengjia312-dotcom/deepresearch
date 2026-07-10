import {
  CalendarDays,
  Check,
  ExternalLink,
  FileSearch,
  Link2,
  Plus,
  Sparkles,
} from 'lucide-react'
import type { Source } from '../types'
import { StatusBadge } from './StatusBadge'
import { TagBadge } from './TagBadge'

interface SourceDetailPanelProps {
  source: Source
  isInPool: boolean
  onAddToPool: (sourceId: string) => void
}

export function SourceDetailPanel({
  source,
  isInPool,
  onAddToPool,
}: SourceDetailPanelProps) {
  return (
    <div className="space-y-5">
      <section className="surface-card p-6 lg:p-8">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="section-label">来源详情</span>
              <StatusBadge value={source.credibility} />
            </div>
            <h1 className="max-w-4xl text-2xl font-semibold leading-8 tracking-[-0.01em] text-ink">
              {source.title}
            </h1>
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink-muted">
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="focus-ring inline-flex max-w-full items-center gap-1.5 rounded-md text-primary-deep hover:underline"
              >
                <Link2 size={15} />
                <span className="max-w-[360px] truncate">{source.url}</span>
                <ExternalLink size={13} />
              </a>
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays size={15} />
                {source.publishDate}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <FileSearch size={15} />
                {source.publisher}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onAddToPool(source.id)}
            disabled={isInPool}
            className={isInPool ? 'btn-added shrink-0' : 'btn-primary shrink-0'}
          >
            {isInPool ? <Check size={16} /> : <Plus size={16} />}
            {isInPool ? '已加入资料池' : '加入资料池'}
          </button>
        </div>
      </section>

      <section className="ai-response-block p-6 lg:p-7">
        <div className="mb-3 flex items-center gap-2 text-primary-deep">
          <Sparkles size={18} />
          <h2 className="text-base font-semibold">AI 智能摘要</h2>
        </div>
        <p className="text-base leading-[28px] text-ink-muted">{source.keyInsight}</p>
        <div className="mt-5 flex flex-wrap gap-2">
          {source.tags.map((tag) => (
            <TagBadge key={tag} active>
              {tag}
            </TagBadge>
          ))}
        </div>
      </section>

      <section className="surface-card p-6 lg:p-8">
        <div className="mb-5 flex items-center gap-2 border-b border-outline pb-4">
          <FileSearch size={19} className="text-primary" />
          <h2 className="text-lg font-semibold text-ink">原文片段提取</h2>
        </div>
        <div className="space-y-5">
          {source.excerpt.map((paragraph, index) => (
            <p key={index} className="text-base leading-[28px] text-ink-muted">
              {paragraph}
            </p>
          ))}
        </div>
      </section>
    </div>
  )
}

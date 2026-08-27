import {
  ArrowUpRight,
  Check,
  FileText,
  Globe2,
  Link2,
  Newspaper,
  Plus,
} from 'lucide-react'
import type { Source, SourceKind } from '../types'
import { StatusBadge } from './StatusBadge'
import { TagBadge } from './TagBadge'

const sourceKindMeta: Record<SourceKind, { label: string; icon: typeof Globe2 }> = {
  web: { label: '网页', icon: Globe2 },
  pdf: { label: 'PDF', icon: FileText },
  news: { label: '新闻', icon: Newspaper },
  report: { label: '行业报告', icon: FileText },
  internal: { label: '内部资料', icon: FileText },
}

interface SourceCardProps {
  source: Source
  isInPool: boolean
  onAddToPool: (sourceId: string) => void
  onOpen: (sourceId: string) => void
}

export function SourceCard({
  source,
  isInPool,
  onAddToPool,
  onOpen,
}: SourceCardProps) {
  const kindMeta = sourceKindMeta[source.type]
  const KindIcon = kindMeta.icon
  const isLiveSource = source.origin === 'real'

  return (
    <article className="surface-card group relative p-5 transition duration-200 hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-ambient">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-500">
          {source.rank}
        </span>
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary-deep">
              <KindIcon size={13} aria-hidden="true" />
              {source.sourceTypeLabel || kindMeta.label}
            </span>
            <span className="text-xs text-ink-subtle">{source.freshness}</span>
            <StatusBadge value={source.credibility} />
          </div>
          {isLiveSource ? (
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="focus-ring -ml-1 block rounded-md px-1 text-left text-base font-semibold leading-6 text-ink transition hover:text-primary-deep"
            >
              {source.title}
            </a>
          ) : (
            <button
              type="button"
              onClick={() => onOpen(source.id)}
              className="focus-ring -ml-1 rounded-md px-1 text-left text-base font-semibold leading-6 text-ink transition hover:text-primary-deep"
            >
              {source.title}
            </button>
          )}
          {source.publisher && (
            <p className="mt-1 text-xs text-ink-subtle">{source.publisher}</p>
          )}
        </div>
      </div>

      <p className="mb-4 line-clamp-3 text-sm leading-[22px] text-ink-muted">
        {source.summary}
      </p>

      {isLiveSource && source.keyInsight && (
        <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50/70 p-3">
          <p className="text-[11px] font-semibold text-primary-deep">核心观点</p>
          <p className="mt-1 line-clamp-3 text-xs leading-5 text-ink-muted">
            {source.keyInsight}
          </p>
        </div>
      )}

      {isLiveSource && (
        <a
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="focus-ring mb-4 flex min-w-0 items-center gap-1.5 rounded-md text-xs text-primary-deep hover:underline"
        >
          <Link2 size={13} className="shrink-0" />
          <span className="truncate">{source.url}</span>
        </a>
      )}

      <div className="flex flex-wrap gap-1.5">
        {source.tags.slice(0, 3).map((tag) => (
          <TagBadge key={tag}>{tag}</TagBadge>
        ))}
      </div>

      <div className="mt-5 flex items-center justify-between border-t border-outline pt-4">
        {isLiveSource ? (
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="focus-ring inline-flex items-center gap-1.5 rounded-md text-xs font-semibold text-ink-muted transition hover:text-primary-deep"
          >
            打开原文
            <ArrowUpRight size={14} aria-hidden="true" />
          </a>
        ) : (
          <button
            type="button"
            onClick={() => onOpen(source.id)}
            className="focus-ring inline-flex items-center gap-1.5 rounded-md text-xs font-semibold text-ink-muted transition hover:text-primary-deep"
          >
            查看详情
            <ArrowUpRight size={14} aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          onClick={() => onAddToPool(source.id)}
          disabled={isInPool}
          className={isInPool ? 'btn-added' : 'btn-secondary text-primary-deep'}
          aria-label={isInPool ? `${source.title} 已加入资料池` : `将 ${source.title} 加入资料池`}
        >
          {isInPool ? <Check size={15} /> : <Plus size={15} />}
          {isInPool ? '已加入资料池' : '加入资料池'}
        </button>
      </div>
    </article>
  )
}

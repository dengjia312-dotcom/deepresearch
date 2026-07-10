import { ExternalLink, FileText, Quote, Sparkles } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { Source } from '../types'
import { TagBadge } from './TagBadge'

interface CitationPanelProps {
  sources: Source[]
  activeSourceId: string | null
  onSelect: (sourceId: string) => void
}

export function CitationPanel({
  sources,
  activeSourceId,
  onSelect,
}: CitationPanelProps) {
  const previousActiveSourceId = useRef(activeSourceId)

  useEffect(() => {
    if (!activeSourceId || previousActiveSourceId.current === activeSourceId) {
      previousActiveSourceId.current = activeSourceId
      return
    }
    document
      .getElementById(`citation-card-${activeSourceId}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    previousActiveSourceId.current = activeSourceId
  }, [activeSourceId])

  return (
    <aside className="surface-card overflow-hidden xl:sticky xl:top-20 xl:max-h-[calc(100dvh-96px)]">
      <div className="flex items-center justify-between border-b border-outline px-5 py-4">
        <div>
          <div className="flex items-center gap-2">
            <Quote size={18} className="text-primary" />
            <h2 className="text-base font-semibold text-ink">引用来源</h2>
          </div>
          <p className="mt-1 text-xs text-ink-subtle">正文标记与来源一一对应</p>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
          {sources.length} 条
        </span>
      </div>

      <div className="space-y-3 overflow-y-auto p-4 xl:max-h-[calc(100dvh-170px)]">
        {sources.map((source, index) => {
          const active = activeSourceId === source.id
          return (
            <button
              id={`citation-card-${source.id}`}
              key={source.id}
              type="button"
              onClick={() => onSelect(source.id)}
              className={`focus-ring w-full rounded-lg border p-4 text-left transition ${
                active
                  ? 'border-primary bg-blue-50 shadow-panel ring-1 ring-blue-100'
                  : 'border-outline bg-white hover:border-blue-200 hover:shadow-ambient'
              }`}
            >
              <div className="mb-3 flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 rounded-md bg-primary-fixed px-2 py-1 text-[11px] font-semibold text-primary-deep">
                  引用 [{index + 1}]
                </span>
                {source.type === 'pdf' ? (
                  <FileText size={15} className="text-ink-subtle" />
                ) : (
                  <ExternalLink size={15} className="text-ink-subtle" />
                )}
              </div>
              <h3 className="text-sm font-semibold leading-[22px] text-ink">
                {source.title}
              </h3>
              <p className="mt-2 line-clamp-3 text-xs leading-5 text-ink-muted">
                {source.summary}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <TagBadge>{source.publisher}</TagBadge>
                {active && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary-deep">
                    <Sparkles size={11} />
                    当前引用
                  </span>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </aside>
  )
}

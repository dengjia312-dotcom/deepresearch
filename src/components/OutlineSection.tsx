import { ChevronDown, ChevronRight, Link2 } from 'lucide-react'
import { useState } from 'react'
import type { OutlineSectionData } from '../types'

interface OutlineSectionProps {
  section: OutlineSectionData
  selectedSectionId: string
  onSelect: (sectionId: string) => void
  level?: number
}

export function OutlineSection({
  section,
  selectedSectionId,
  onSelect,
  level = 0,
}: OutlineSectionProps) {
  const [expanded, setExpanded] = useState(true)
  const hasChildren = section.children.length > 0
  const selected = selectedSectionId === section.id

  return (
    <div className={level > 0 ? 'ml-5 border-l border-slate-200 pl-3' : ''}>
      <div
        className={`group flex items-center gap-2 rounded-lg border px-3 py-2.5 transition ${
          selected
            ? 'border-blue-200 bg-blue-50 text-primary-deep'
            : 'border-transparent text-ink hover:border-slate-200 hover:bg-slate-50'
        }`}
      >
        {hasChildren ? (
          <button
            type="button"
            aria-label={expanded ? `收起 ${section.title}` : `展开 ${section.title}`}
            onClick={() => setExpanded((value) => !value)}
            className="focus-ring flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-subtle hover:bg-white"
          >
            {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </button>
        ) : (
          <span className="flex h-6 w-6 shrink-0 items-center justify-center" aria-hidden="true">
            <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
          </span>
        )}

        <button
          type="button"
          onClick={() => onSelect(section.id)}
          className={`focus-ring min-w-0 flex-1 rounded-md text-left ${
            level === 0 ? 'text-base font-semibold' : 'text-sm font-medium'
          }`}
        >
          {section.title}
        </button>

        <span
          className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold ${
            selected ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600'
          }`}
        >
          <Link2 size={11} />
          {section.sourceIds.length}
        </span>
      </div>

      {hasChildren && expanded && (
        <div className="mt-1.5 space-y-1.5">
          {section.children.map((child) => (
            <OutlineSection
              key={child.id}
              section={child}
              selectedSectionId={selectedSectionId}
              onSelect={onSelect}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  )
}

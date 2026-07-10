import type { ReactNode } from 'react'

interface TagBadgeProps {
  children: ReactNode
  active?: boolean
  className?: string
}

export function TagBadge({ children, active = false, className = '' }: TagBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-1 text-[11px] font-semibold leading-none tracking-[0.01em] ${
        active
          ? 'border-blue-200 bg-blue-50 text-blue-700'
          : 'border-slate-200 bg-slate-50 text-slate-600'
      } ${className}`}
    >
      {children}
    </span>
  )
}

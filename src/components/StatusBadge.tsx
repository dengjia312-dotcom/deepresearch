import type { ReactNode } from 'react'

type Tone = 'info' | 'success' | 'warning' | 'neutral' | 'danger'

const labelMap: Record<string, string> = {
  draft: '规划中',
  searching: 'AI 搜索中',
  collecting: '资料整理中',
  outlined: '大纲已生成',
  reported: '报告已生成',
  high: '高可信度',
  medium: '中等可信度',
  low: '低可信度',
  unverified: '待评估',
  trusted: '可信',
  questionable: '存疑',
  irrelevant: '无关',
  unreviewed: '待评估',
}

const toneMap: Record<string, Tone> = {
  draft: 'neutral',
  searching: 'info',
  collecting: 'info',
  outlined: 'success',
  reported: 'success',
  high: 'success',
  medium: 'warning',
  low: 'danger',
  unverified: 'neutral',
  trusted: 'success',
  questionable: 'warning',
  irrelevant: 'neutral',
  unreviewed: 'neutral',
}

const classes: Record<Tone, string> = {
  info: 'border-blue-200 bg-blue-50 text-blue-700',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-700',
  neutral: 'border-slate-200 bg-slate-100 text-slate-600',
  danger: 'border-red-200 bg-red-50 text-red-700',
}

interface StatusBadgeProps {
  value: string
  label?: string
  tone?: Tone
  icon?: ReactNode
  className?: string
}

export function StatusBadge({
  value,
  label,
  tone,
  icon,
  className = '',
}: StatusBadgeProps) {
  const resolvedTone = tone ?? toneMap[value] ?? 'neutral'

  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold leading-none ${classes[resolvedTone]} ${className}`}
    >
      {icon}
      {label ?? labelMap[value] ?? value}
    </span>
  )
}

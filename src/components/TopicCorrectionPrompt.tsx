import { Sparkles } from 'lucide-react'
import type { TopicCorrection } from '../types'

export interface TopicCorrectionPromptProps {
  correction: TopicCorrection
  onAccept: () => void
  onKeep: () => void
  disabled?: boolean
  className?: string
}

export function TopicCorrectionPrompt({
  correction,
  onAccept,
  onKeep,
  disabled = false,
  className = '',
}: TopicCorrectionPromptProps) {
  return (
    <div
      className={`ai-response-block flex flex-col gap-4 p-4 text-left sm:flex-row sm:items-center sm:justify-between ${className}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-primary-deep shadow-panel ring-1 ring-blue-100">
          <Sparkles size={17} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-[22px] text-ink">
            检测到你可能想研究“{correction.suggestedTopic}”，是否按该主题继续？
          </p>
          <p className="mt-0.5 text-xs leading-5 text-ink-subtle">
            原始输入为“{correction.inputTopic}”，你也可以保留原输入创建研究计划。
          </p>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
        <button
          type="button"
          onClick={onKeep}
          disabled={disabled}
          className="btn-secondary h-9 disabled:cursor-not-allowed disabled:opacity-60"
        >
          保留“{correction.inputTopic}”
        </button>
        <button
          type="button"
          onClick={onAccept}
          disabled={disabled}
          className="btn-primary h-9"
        >
          按“{correction.suggestedTopic}”继续
        </button>
      </div>
    </div>
  )
}

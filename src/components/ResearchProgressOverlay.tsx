import { Check, Circle, LoaderCircle, Sparkles } from 'lucide-react'

export const researchProgressSteps = [
  '正在理解研究主题',
  '正在制定研究计划',
  '正在检索多来源资料',
  '正在整理研究洞察',
] as const

export const RESEARCH_STEP_DURATION_MS = 550

interface ResearchProgressOverlayProps {
  topic: string
  activeIndex: number
}

export function ResearchProgressOverlay({
  topic,
  activeIndex,
}: ResearchProgressOverlayProps) {
  const progress = ((activeIndex + 1) / researchProgressSteps.length) * 100

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-sm">
      <section
        className="w-full max-w-lg rounded-xl border border-white/70 bg-white p-6 shadow-ambient sm:p-7"
        role="status"
        aria-live="polite"
      >
        <div className="flex items-start gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-white shadow-panel">
            <Sparkles size={21} />
          </span>
          <div className="min-w-0">
            <span className="section-label">Research in progress</span>
            <h2 className="mt-1 text-lg font-semibold text-ink">正在准备研究工作区</h2>
            <p className="mt-1 line-clamp-2 text-sm leading-[22px] text-ink-muted">{topic}</p>
          </div>
        </div>

        <div className="mt-6 space-y-2.5">
          {researchProgressSteps.map((step, index) => {
            const completed = index < activeIndex
            const active = index === activeIndex
            return (
              <div
                key={step}
                aria-current={active ? 'step' : undefined}
                className={`flex items-center gap-3 rounded-lg border px-3.5 py-3 transition ${
                  active
                    ? 'border-blue-200 bg-blue-50 text-primary-deep'
                    : completed
                      ? 'border-emerald-100 bg-emerald-50/70 text-emerald-700'
                      : 'border-transparent text-ink-subtle'
                }`}
              >
                {active ? (
                  <LoaderCircle size={17} className="animate-spin" />
                ) : completed ? (
                  <span className="flex h-[17px] w-[17px] items-center justify-center rounded-full bg-emerald-500 text-white">
                    <Check size={11} />
                  </span>
                ) : (
                  <Circle size={17} className="text-slate-300" />
                )}
                <span className="text-sm font-medium">{step}</span>
              </div>
            )
          })}
        </div>

        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between text-[11px] font-medium text-ink-subtle">
            <span>步骤 {activeIndex + 1} / {researchProgressSteps.length}</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <div
            className="h-1.5 overflow-hidden rounded-full bg-slate-100"
            role="progressbar"
            aria-label="研究准备进度"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          >
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </section>
    </div>
  )
}

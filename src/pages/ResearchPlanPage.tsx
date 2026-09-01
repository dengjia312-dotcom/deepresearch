import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock3,
  Database,
  FileSearch,
  ListChecks,
  LoaderCircle,
  Plus,
  RefreshCw,
  Sparkles,
  Target,
  Trash2,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { PrototypeDataNotice } from '../components/PrototypeDataNotice'
import { getTaskRoute, useResearch } from '../context/ResearchContext'
import { sourcePreferenceOptions } from '../data/researchPlans'
import type { SearchDepth } from '../types'

const workflowSteps = ['主题确认', '研究计划', 'AI 搜索'] as const
const searchDepthOptions: Array<{
  value: SearchDepth
  label: string
  count: number | null
}> = [
  { value: 'concise', label: '精简', count: 8 },
  { value: 'standard', label: '标准', count: 12 },
  { value: 'deep', label: '深度', count: 16 },
  { value: 'custom', label: '自定义', count: null },
]

export function ResearchPlanPage() {
  const navigate = useNavigate()
  const {
    state,
    updatePlanScope,
    updatePlanQuestion,
    addPlanQuestion,
    removePlanQuestion,
    toggleSourcePreference,
    setSearchConfig,
    confirmResearchIntent,
    confirmResearchPlan,
    retryResearchPlan,
    useMockPlan,
    setNotice,
  } = useResearch()
  const plan = state.researchPlan
  const [isResearching, setIsResearching] = useState(false)
  const [confirmingIntent, setConfirmingIntent] = useState(false)
  const [showCustomDirection, setShowCustomDirection] = useState(false)
  const [customDirection, setCustomDirection] = useState('')

  if (!plan) {
    return (
      <div className="page-shell flex min-h-[calc(100dvh-56px)] items-center justify-center py-10">
        <section className="surface-card w-full max-w-2xl p-8 text-center sm:p-10">
          {state.planStatus === 'loading' ? (
            <>
              <LoaderCircle size={30} className="mx-auto animate-spin text-primary" />
              <span className="section-label mt-5 inline-block">Research Planning</span>
              <h1 className="mt-2 text-2xl font-semibold text-ink">正在生成真实研究计划</h1>
              <p className="mt-3 text-sm text-ink-muted">
                AI 正在根据“{state.task.title}”生成研究目标、研究范围与核心问题。
              </p>
            </>
          ) : (
            <>
              <span className="section-label">Research Planning</span>
              <h1 className="mt-2 text-2xl font-semibold text-ink">研究计划生成失败</h1>
              <p className="mt-3 text-sm leading-6 text-rose-700">
                {state.planError ?? '研究计划尚未生成，请重试。'}
              </p>
              <p className="mt-2 text-xs text-ink-subtle">
                主题“{state.task.title}”已保留，不会自动填充占位计划。
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                <button type="button" onClick={() => void retryResearchPlan()} className="btn-primary">
                  <RefreshCw size={15} />
                  重新生成
                </button>
                <button type="button" onClick={useMockPlan} className="btn-secondary h-10 px-4">
                  使用演示计划
                </button>
                <button type="button" onClick={() => navigate('/')} className="btn-secondary h-10 px-4">
                  返回修改主题
                </button>
              </div>
              <p className="mt-3 text-xs text-ink-subtle">
                演示计划只会在你主动选择后加载。
              </p>
            </>
          )}
        </section>
      </div>
    )
  }

  const hasIncompleteQuestion = plan.questions.some(
    (question) => !question.text.trim(),
  )
  const canStart = Boolean(
    plan.scope.trim()
      && plan.questions.length > 0
      && !hasIncompleteQuestion
      && plan.sourcePreferences.length > 0
      && plan.intentConfirmation?.status !== 'pending',
  )

  const intentConfirmation = plan.intentConfirmation

  const submitIntentConfirmation = async (
    input: { candidateId: string } | { customDirection: string },
  ) => {
    if (confirmingIntent) return
    setConfirmingIntent(true)
    const confirmed = await confirmResearchIntent(input)
    setConfirmingIntent(false)
    if (confirmed) {
      setShowCustomDirection(false)
      setCustomDirection('')
    }
  }

  const handleStartResearch = async () => {
    if (!plan.scope.trim()) {
      setNotice('请先补充研究范围。')
      return
    }
    if (plan.questions.length === 0 || hasIncompleteQuestion) {
      setNotice('请至少保留并完善一个核心研究问题。')
      return
    }
    if (plan.sourcePreferences.length === 0) {
      setNotice('请至少选择一种来源偏好。')
      return
    }
    setIsResearching(true)
    const confirmed = await confirmResearchPlan()
    setIsResearching(false)
    if (confirmed) navigate(getTaskRoute(state.task.id, 'search'))
  }

  return (
    <div className="page-shell">
      <section className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <span className="section-label">Research Planning</span>
          <h1 className="mt-2 text-2xl font-semibold leading-8 tracking-[-0.01em] text-ink">
            确认研究计划
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            确认研究范围与核心问题后，AI 将据此检索和整理候选来源。
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/')}
          disabled={isResearching}
          className="btn-secondary h-10 self-start px-4 xl:self-auto"
        >
          <ArrowLeft size={15} />
          返回修改主题
        </button>
      </section>

      {state.planStatus === 'loading' && (
        <section className="ai-response-block mb-5 p-4" aria-live="polite">
          <p className="text-sm font-semibold text-ink">正在重新生成研究计划</p>
          <p className="mt-1 text-xs text-ink-muted">新计划生成前，上次成功计划会继续保留。</p>
        </section>
      )}

      {state.planStatus === 'error' && state.planError && (
        <section className="mb-5 rounded-lg border border-rose-200 bg-rose-50 p-4" role="alert">
          <p className="text-sm font-semibold text-rose-800">本次计划生成失败，上次成功计划已保留。</p>
          <p className="mt-1 text-sm text-rose-700">{state.planError}</p>
          <button
            type="button"
            onClick={() => void retryResearchPlan()}
            className="btn-secondary mt-3"
          >
            <RefreshCw size={15} />
            重新生成
          </button>
        </section>
      )}

      {intentConfirmation && intentConfirmation.status !== 'not_required' && (
        <section className="surface-card mb-5 overflow-hidden border-blue-200">
          <div className="border-b border-blue-100 bg-primary-soft px-5 py-4 sm:px-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-primary-deep">
                  {intentConfirmation.status === 'confirmed'
                    ? <CheckCircle2 size={18} />
                    : <Sparkles size={18} />}
                  <h2 className="text-base font-semibold">
                    {intentConfirmation.status === 'confirmed'
                      ? '已确认研究方向'
                      : '确认研究方向'}
                  </h2>
                </div>
                {intentConfirmation.status === 'confirmed' ? (
                  <p className="mt-2 text-sm font-semibold text-ink">
                    {intentConfirmation.confirmed?.label}
                  </p>
                ) : (
                  <p className="mt-2 text-sm leading-6 text-ink-muted">
                    这个主题可能存在多种理解。为了避免研究偏离，请选择你真正想研究的方向。
                  </p>
                )}
              </div>
            </div>
          </div>

          {intentConfirmation.status === 'pending' && (
            <div className="space-y-4 p-5 sm:p-6">
              <div className="grid gap-3 lg:grid-cols-2">
                {(intentConfirmation.candidates ?? []).map((candidate) => (
                  <article key={candidate.id} className="rounded-xl border border-outline bg-white p-4">
                    <h3 className="text-sm font-semibold text-ink">{candidate.label}</h3>
                    <p className="mt-2 text-sm leading-6 text-ink-muted">{candidate.description}</p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {candidate.scope.slice(0, 5).map((scope) => (
                        <span key={scope} className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-ink-muted">
                          {scope}
                        </span>
                      ))}
                    </div>
                    <button
                      type="button"
                      disabled={confirmingIntent}
                      onClick={() => void submitIntentConfirmation({ candidateId: candidate.id })}
                      className="btn-primary mt-4 h-9 w-full disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {confirmingIntent ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} />}
                      选择这个方向
                    </button>
                  </article>
                ))}
              </div>

              <div className="rounded-lg border border-dashed border-outline p-4">
                <button
                  type="button"
                  onClick={() => setShowCustomDirection((visible) => !visible)}
                  disabled={confirmingIntent}
                  className="text-sm font-semibold text-primary-deep hover:underline"
                >
                  都不是？自定义研究方向
                </button>
                {showCustomDirection && (
                  <div className="mt-3">
                    <textarea
                      value={customDirection}
                      onChange={(event) => setCustomDirection(event.target.value)}
                      disabled={confirmingIntent}
                      rows={4}
                      maxLength={1000}
                      placeholder="说明你真正希望研究的对象、范围和重点。"
                      className="focus-ring w-full resize-y rounded-lg border border-outline px-3.5 py-3 text-sm leading-6 text-ink outline-none"
                    />
                    <button
                      type="button"
                      disabled={confirmingIntent || customDirection.trim().length < 4}
                      onClick={() => void submitIntentConfirmation({ customDirection: customDirection.trim() })}
                      className="btn-primary mt-3 h-9 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {confirmingIntent && <LoaderCircle size={14} className="animate-spin" />}
                      确认研究方向
                    </button>
                  </div>
                )}
              </div>
              {confirmingIntent && (
                <p className="text-sm font-medium text-primary-deep" aria-live="polite">
                  正在根据你的选择制定检索策略…
                </p>
              )}
            </div>
          )}
        </section>
      )}

      <ol
        className="surface-card mb-5 grid overflow-hidden sm:grid-cols-3"
        aria-label="研究任务进度"
      >
        {workflowSteps.map((step, index) => {
          const completed = index === 0
          const active = index === 1
          return (
            <li
              key={step}
              aria-current={active ? 'step' : undefined}
              className={`flex items-center gap-3 border-b border-outline px-4 py-3.5 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0 ${
                active ? 'bg-primary-soft text-primary-deep' : 'text-ink-subtle'
              }`}
            >
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                  completed
                    ? 'bg-emerald-500 text-white'
                    : active
                      ? 'bg-primary text-white'
                      : 'bg-slate-100 text-slate-500'
                }`}
              >
                {completed ? <Check size={13} /> : index + 1}
              </span>
              <span className="text-xs font-semibold">{step}</span>
            </li>
          )
        })}
      </ol>

      {state.planMode === 'mock' && (
        <PrototypeDataNotice topic={state.task.title} className="mb-5" />
      )}

      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <section className="surface-card overflow-hidden">
            <div className="flex items-center gap-3 border-b border-outline px-5 py-4 sm:px-6">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-soft text-primary-deep">
                <Target size={18} />
              </span>
              <div>
                <h2 className="text-base font-semibold text-ink">主题与研究目标</h2>
                <p className="text-[11px] text-ink-subtle">基于当前主题生成，可在下方调整执行范围</p>
              </div>
            </div>

            <div className="space-y-5 p-5 sm:p-6">
              <div>
                <p className="text-xs font-semibold text-ink-muted">标准化研究主题</p>
                <div className="mt-2 rounded-lg border border-outline bg-slate-50 px-4 py-3">
                  <p className="text-sm font-semibold text-ink">{state.task.title}</p>
                  {state.task.query !== state.task.title && (
                    <p className="mt-1 text-xs text-ink-subtle">
                      原始输入：{state.task.query}
                    </p>
                  )}
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-ink-muted">研究目标</p>
                <div className="ai-response-block mt-2 p-4">
                  <div className="mb-2 flex items-center gap-2 text-primary-deep">
                  <Sparkles size={15} />
                    <span className="text-xs font-semibold">
                      {state.planMode === 'real' ? 'AI 真实生成目标' : '演示计划目标'}
                    </span>
                  </div>
                  <p className="text-sm leading-6 text-ink-muted">{plan.objective}</p>
                </div>
              </div>
            </div>
          </section>

          <section className="surface-card overflow-hidden">
            <div className="flex items-center gap-3 border-b border-outline px-5 py-4 sm:px-6">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-ink-muted">
                <FileSearch size={18} />
              </span>
              <div>
                <h2 className="text-base font-semibold text-ink">研究范围</h2>
                <p className="text-[11px] text-ink-subtle">明确需要覆盖的市场、流程、技术或时间边界</p>
              </div>
            </div>
            <div className="p-5 sm:p-6">
              <label className="block">
                <span className="sr-only">编辑研究范围</span>
                <textarea
                  value={plan.scope}
                  onChange={(event) => updatePlanScope(event.target.value)}
                  disabled={isResearching}
                  rows={5}
                  className="focus-ring w-full resize-y rounded-lg border border-outline bg-white px-4 py-3 text-sm leading-6 text-ink outline-none transition placeholder:text-slate-400 focus:border-blue-300 disabled:cursor-not-allowed disabled:bg-slate-50"
                  placeholder="请输入研究范围"
                />
              </label>
              <p className="mt-2 text-[11px] text-ink-subtle">修改会自动保存在当前研究任务中。</p>
            </div>
          </section>

          <section className="surface-card overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-outline px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-ink-muted">
                  <ListChecks size={18} />
                </span>
                <div>
                  <h2 className="text-base font-semibold text-ink">核心研究问题</h2>
                  <p className="text-[11px] text-ink-subtle">问题将决定来源筛选与洞察整理重点</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => addPlanQuestion('')}
                disabled={isResearching || plan.questions.length >= 8}
                className="btn-secondary self-start disabled:cursor-not-allowed disabled:opacity-60 sm:self-auto"
              >
                <Plus size={14} />
                添加研究问题
              </button>
            </div>

            <div className="space-y-3 p-5 sm:p-6">
              {plan.questions.length > 0 ? (
                plan.questions.map((question, index) => (
                  <div key={question.id} className="flex items-start gap-3">
                    <span className="mt-2.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[11px] font-semibold text-primary-deep">
                      {index + 1}
                    </span>
                    <label className="min-w-0 flex-1">
                      <span className="sr-only">研究问题 {index + 1}</span>
                      <textarea
                        value={question.text}
                        onChange={(event) => updatePlanQuestion(question.id, event.target.value)}
                        disabled={isResearching}
                        rows={2}
                        className="focus-ring w-full resize-none rounded-lg border border-outline bg-white px-3.5 py-2.5 text-sm leading-[22px] text-ink outline-none transition placeholder:text-slate-400 focus:border-blue-300 disabled:cursor-not-allowed disabled:bg-slate-50"
                        placeholder="输入需要回答的核心问题"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => removePlanQuestion(question.id)}
                      disabled={isResearching}
                      className="focus-ring mt-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-subtle transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label={`删除研究问题 ${index + 1}`}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))
              ) : (
                <div className="rounded-lg border border-dashed border-outline p-6 text-center">
                  <ListChecks size={24} className="mx-auto text-slate-300" />
                  <p className="mt-2 text-sm font-semibold text-ink">尚未添加研究问题</p>
                  <p className="mt-1 text-xs text-ink-subtle">至少添加一个问题后才能开始研究。</p>
                </div>
              )}
              <p className="text-right text-[11px] text-ink-subtle">
                {plan.questions.length} / 8 个问题
              </p>
            </div>
          </section>
        </div>

        <aside className="min-w-0 xl:sticky xl:top-6 xl:self-start">
          <section className="surface-card overflow-hidden">
            <div className="border-b border-outline px-5 py-4">
              <h2 className="text-base font-semibold text-ink">检索配置</h2>
              <p className="mt-0.5 text-[11px] text-ink-subtle">选择希望优先覆盖的来源类型</p>
            </div>

            <div className="p-5">
              <div className="flex flex-wrap gap-2">
                {sourcePreferenceOptions.map((preference) => {
                  const selected = plan.sourcePreferences.includes(preference)
                  return (
                    <button
                      key={preference}
                      type="button"
                      onClick={() => toggleSourcePreference(preference)}
                      disabled={isResearching}
                      aria-pressed={selected}
                      className={`focus-ring inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                        selected
                          ? 'border-blue-200 bg-primary-soft text-primary-deep'
                          : 'border-outline bg-white text-ink-muted hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      {selected && <Check size={13} />}
                      {preference}
                    </button>
                  )
                })}
              </div>

              <div className="my-5 border-t border-outline" />

              <h3 className="text-xs font-semibold text-ink-muted">检索深度</h3>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {searchDepthOptions.map((option) => {
                  const selected = state.task.searchDepth === option.value
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setSearchConfig(
                        option.value,
                        option.count ?? state.task.targetSourceCount,
                      )}
                      className={`focus-ring rounded-lg border px-3 py-2.5 text-left transition ${
                        selected
                          ? 'border-blue-200 bg-primary-soft text-primary-deep'
                          : 'border-outline bg-white text-ink-muted hover:border-slate-300'
                      }`}
                    >
                      <span className="block text-xs font-semibold">{option.label}</span>
                      <span className="mt-0.5 block text-[11px]">
                        {option.count ? `${option.count} 条` : '8—30 条'}
                      </span>
                    </button>
                  )
                })}
              </div>
              {state.task.searchDepth === 'custom' && (
                <label className="mt-3 block">
                  <span className="text-[11px] font-medium text-ink-muted">自定义目标数量</span>
                  <input
                    type="number"
                    min={8}
                    max={30}
                    value={state.task.targetSourceCount}
                    onChange={(event) => setSearchConfig(
                      'custom',
                      Number(event.target.value) || 8,
                    )}
                    className="focus-ring mt-1 h-10 w-full rounded-lg border border-outline bg-white px-3 text-sm text-ink outline-none"
                  />
                </label>
              )}
              <p className="mt-2 text-[11px] leading-4 text-ink-subtle">
                目标数量最低 8 条；实际结果可能因 URL 去重、链接有效性和主题相关性少于目标值。
              </p>

              <div className="my-5 border-t border-outline" />

              <h3 className="text-xs font-semibold text-ink-muted">执行预估</h3>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-outline bg-slate-50 p-3.5">
                  <Database size={16} className="text-primary-deep" />
                  <p className="mt-2 text-lg font-semibold text-ink">
                    {state.task.targetSourceCount} 条
                  </p>
                  <p className="mt-0.5 text-[11px] text-ink-subtle">目标检索数量</p>
                </div>
                <div className="rounded-lg border border-outline bg-slate-50 p-3.5">
                  <Clock3 size={16} className="text-primary-deep" />
                  <p className="mt-2 text-lg font-semibold text-ink">
                    约 {plan.estimatedDurationMinutes} 分钟
                  </p>
                  <p className="mt-0.5 text-[11px] text-ink-subtle">预计耗时</p>
                </div>
              </div>

              <div className="mt-5 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-emerald-700">
                <CheckCircle2 size={15} className="shrink-0" />
                <span className="text-xs font-medium">计划修改将自动保存</span>
              </div>
            </div>

            <div className="space-y-2 border-t border-outline bg-slate-50 p-4">
              <button
                type="button"
                onClick={handleStartResearch}
                disabled={isResearching || confirmingIntent || !canStart}
                className="btn-primary h-11 w-full"
              >
                {isResearching ? '正在开始研究' : '确认并开始研究'}
                <ArrowRight size={15} />
              </button>
              {plan.intentConfirmation?.status === 'pending' ? (
                <p className="text-center text-[11px] leading-4 text-amber-700">
                  请先确认研究方向。
                </p>
              ) : !canStart && (
                <p className="text-center text-[11px] leading-4 text-ink-subtle">
                  请完善研究范围、核心问题并至少选择一种来源。
                </p>
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}

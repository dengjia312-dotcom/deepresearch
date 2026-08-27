import {
  ArrowRight,
  BookOpenCheck,
  Clock3,
  Database,
  Gauge,
  Search,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { TopicCorrectionPrompt } from '../components/TopicCorrectionPrompt'
import {
  getTaskRoute,
  type ResearchState,
  type ResearchTaskPage,
  useResearch,
} from '../context/ResearchContext'
import { getTopicCorrection, normalizeTopicInput } from '../data/researchTopics'
import type { ResearchDepth, TopicCorrection } from '../types'

const depthOptions: Array<{
  value: ResearchDepth
  label: string
  description: string
}> = [
  { value: 'quick', label: '快速概览', description: '约 2 分钟' },
  { value: 'deep', label: '深度研究', description: '约 5 分钟' },
  { value: 'professional', label: '专业分析', description: '约 15 分钟' },
]

function getResumePage(state: ResearchState): ResearchTaskPage {
  if (!state.researchPlan?.confirmedAt) return 'plan'
  if (state.reportGenerated) return 'report'
  if (state.outlineGenerated) return 'outline'
  if (state.poolItems.length > 0) return 'pool'
  return 'search'
}

function getDepthLabel(depth: ResearchDepth) {
  return depthOptions.find((option) => option.value === depth)?.label ?? '研究任务'
}

function formatTaskTime(createdAt: string) {
  const date = new Date(createdAt)
  return Number.isNaN(date.getTime())
    ? '时间未知'
    : new Intl.DateTimeFormat('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(date)
}

export function TaskCreationPage() {
  const navigate = useNavigate()
  const { prepareResearch, tasks, switchTask, databaseError, isHydrating } = useResearch()
  const [query, setQuery] = useState('')
  const [depth, setDepth] = useState<ResearchDepth>('deep')
  const [error, setError] = useState('')
  const [correction, setCorrection] = useState<TopicCorrection | null>(null)
  const [creating, setCreating] = useState(false)

  const openResearchPlan = async (originalTopic: string, selectedTopic: string) => {
    setCorrection(null)
    setCreating(true)
    const taskId = await prepareResearch(originalTopic, selectedTopic, depth)
    setCreating(false)
    if (taskId) navigate(getTaskRoute(taskId, 'plan'))
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const title = normalizeTopicInput(query)
    if (!title) {
      setError('请输入一个明确的研究主题。')
      return
    }

    const suggestion = getTopicCorrection(title)
    if (suggestion) {
      setCorrection(suggestion)
      return
    }

    void openResearchPlan(title, title)
  }

  return (
    <div className="subtle-grid relative min-h-full overflow-hidden">
      <div className="pointer-events-none absolute left-1/2 top-12 h-96 w-96 -translate-x-1/2 rounded-full bg-blue-100/50 blur-3xl" />
      <div className="page-shell relative py-10 sm:py-14 lg:py-16">
        <section className="mx-auto max-w-5xl text-center">
          <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-xl border border-blue-100 bg-white text-primary shadow-ambient">
            <BookOpenCheck size={27} />
          </div>
          <span className="section-label">AI Research Workspace</span>
          <h1 className="mt-3 text-[32px] font-bold leading-10 tracking-[-0.02em] text-ink sm:text-[38px] sm:leading-[48px]">
            开始新的研究任务
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-base leading-[26px] text-ink-muted">
            输入研究主题，AI 将检索并整理候选来源，帮助你从资料判断逐步形成可追溯的大纲与报告。
          </p>

          <form onSubmit={handleSubmit} className="mt-9 text-left">
            <div
              className={`surface-card flex flex-col gap-2 p-2 shadow-ambient transition sm:flex-row sm:items-center sm:rounded-xl ${
                error ? 'border-red-300 ring-2 ring-red-100' : 'focus-within:border-blue-300'
              }`}
            >
              <label className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 sm:py-0">
                <Search size={21} className="shrink-0 text-ink-subtle" />
                <span className="sr-only">研究主题</span>
                <input
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value)
                    setCorrection(null)
                    if (error) setError('')
                  }}
                  placeholder="请输入研究主题，例如：AI 对企业软件采购决策的影响"
                  className="h-11 min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-slate-400"
                  autoFocus
                />
              </label>
              <div className="h-px bg-outline sm:h-10 sm:w-px" />
              <label className="flex h-11 items-center gap-2 rounded-md px-3 text-sm text-ink-muted hover:bg-slate-50">
                <SlidersHorizontal size={16} />
                <span className="sr-only">研究深度</span>
                <select
                  value={depth}
                  onChange={(event) => setDepth(event.target.value as ResearchDepth)}
                  className="min-w-[120px] bg-transparent font-medium text-ink outline-none"
                >
                  {depthOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label} · {option.description}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="submit"
                disabled={creating || isHydrating}
                className="btn-primary h-11 px-5 sm:h-12"
              >
                <Sparkles size={17} />
                开始研究
              </button>
            </div>
            <div className="mt-2 min-h-5 px-2">
              {error || databaseError ? (
                <p className="text-xs font-medium text-red-600">{error || databaseError}</p>
              ) : (
                <p className="text-xs text-ink-subtle">
                  当前模式：{depthOptions.find((option) => option.value === depth)?.label}，将优先交叉验证来源。
                </p>
              )}
            </div>
            {correction && (
              <TopicCorrectionPrompt
                correction={correction}
                className="mt-3"
                onAccept={() => void openResearchPlan(
                  correction.inputTopic,
                  correction.suggestedTopic,
                )}
                onKeep={() => void openResearchPlan(
                  correction.inputTopic,
                  correction.inputTopic,
                )}
              />
            )}
          </form>
        </section>

        <section className="mx-auto mt-14 max-w-6xl">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-ink">最近的研究任务</h2>
              <p className="mt-1 text-xs text-ink-subtle">继续浏览已有研究，或从新的问题开始。</p>
            </div>
            <button
              type="button"
              onClick={() => tasks[0] && navigate(getTaskRoute(tasks[0].task.id, getResumePage(tasks[0])))}
              className="focus-ring inline-flex items-center gap-1 rounded-md text-xs font-semibold text-primary-deep hover:underline"
            >
              查看全部
              <ArrowRight size={14} />
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {tasks.map((taskState) => {
              const task = taskState.task
              const processing = taskState.planStatus === 'loading'
                || taskState.searchStatus === 'loading'
                || taskState.outlineStatus === 'loading'
                || taskState.reportStatus === 'loading'
              return (
              <button
                key={task.id}
                type="button"
                onClick={() => {
                  switchTask(task.id)
                  navigate(getTaskRoute(task.id, getResumePage(taskState)))
                }}
                className="surface-card focus-ring min-h-[180px] p-5 text-left transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-ambient"
              >
                <div className="flex items-center justify-between gap-3">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold ${
                      processing
                        ? 'bg-blue-50 text-blue-700'
                        : task.status === 'reported'
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {processing ? (
                      <Gauge size={12} />
                    ) : (
                      <Database size={12} />
                    )}
                    {getDepthLabel(task.depth)}
                  </span>
                  <span className="inline-flex items-center gap-1 text-[11px] text-ink-subtle">
                    <Clock3 size={12} />
                    {formatTaskTime(task.createdAt)}
                  </span>
                </div>
                <h3 className="mt-5 line-clamp-2 text-base font-semibold leading-6 text-ink">
                  {task.title}
                </h3>
                <div className="mt-5 border-t border-outline pt-4">
                  {processing ? (
                    <div>
                      <div className="mb-2 flex justify-between text-[11px] text-ink-subtle">
                        <span>任务处理中</span>
                        <span>{task.status === 'searching' ? '检索' : '生成'}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: '68%' }}
                        />
                      </div>
                    </div>
                  ) : (
                    <span className="text-xs font-medium text-ink-muted">
                      已整理 {taskState.poolItems.length} 条资料
                    </span>
                  )}
                </div>
              </button>
              )
            })}
            {tasks.length === 0 && (
              <div className="surface-card col-span-full p-8 text-center text-sm text-ink-muted">
                暂无研究任务，创建后的任务会保存在这里。
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

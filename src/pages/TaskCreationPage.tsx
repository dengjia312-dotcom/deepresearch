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
import { useResearch } from '../context/ResearchContext'
import { recentTasks } from '../data/mockData'
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

export function TaskCreationPage() {
  const navigate = useNavigate()
  const { prepareResearch, setNotice } = useResearch()
  const [query, setQuery] = useState('')
  const [depth, setDepth] = useState<ResearchDepth>('deep')
  const [error, setError] = useState('')
  const [correction, setCorrection] = useState<TopicCorrection | null>(null)

  const openResearchPlan = (originalTopic: string, selectedTopic: string) => {
    setCorrection(null)
    prepareResearch(originalTopic, selectedTopic, depth)
    navigate('/plan')
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

    openResearchPlan(title, title)
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
                className="btn-primary h-11 px-5 sm:h-12"
              >
                <Sparkles size={17} />
                开始研究
              </button>
            </div>
            <div className="mt-2 min-h-5 px-2">
              {error ? (
                <p className="text-xs font-medium text-red-600">{error}</p>
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
                onAccept={() => openResearchPlan(
                  correction.inputTopic,
                  correction.suggestedTopic,
                )}
                onKeep={() => openResearchPlan(
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
              onClick={() => setNotice('演示工作区已展示最近的 3 个任务。')}
              className="focus-ring inline-flex items-center gap-1 rounded-md text-xs font-semibold text-primary-deep hover:underline"
            >
              查看全部
              <ArrowRight size={14} />
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {recentTasks.map((task) => (
              <button
                key={task.id}
                type="button"
                onClick={() => {
                  prepareResearch(task.title, task.title, 'deep')
                  setNotice('已根据该主题生成研究计划。')
                  navigate('/plan')
                }}
                className="surface-card focus-ring min-h-[180px] p-5 text-left transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-ambient"
              >
                <div className="flex items-center justify-between gap-3">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold ${
                      task.state === 'processing'
                        ? 'bg-blue-50 text-blue-700'
                        : task.state === 'complete'
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {task.state === 'processing' ? (
                      <Gauge size={12} />
                    ) : (
                      <Database size={12} />
                    )}
                    {task.mode}
                  </span>
                  <span className="inline-flex items-center gap-1 text-[11px] text-ink-subtle">
                    <Clock3 size={12} />
                    {task.time}
                  </span>
                </div>
                <h3 className="mt-5 line-clamp-2 text-base font-semibold leading-6 text-ink">
                  {task.title}
                </h3>
                <div className="mt-5 border-t border-outline pt-4">
                  {task.progress ? (
                    <div>
                      <div className="mb-2 flex justify-between text-[11px] text-ink-subtle">
                        <span>正在提取核心观点</span>
                        <span>{task.progress}%</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${task.progress}%` }}
                        />
                      </div>
                    </div>
                  ) : (
                    <span className="text-xs font-medium text-ink-muted">
                      已整理 {task.sourceCount} 条来源
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

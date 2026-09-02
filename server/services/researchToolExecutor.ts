import type { ResearchToolName } from '../types/research'
import {
  ResearchToolRuntimeError,
  type ResearchToolBudget,
  type ResearchToolCall,
  type ResearchToolExecutionContext,
  type ResearchToolProgress,
  type ResearchToolResult,
} from '../types/researchTool'
import { defaultResearchToolRegistry, ResearchToolRegistry } from './researchToolRegistry'

export const DEFAULT_RESEARCH_TOOL_BUDGET: ResearchToolBudget = Object.freeze({
  maxTotalCalls: 6,
  maxCallsByTool: Object.freeze({
    web_search: 2,
    read_webpage: 2,
    http_fetch: 2,
  }),
})

export interface ResearchToolExecutorHooks {
  onProgress?: (progress: ResearchToolProgress) => Promise<void> | void
}

function cloneProgress(progress: ResearchToolProgress): ResearchToolProgress {
  return {
    currentTool: progress.currentTool,
    toolCallCount: progress.toolCallCount,
    toolCallCounts: { ...progress.toolCallCounts },
  }
}

function readToolName(call: unknown) {
  if (!call || typeof call !== 'object' || Array.isArray(call)) return ''
  const value = Reflect.get(call, 'tool')
  return typeof value === 'string' ? value : ''
}

export class ResearchToolExecutor {
  private readonly progress: ResearchToolProgress = {
    currentTool: null,
    toolCallCount: 0,
    toolCallCounts: { web_search: 0, read_webpage: 0, http_fetch: 0 },
  }

  constructor(
    private readonly registry: ResearchToolRegistry = defaultResearchToolRegistry,
    private readonly budget: ResearchToolBudget = DEFAULT_RESEARCH_TOOL_BUDGET,
    private readonly hooks: ResearchToolExecutorHooks = {},
  ) {}

  getSnapshot() {
    return cloneProgress(this.progress)
  }

  async execute(
    call: unknown,
    context: ResearchToolExecutionContext,
  ): Promise<ResearchToolResult> {
    await context.assertCurrent?.()
    const requestedTool = readToolName(call)
    const definition = this.registry.get(requestedTool)
    if (!definition || !definition.enabled) {
      throw new ResearchToolRuntimeError(
        'RESEARCH_TOOL_UNAVAILABLE',
        '请求的 Research Tool 不可用。',
      )
    }
    if (!definition.validateArguments(call)) {
      throw new ResearchToolRuntimeError(
        'RESEARCH_TOOL_ARGUMENTS_INVALID',
        `Research Tool 参数无效：${definition.name}`,
      )
    }
    const currentCount = this.progress.toolCallCounts[definition.name]
    const perToolLimit = Math.min(
      definition.maxCallsPerRun,
      this.budget.maxCallsByTool[definition.name],
    )
    if (
      this.progress.toolCallCount >= this.budget.maxTotalCalls
      || currentCount >= perToolLimit
    ) {
      throw new ResearchToolRuntimeError(
        'RESEARCH_TOOL_BUDGET_EXCEEDED',
        `Research Tool 调用预算已用尽：${definition.name}`,
      )
    }

    this.progress.toolCallCount += 1
    this.progress.toolCallCounts[definition.name] += 1
    this.progress.currentTool = definition.name
    let executionError: unknown = null
    try {
      await this.hooks.onProgress?.(cloneProgress(this.progress))
      const result = await definition.adapter(call as ResearchToolCall, context)
      await context.assertCurrent?.()
      return result
    } catch (error) {
      executionError = error
      throw error
    } finally {
      this.progress.currentTool = null
      try {
        await this.hooks.onProgress?.(cloneProgress(this.progress))
      } catch (cleanupError) {
        if (!executionError) throw cleanupError
      }
    }
  }
}

export function createResearchToolExecutor(
  hooks: ResearchToolExecutorHooks = {},
  registry: ResearchToolRegistry = defaultResearchToolRegistry,
  budget: ResearchToolBudget = DEFAULT_RESEARCH_TOOL_BUDGET,
) {
  return new ResearchToolExecutor(registry, budget, hooks)
}

export type ResearchToolExecutorFactory = typeof createResearchToolExecutor

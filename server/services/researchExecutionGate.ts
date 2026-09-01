import type { ResearchStrategy } from '../types/research'
import { ResearchServiceError } from './serviceError'
import {
  createLegacyFallbackResearchStrategy,
  parseResearchStrategy,
} from './researchStrategyService'

interface ResearchExecutionPlan {
  objective: string
  confirmedAt: string | null
  _researchStrategy?: unknown
  _researchStrategyVersion?: unknown
}

export interface ResearchExecutionGateInput {
  taskId: string
  topic: string
  plan: ResearchExecutionPlan | null
  confirmedAt: Date | string | null
}

function blocked(
  input: ResearchExecutionGateInput,
  code: 'RESEARCH_PLAN_CONFIRMATION_REQUIRED'
    | 'RESEARCH_INTENT_CONFIRMATION_REQUIRED'
    | 'INVALID_RESEARCH_INTENT',
  message: string,
): never {
  console.info('[research:gate] blocked', {
    taskId: input.taskId,
    reason: code,
  })
  throw new ResearchServiceError(code, 409, message)
}

export function assertResearchExecutionAllowed(
  input: ResearchExecutionGateInput,
): ResearchStrategy {
  if (!input.plan || !input.confirmedAt || !input.plan.confirmedAt) {
    return blocked(
      input,
      'RESEARCH_PLAN_CONFIRMATION_REQUIRED',
      '请先确认研究计划，再开始联网研究。',
    )
  }

  const strategy = parseResearchStrategy(input.plan._researchStrategy)
  if (input.plan._researchStrategyVersion === 2) {
    if (!strategy || strategy.version !== 2) {
      return blocked(
        input,
        'INVALID_RESEARCH_INTENT',
        '研究方向数据不完整，请重新生成或确认研究计划。',
      )
    }
    if (strategy.intentConfirmation.status === 'pending') {
      return blocked(
        input,
        'RESEARCH_INTENT_CONFIRMATION_REQUIRED',
        '请先确认研究方向，再开始联网研究。',
      )
    }
    if (strategy.queryPlanStatus !== 'ready' || strategy.queryPlan.queries.length < 2) {
      return blocked(
        input,
        'INVALID_RESEARCH_INTENT',
        '研究检索策略已失效，请重新确认研究计划。',
      )
    }
    return strategy
  }

  // Tasks created before Strategy v2 remain executable. Only legacy tasks may
  // rebuild a missing strategy with the compatibility fallback.
  return strategy ?? createLegacyFallbackResearchStrategy({
    topic: input.topic,
    goal: input.plan.objective,
  })
}

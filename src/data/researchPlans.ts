import type {
  ResearchDepth,
  ResearchPlan,
  ResearchTopicData,
  SourcePreference,
} from '../types'

export const sourcePreferenceOptions: SourcePreference[] = [
  '权威报告',
  '官方资料',
  '行业研究',
  '学术论文',
  '司法案例',
  '企业案例',
  '用户研究',
  '专业媒体',
  '内部资料',
]

interface ResearchPlanTemplate {
  objective: string
  scope: string
  questions: string[]
  sourcePreferences: SourcePreference[]
}

const planTemplates: Record<string, ResearchPlanTemplate> = {
  'low-code-market': {
    objective:
      '评估 AI 低代码平台的市场格局、产品能力与企业采购逻辑，识别主要增长机会、竞争壁垒及落地风险。',
    scope:
      '聚焦中国及全球企业级低代码与无代码平台，重点观察 AI 原生能力、开发治理、生态伙伴、商业模式和 2024—2026 年市场变化。',
    questions: [
      'AI 能力正在如何改变低代码平台的产品边界与价值主张？',
      '主要厂商的竞争优势、商业模式和生态策略有哪些差异？',
      '企业采购与规模化落地时最关注哪些指标和风险？',
      '未来两年低代码平台市场的关键增长信号是什么？',
    ],
    sourcePreferences: ['权威报告', '官方资料', '行业研究', '企业案例'],
  },
  'contract-risk': {
    objective:
      '梳理企业合同从起草、审批、签署到归档履约的完整流程，定位法律、授权、证据与执行风险，并形成可操作的改进建议。',
    scope:
      '聚焦中国大陆企业常见商事合同，覆盖业务发起、法务审查、授权审批、电子或线下签署、用印、归档及履约跟踪环节。',
    questions: [
      '企业合同签订流程中最常见的控制断点和责任边界是什么？',
      '合同主体、授权、条款与签署形式分别存在哪些核心法律风险？',
      '电子签名、印章和版本留痕应满足哪些证据与合规要求？',
      '如何通过制度、系统和复核机制降低合同全生命周期风险？',
    ],
    sourcePreferences: ['官方资料', '司法案例', '权威报告', '企业案例'],
  },
  'smart-cockpit-voice': {
    objective:
      '研判智能座舱 AI 语音交互的技术演进、用户体验与产品竞争方向，识别大模型和多模态 HMI 的落地价值与安全边界。',
    scope:
      '聚焦中国乘用车智能座舱，观察车载语音助手、大模型、多模态交互、端云协同、典型高频场景及 2024—2026 年产品趋势。',
    questions: [
      '座舱语音交互正在从指令控制向哪些场景化能力演进？',
      '大模型、多模态 HMI 与端云协同分别带来什么产品价值？',
      '哪些体验指标最影响用户信任、任务成功率和使用频次？',
      '主机厂和供应商需要如何处理安全、隐私与成本约束？',
    ],
    sourcePreferences: ['行业研究', '官方资料', '用户研究', '专业媒体'],
  },
}

const depthEstimates: Record<
  ResearchDepth,
  Pick<ResearchPlan, 'estimatedSourceCount' | 'estimatedDurationMinutes'>
> = {
  quick: { estimatedSourceCount: 8, estimatedDurationMinutes: 2 },
  deep: { estimatedSourceCount: 16, estimatedDurationMinutes: 5 },
  professional: { estimatedSourceCount: 30, estimatedDurationMinutes: 15 },
}

function createGenericTemplate(topic: string): ResearchPlanTemplate {
  return {
    objective: `围绕“${topic}”建立结构化认知，梳理现状、关键参与者、实践路径、主要风险与后续趋势，为进一步真实检索提供研究框架。`,
    scope: `聚焦“${topic}”的行业背景、核心概念、典型应用、实施条件、风险治理与未来变化，时间范围以近三年的公开信息为主。`,
    questions: [
      `“${topic}”的研究边界、核心概念与主要参与者是什么？`,
      `“${topic}”当前有哪些典型实践路径与可验证成果？`,
      `推进“${topic}”需要关注哪些风险、约束与治理机制？`,
      `“${topic}”未来一至三年的关键趋势与决策信号是什么？`,
    ],
    sourcePreferences: ['权威报告', '官方资料', '行业研究', '专业媒体'],
  }
}

export function createResearchPlan(
  topic: ResearchTopicData,
  depth: ResearchDepth,
): ResearchPlan {
  const template = planTemplates[topic.id] ?? createGenericTemplate(topic.topic)
  const now = new Date().toISOString()

  return {
    objective: template.objective,
    scope: template.scope,
    questions: template.questions.map((text, index) => ({
      id: `${topic.id}-question-${index + 1}`,
      text,
    })),
    sourcePreferences: [...template.sourcePreferences],
    ...depthEstimates[depth],
    usesPrototypeData: topic.usesPrototypeData,
    updatedAt: now,
    confirmedAt: null,
  }
}

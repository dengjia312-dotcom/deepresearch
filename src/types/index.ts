export type ResearchDepth = 'quick' | 'deep' | 'professional'

export type SourcePreference =
  | '权威报告'
  | '官方资料'
  | '行业研究'
  | '学术论文'
  | '司法案例'
  | '企业案例'
  | '用户研究'
  | '专业媒体'
  | '内部资料'

export interface TopicCorrection {
  inputTopic: string
  suggestedTopic: string
}

export type TaskStatus =
  | 'draft'
  | 'searching'
  | 'collecting'
  | 'outlined'
  | 'reported'

export type SourceKind = 'web' | 'pdf' | 'news' | 'report' | 'internal'

export type Credibility = 'high' | 'medium' | 'low'

export type ReviewStatus =
  | 'unreviewed'
  | 'trusted'
  | 'questionable'
  | 'irrelevant'

export interface ResearchTask {
  id: string
  title: string
  query: string
  topicId: string
  usesPrototypeData: boolean
  depth: ResearchDepth
  status: TaskStatus
  createdAt: string
}

export interface ResearchQuestion {
  id: string
  text: string
}

export interface ResearchPlan {
  objective: string
  scope: string
  questions: ResearchQuestion[]
  sourcePreferences: SourcePreference[]
  estimatedSourceCount: number
  estimatedDurationMinutes: number
  usesPrototypeData: boolean
  updatedAt: string
  confirmedAt: string | null
}

export interface Source {
  id: string
  rank: number
  title: string
  type: SourceKind
  publisher: string
  url: string
  publishDate: string
  freshness: string
  credibility: Credibility
  tags: string[]
  summary: string
  keyInsight: string
  addedToPool: boolean
  excerpt: string[]
  insights: string[]
}

export interface ResearchInsight {
  id: string
  title: string
  description: string
  sourceId: string
}

export interface ResearchPoolItem {
  sourceId: string
  reviewStatus: ReviewStatus
  note: string
  addedAt: string
}

export interface OutlineSectionData {
  id: string
  title: string
  sourceIds: string[]
  children: OutlineSectionData[]
}

export type ReportSegment =
  | { type: 'text'; text: string }
  | { type: 'citation'; sourceId: string }

export interface ReportParagraph {
  id: string
  segments: ReportSegment[]
}

export interface ReportSectionData {
  id: string
  heading?: string
  paragraphs: ReportParagraph[]
  insight?: string
}

export interface ResearchReportData {
  title: string
  sections: ReportSectionData[]
}

export interface ResearchTopicData {
  id: string
  topic: string
  keywords: string[]
  summary: string
  insights: ResearchInsight[]
  sources: Source[]
  outline: OutlineSectionData[]
  report: ResearchReportData
  usesPrototypeData: boolean
}

export interface RecentResearchTask {
  id: string
  title: string
  mode: string
  time: string
  sourceCount?: number
  progress?: number
  state: 'complete' | 'processing' | 'overview'
}

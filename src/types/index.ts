export type ResearchDepth = 'quick' | 'deep' | 'professional'
export type SearchDepth = 'concise' | 'standard' | 'deep' | 'custom'
export type ReportDepth = 'brief' | 'standard' | 'deep'

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

export type Credibility = 'high' | 'medium' | 'low' | 'unverified'

export type DataSource = 'real' | 'mock'
export type SearchMode = 'idle' | DataSource

export type SearchStatus = 'idle' | 'loading' | 'success' | 'error'
export type GenerationMode = 'idle' | DataSource
export type GenerationStatus = 'idle' | 'loading' | 'success' | 'error'
export type EvidenceStatus = 'sufficient' | 'limited' | 'insufficient'
export type ClaimType = 'source_supported' | 'synthesis' | 'uncertain'

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
  dataSource: 'real'
  depth: ResearchDepth
  searchDepth: SearchDepth
  targetSourceCount: number
  reportDepth: ReportDepth
  reportTargetMinWords: number
  reportTargetMaxWords: number
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
  dataSource: DataSource
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
  origin?: DataSource
  sourceTypeLabel?: string
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
  sourceSnapshot?: Source
  dataSource: DataSource
}

export interface LiveResearchInsightData {
  id: string
  title: string
  content: string
  sourceIds: string[]
}

export interface LiveResearchResult {
  mode: 'live'
  dataSource: 'real'
  topic: string
  summary: string
  insights: LiveResearchInsightData[]
  sources: Source[]
  warnings: string[]
  targetSourceCount: number
  actualSourceCount: number
  deduplicatedSourceCount: number
  validSourceCount: number
  searchedAt: string
}

export interface OutlineSectionData {
  id: string
  title: string
  sourceIds: string[]
  children: OutlineSectionData[]
  description?: string
  evidenceStatus?: EvidenceStatus
}

export interface LiveOutlineResult {
  mode: 'live'
  dataSource: 'real'
  outline: {
    title: string
    sections: OutlineSectionData[]
  }
  warnings: string[]
  generatedAt: string
}

export interface LiveReportParagraphData {
  id: string
  content: string
  sourceIds: string[]
  claimType: ClaimType
}

export interface LiveReportSectionData {
  id: string
  title: string
  paragraphs: LiveReportParagraphData[]
}

export interface LiveReportResult {
  mode: 'live'
  dataSource: 'real'
  report: {
    title: string
    executiveSummary: string
    sections: LiveReportSectionData[]
    conclusion: string
    limitations: string[]
  }
  warnings: string[]
  reportDepth: ReportDepth
  targetMinWords: number
  targetMaxWords: number
  actualWordCount: number
  generatedAt: string
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

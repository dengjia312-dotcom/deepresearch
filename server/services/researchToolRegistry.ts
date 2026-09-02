import type { ResearchAgentSourceType, ResearchToolName } from '../types/research'
import {
  ResearchToolRuntimeError,
  type ResearchToolDefinition,
} from '../types/researchTool'
import { readWebpageToolAdapter, webSearchToolAdapter } from './researchToolAdapters'

const SOURCE_TYPES = Object.freeze<ResearchAgentSourceType[]>([
  'official',
  'academic',
  'professional',
  'news',
  'company',
  'recruitment',
  'community',
  'general_web',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isValidExecutionId(value: unknown) {
  return typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value)
}

function hasValidBase(
  value: unknown,
  tool: ResearchToolName,
): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  return value.tool === tool
    && isValidExecutionId(value.executionId)
    && (value.round === 1 || value.round === 2)
    && Array.isArray(value.evidenceNeedIds)
    && value.evidenceNeedIds.every((item) => typeof item === 'string' && item.length > 0)
}

function isValidQuery(value: unknown) {
  if (!isRecord(value)) return false
  return typeof value.id === 'string' && value.id.length > 0
    && typeof value.query === 'string' && value.query.trim().length > 0
    && typeof value.purpose === 'string' && value.purpose.trim().length > 0
    && Number.isSafeInteger(value.priority) && Number(value.priority) > 0
}

function validateWebSearchCall(value: unknown) {
  return hasValidBase(value, 'web_search')
    && Array.isArray(value.queries)
    && value.queries.length >= 1
    && value.queries.length <= 4
    && value.queries.every(isValidQuery)
}

function isValidSource(value: unknown) {
  if (!isRecord(value)) return false
  if (
    typeof value.url !== 'string'
    || typeof value.title !== 'string'
    || typeof value.publisher !== 'string'
    || typeof value.publishedAt !== 'string'
    || typeof value.snippet !== 'string'
    || value.title.trim().length === 0
    || value.snippet.trim().length === 0
  ) return false
  try {
    const url = new URL(value.url)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function validateReadWebpageCall(value: unknown) {
  return hasValidBase(value, 'read_webpage')
    && Array.isArray(value.sources)
    && value.sources.length >= 1
    && value.sources.length <= 16
    && value.sources.every(isValidSource)
}

function freezeDefinition(definition: ResearchToolDefinition): ResearchToolDefinition {
  return Object.freeze({
    ...definition,
    capabilities: Object.freeze([...definition.capabilities]),
    supportedSourceTypes: Object.freeze([...definition.supportedSourceTypes]),
  })
}

export class ResearchToolRegistry {
  private readonly definitions: ReadonlyMap<ResearchToolName, ResearchToolDefinition>

  constructor(definitions: readonly ResearchToolDefinition[]) {
    const entries = new Map<ResearchToolName, ResearchToolDefinition>()
    definitions.forEach((definition) => {
      if (entries.has(definition.name)) {
        throw new ResearchToolRuntimeError(
          'RESEARCH_TOOL_UNAVAILABLE',
          `Research Tool definition 重复：${definition.name}`,
        )
      }
      entries.set(definition.name, freezeDefinition(definition))
    })
    this.definitions = entries
  }

  get(name: string) {
    return this.definitions.get(name as ResearchToolName)
  }

  list() {
    return Object.freeze([...this.definitions.values()])
  }
}

export const defaultResearchToolRegistry = new ResearchToolRegistry([
  {
    name: 'web_search',
    description: '使用现有 GLM Web Search 发现并筛选相关网页来源。',
    capabilities: ['discover_sources'],
    supportedSourceTypes: SOURCE_TYPES,
    costLevel: 'medium',
    latencyLevel: 'medium',
    maxCallsPerRun: 2,
    enabled: true,
    validateArguments: validateWebSearchCall,
    adapter: webSearchToolAdapter,
  },
  {
    name: 'read_webpage',
    description: '使用现有 GLM Reader 读取候选网页正文，并保留搜索摘要 fallback。',
    capabilities: ['extract_web_content'],
    supportedSourceTypes: SOURCE_TYPES,
    costLevel: 'medium',
    latencyLevel: 'high',
    maxCallsPerRun: 2,
    enabled: true,
    validateArguments: validateReadWebpageCall,
    adapter: readWebpageToolAdapter,
  },
])

export const researchToolRegistryTestApi = {
  validateWebSearchCall,
  validateReadWebpageCall,
}

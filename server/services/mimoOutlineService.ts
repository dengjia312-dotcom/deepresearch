import {
  asString,
  getAssistantContent,
  isRecord,
  MimoServiceError,
  parseJsonObject,
  requestMimo,
} from './mimoResearchService'
import type {
  EvidenceStatus,
  OutlineRequest,
  OutlineResponse,
} from '../types/research'

function parseWarnings(value: unknown) {
  return Array.isArray(value)
    ? value.map(asString).filter(Boolean).slice(0, 20).map((item) => item.slice(0, 300))
    : []
}

export async function generateOutlineWithMimo(
  request: OutlineRequest,
): Promise<OutlineResponse> {
  const allowedSourceIds = new Set(request.sources.map((source) => source.id))
  const prompt = `请仅根据以下用户已选择的来源摘要和关键观点，生成中文研究大纲。禁止联网搜索，禁止引入未提供的来源。\n\n研究主题：${request.topic}\n研究目标：${request.goal}\n来源：${JSON.stringify(request.sources)}\n\n要求：\n1. 生成 2 至 10 个不重复章节；\n2. sourceIds 只能使用给定来源 id；\n3. 每章尽量关联至少一个来源，无来源时 evidenceStatus 必须为 insufficient；\n4. 单一或较弱证据使用 limited，覆盖充分才使用 sufficient；\n5. 不得为了补齐章节编造来源；\n6. 仅输出 JSON：{"outline":{"title":"报告标题","sections":[{"id":"section-1","title":"章节标题","description":"研究重点","sourceIds":["source-id"],"evidenceStatus":"sufficient|limited|insufficient"}]},"warnings":[]}`

  const payload = await requestMimo({
    messages: [
      {
        role: 'system',
        content: '你是严谨的中文研究大纲编辑。只能使用用户提供的来源，不调用工具，不补充外部事实。',
      },
      { role: 'user', content: prompt },
    ],
    max_completion_tokens: 3000,
    temperature: 0.2,
    stream: false,
    thinking: { type: 'disabled' },
  })

  const parsed = parseJsonObject(getAssistantContent(payload))
  if (!isRecord(parsed) || !isRecord(parsed.outline)) {
    throw new MimoServiceError('MIMO_RESPONSE_INVALID', 502, 'MiMo 返回的大纲结构无效。')
  }
  const title = asString(parsed.outline.title)
  const rawSections = Array.isArray(parsed.outline.sections) ? parsed.outline.sections : []
  if (!title || title.length > 200 || rawSections.length < 2 || rawSections.length > 10) {
    throw new MimoServiceError('MIMO_RESPONSE_INVALID', 502, 'MiMo 返回的大纲标题或章节数量异常。')
  }

  const seenTitles = new Set<string>()
  const sections = rawSections.map((item, index) => {
    if (!isRecord(item)) {
      throw new MimoServiceError('MIMO_RESPONSE_INVALID', 502, 'MiMo 返回了无效大纲章节。')
    }
    const sectionTitle = asString(item.title)
    const description = asString(item.description)
    const titleKey = sectionTitle.toLocaleLowerCase()
    if (
      !sectionTitle
      || sectionTitle.length > 160
      || !description
      || description.length > 800
      || seenTitles.has(titleKey)
    ) {
      throw new MimoServiceError('MIMO_RESPONSE_INVALID', 502, 'MiMo 返回了重复或过长的大纲章节。')
    }
    seenTitles.add(titleKey)

    const sourceIds = Array.isArray(item.sourceIds)
      ? [...new Set(item.sourceIds.map(asString).filter(Boolean))]
      : []
    if (sourceIds.some((sourceId) => !allowedSourceIds.has(sourceId))) {
      throw new MimoServiceError('MIMO_RESPONSE_INVALID', 502, 'MiMo 大纲包含资料池之外的来源。')
    }
    const evidenceStatus: EvidenceStatus = sourceIds.length >= 2
      ? 'sufficient'
      : sourceIds.length === 1
        ? 'limited'
        : 'insufficient'

    return {
      id: `section-${index + 1}`,
      title: sectionTitle,
      description,
      sourceIds,
      evidenceStatus,
    }
  })

  return {
    taskId: request.taskId,
    requestId: request.requestId,
    mode: 'live',
    dataSource: 'real',
    outline: { title, sections },
    warnings: parseWarnings(parsed.warnings),
    generatedAt: new Date().toISOString(),
  }
}

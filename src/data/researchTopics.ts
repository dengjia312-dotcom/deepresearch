import type {
  ReportSectionData,
  ResearchTopicData,
  Source,
  TopicCorrection,
} from '../types'

const text = (value: string) => ({ type: 'text' as const, text: value })
const citation = (sourceId: string) => ({ type: 'citation' as const, sourceId })

const lowCodeSources: Source[] = [
  {
    id: 'lowcode-gartner-market',
    rank: 1,
    title: '2024 年全球低代码平台市场规模及发展趋势预测报告',
    type: 'report',
    publisher: 'Gartner Research',
    publishDate: '2024-02-18',
    freshness: '今天 10:23',
    credibility: 'high',
    summary: '系统梳理全球低代码开发平台的市场规模、增长曲线与企业采购变化，并给出 2028 年预测。',
    keyInsight: '企业应用现代化、开发人才缺口与生成式 AI 平台化正在共同推动低代码市场增长。',
    tags: ['市场规模', 'CAGR', 'Gartner'],
    url: 'https://example.com/research/low-code-market-2024',
    addedToPool: false,
    excerpt: [
      '到 2028 年，低代码开发技术市场仍将保持两位数增长，企业级应用现代化是主要驱动力。',
      '采购决策越来越关注安全治理、既有系统集成能力和平台的可扩展性。',
    ],
    insights: ['应用现代化是首要增长动力。', '治理与集成能力正在成为采购关键。', '生成式 AI 已进入平台能力层。'],
  },
  {
    id: 'lowcode-mckinsey-genai',
    rank: 2,
    title: '生成式 AI 如何重塑低代码企业软件交付模式',
    type: 'pdf',
    publisher: 'McKinsey Digital',
    publishDate: '2024-01-26',
    freshness: '昨天',
    credibility: 'high',
    summary: '分析生成式 AI 对低代码需求分析、应用开发、测试与运维环节的影响，并量化复合团队的效率提升。',
    keyInsight: '自然语言正在成为低代码应用创建的新入口，但规模化价值仍取决于平台治理与人工复核。',
    tags: ['生成式 AI', '企业软件', '生产力'],
    url: 'https://example.com/insights/gen-ai-low-code-delivery',
    addedToPool: false,
    excerpt: [
      '领先企业将生成式 AI 嵌入需求、设计、编码和测试流程，并通过统一治理降低输出不确定性。',
      '在标准化程度较高的内部应用场景中，复合团队的交付周期出现明显缩短。',
    ],
    insights: ['自然语言成为新的开发入口。', '效率收益依赖可复用资产。', '业务与 IT 的协作边界正在变化。'],
  },
  {
    id: 'lowcode-power-platform',
    rank: 3,
    title: 'Microsoft Power Platform 全面整合 Copilot',
    type: 'news',
    publisher: 'TechCrunch',
    publishDate: '2023-11-15',
    freshness: '3 天前',
    credibility: 'medium',
    summary: '微软将 Copilot 贯穿 Power Platform 的应用、自动化与数据分析产品，释放企业级自然语言开发能力。',
    keyInsight: 'Power Platform 依靠云、数据和办公生态形成分发优势，竞争门槛从单点功能升级到生态协同。',
    tags: ['Power Platform', 'Copilot', '竞争动态'],
    url: 'https://example.com/news/power-platform-copilot',
    addedToPool: false,
    excerpt: [
      '开发者可以通过自然语言描述直接生成应用骨架、数据模型和复杂流程。',
      'Copilot 同时连接 Dataverse、Power BI 与 Microsoft 365，以减少跨工具切换。',
    ],
    insights: ['大型厂商的生态优势进一步扩大。', '自然语言覆盖应用构建全流程。', '企业数据权限仍是部署约束。'],
  },
  {
    id: 'lowcode-forrester-governance',
    rank: 4,
    title: 'Forrester Wave：企业低代码平台治理能力评估',
    type: 'report',
    publisher: 'Forrester',
    publishDate: '2023-12-08',
    freshness: '1 周前',
    credibility: 'high',
    summary: '从产品能力、平台战略与客户反馈三个维度评估主流低代码平台，并比较治理与专业扩展能力。',
    keyInsight: '基础搭建能力已趋同，企业治理、专业代码扩展和生态伙伴正在成为平台差异化核心。',
    tags: ['厂商评估', '公民开发者', '治理'],
    url: 'https://example.com/report/forrester-low-code-wave',
    addedToPool: false,
    excerpt: [
      '企业客户不再只关注易用性，而是要求平台支持跨部门治理、复用和专业代码扩展。',
      '公民开发项目能否进入生产环境，取决于权限、审计和生命周期管理的成熟度。',
    ],
    insights: ['基础搭建能力趋于同质化。', '治理是规模化使用的分水岭。', '专业扩展能力影响长期留存。'],
  },
]

const lowCodeReport: ReportSectionData[] = [
  {
    id: 'lowcode-report-summary',
    paragraphs: [{
      id: 'lowcode-summary-1',
      segments: [
        text('低代码平台正从部门级效率工具转向企业应用战略基础设施。应用现代化、开发人才短缺与交付速度压力共同支撑市场增长'),
        citation('lowcode-gartner-market'),
        text('。'),
      ],
    }],
  },
  {
    id: 'lowcode-report-ai',
    heading: '生成式 AI 推动低代码平台能力升级',
    paragraphs: [{
      id: 'lowcode-ai-1',
      segments: [
        text('自然语言正在覆盖需求理解、页面搭建、流程编排与测试验证，但可靠交付仍需要结构化约束、权限治理和人工复核'),
        citation('lowcode-mckinsey-genai'),
        text('。'),
      ],
    }],
    insight: '生成速度只是基础指标，企业更关注生成结果能否安全、可维护地进入生产环境。',
  },
  {
    id: 'lowcode-report-competition',
    heading: '生态与治理成为低代码竞争分水岭',
    paragraphs: [{
      id: 'lowcode-competition-1',
      segments: [
        text('头部厂商依托云服务、企业数据和办公协作产品形成生态优势，竞争焦点转向数据连接、全生命周期治理和专业代码扩展'),
        citation('lowcode-power-platform'),
        text('。'),
      ],
    }, {
      id: 'lowcode-competition-2',
      segments: [
        text('企业选型应优先评估治理成熟度、系统集成和长期可维护性，而不是只比较组件数量'),
        citation('lowcode-forrester-governance'),
        text('。'),
      ],
    }],
  },
]

const contractSources: Source[] = [
  {
    id: 'contract-lifecycle-whitepaper',
    rank: 1,
    title: '企业合同全生命周期管理与风险控制白皮书',
    type: 'report',
    publisher: '中国企业法务研究院',
    publishDate: '2024-03-12',
    freshness: '今天 09:40',
    credibility: 'high',
    summary: '梳理合同起草、审查、审批、签署、履行和归档全流程，识别职责分离与授权控制的关键风险。',
    keyInsight: '多数合同风险并非来自单一条款，而是来自需求、审批、签署和履约数据之间的流程断点。',
    tags: ['合同管理', '流程控制', '法务'],
    url: 'https://example.com/legal/contract-lifecycle-whitepaper',
    addedToPool: false,
    excerpt: [
      '合同管理应从签署节点向前延伸至交易需求确认，向后延伸至履约、变更、续签和归档。',
      '授权矩阵、印章控制与版本留痕是防止越权签署和文本替换的基础控制。',
    ],
    insights: ['流程断点是合同风险的主要来源。', '职责分离需要制度与系统共同落实。', '履约监控应纳入合同管理范围。'],
  },
  {
    id: 'contract-dispute-cases',
    rank: 2,
    title: '企业合同纠纷司法数据与高频争议条款观察',
    type: 'pdf',
    publisher: '司法案例研究中心',
    publishDate: '2024-02-28',
    freshness: '昨天',
    credibility: 'high',
    summary: '基于公开裁判文书分析企业合同纠纷中的授权、交付、验收、付款、违约与解除争议。',
    keyInsight: '交付标准不清、验收证据不足和变更程序缺失，是企业合同履约争议最集中的三类问题。',
    tags: ['司法案例', '争议条款', '履约风险'],
    url: 'https://example.com/legal/contract-dispute-cases',
    addedToPool: false,
    excerpt: [
      '大量争议源于合同文本未明确验收标准、通知方式与异议期限。',
      '口头变更或邮件指令若未纳入正式变更程序，容易造成责任边界不清。',
    ],
    insights: ['验收条款决定交付证据质量。', '变更管理是履约阶段的高风险点。', '争议解决条款需要匹配业务实际。'],
  },
  {
    id: 'contract-esign-maturity',
    rank: 3,
    title: '电子签名与数字合同签订流程成熟度报告',
    type: 'web',
    publisher: 'DocuSign Institute',
    publishDate: '2024-01-19',
    freshness: '3 天前',
    credibility: 'medium',
    summary: '评估身份认证、签署意愿、时间戳、证据链和电子归档在数字合同签订中的成熟度。',
    keyInsight: '电子签名工具只能解决签署动作，完整风险控制仍依赖签前授权和签后证据链管理。',
    tags: ['电子签名', '数字合同', '证据链'],
    url: 'https://example.com/legal/esign-maturity',
    addedToPool: false,
    excerpt: [
      '可靠电子签名需要将身份认证、签署意愿、文档完整性和时间证据组合为可验证链条。',
      '企业必须定义适用电子签名的合同类型和例外审批机制。',
    ],
    insights: ['签署工具不等于完整合同治理。', '证据链需要覆盖签署前后。', '例外场景必须有人工审批。'],
  },
  {
    id: 'contract-audit-practice',
    rank: 4,
    title: '大型企业合同审批与签订流程审计案例集',
    type: 'internal',
    publisher: '内部审计资料库',
    publishDate: '2023-12-06',
    freshness: '1 周前',
    credibility: 'high',
    summary: '汇总采购、销售和合作协议在合同审批、印章使用、版本控制与归档环节的常见审计发现。',
    keyInsight: '审批链线下绕行、签署版本与审批版本不一致，是合同流程中最难通过事后审计补救的风险。',
    tags: ['内部审计', '审批流程', '印章管理'],
    url: 'https://example.com/internal/contract-audit-practice',
    addedToPool: false,
    excerpt: [
      '审计样本中高频问题包括先签后审、越级审批、附件缺失和印章台账不完整。',
      '关键合同应对审批定稿、签署文本与归档文本进行哈希或版本一致性校验。',
    ],
    insights: ['签署版本必须与审批版本一致。', '印章使用需要关联授权记录。', '异常流程应形成可追溯记录。'],
  },
]

const contractReport: ReportSectionData[] = [
  {
    id: 'contract-report-summary',
    paragraphs: [{
      id: 'contract-summary-1',
      segments: [
        text('企业合同签订风险贯穿需求确认、文本审查、审批授权、正式签署和履约交接。单点法务审查无法替代端到端流程控制'),
        citation('contract-lifecycle-whitepaper'),
        text('。'),
      ],
    }],
  },
  {
    id: 'contract-report-controls',
    heading: '合同签订流程的关键控制点',
    paragraphs: [{
      id: 'contract-controls-1',
      segments: [
        text('企业应将交易需求、相对方资质、条款偏离、审批授权和印章使用纳入同一条可追溯流程，并确保审批定稿与签署版本一致'),
        citation('contract-audit-practice'),
        text('。'),
      ],
    }],
    insight: '高风险合同应设置法务、财务与业务的分级会签，并对越权和例外路径进行强制留痕。',
  },
  {
    id: 'contract-report-risk',
    heading: '高频条款与履约风险',
    paragraphs: [{
      id: 'contract-risk-1',
      segments: [
        text('交付标准、验收证据、付款条件、变更程序和解除权是合同纠纷的高频触发点，条款设计必须与实际履约流程一致'),
        citation('contract-dispute-cases'),
        text('。'),
      ],
    }, {
      id: 'contract-risk-2',
      segments: [
        text('数字签署应同步保存身份认证、签署意愿、文档完整性和时间证据，避免将电子签名工具误当成完整治理方案'),
        citation('contract-esign-maturity'),
        text('。'),
      ],
    }],
  },
]

const cockpitSources: Source[] = [
  {
    id: 'cockpit-industry-trend',
    rank: 1,
    title: '2024 智能座舱 AI 语音交互产业趋势报告',
    type: 'report',
    publisher: '盖世汽车研究院',
    publishDate: '2024-03-22',
    freshness: '今天 11:05',
    credibility: 'high',
    summary: '分析智能座舱 AI 语音交互的装配率、供应链、主流方案与大模型上车节奏。',
    keyInsight: '座舱语音正从指令控制升级为场景理解和连续任务协同，大模型成为体验差异化的新变量。',
    tags: ['智能座舱', '语音交互', '产业趋势'],
    url: 'https://example.com/auto/cockpit-voice-trend',
    addedToPool: false,
    excerpt: [
      '多音区识别、连续对话和离在线融合正在成为中高端车型的基础配置。',
      '大模型能力的上车速度取决于算力成本、数据闭环与功能安全边界。',
    ],
    insights: ['语音交互进入场景理解阶段。', '大模型带来体验差异化。', '成本与安全约束商业化节奏。'],
  },
  {
    id: 'cockpit-user-experience',
    rank: 2,
    title: '车载 AI 语音助手用户体验与满意度研究',
    type: 'pdf',
    publisher: 'J.D. Power China',
    publishDate: '2024-02-11',
    freshness: '昨天',
    credibility: 'high',
    summary: '从唤醒、识别、理解、响应和任务完成五个环节评估车载 AI 语音助手体验。',
    keyInsight: '用户满意度更依赖任务成功率、响应稳定性和可预期反馈，而不是单纯追求拟人化表达。',
    tags: ['用户体验', '任务成功率', '满意度'],
    url: 'https://example.com/auto/voice-assistant-ux',
    addedToPool: false,
    excerpt: [
      '导航、空调和媒体仍是高频语音场景，但跨域组合任务的使用意愿明显上升。',
      '错误恢复和反馈透明度对用户信任的影响高于回答语言的拟人程度。',
    ],
    insights: ['任务成功率是体验核心。', '错误恢复影响长期信任。', '跨域任务需求正在增长。'],
  },
  {
    id: 'cockpit-hmi-architecture',
    rank: 3,
    title: '多模态 HMI 与车载语音 AI 融合架构',
    type: 'pdf',
    publisher: 'SAE International',
    publishDate: '2024-01-08',
    freshness: '4 天前',
    credibility: 'high',
    summary: '讨论车载语音、视觉、触控和驾驶状态感知在多模态 HMI 中的融合架构与安全约束。',
    keyInsight: '真正自然的座舱交互依赖语音与屏幕、视线、车辆状态的协同，而不是孤立的语音助手。',
    tags: ['HMI', '多模态', '技术架构'],
    url: 'https://example.com/auto/multimodal-hmi-architecture',
    addedToPool: false,
    excerpt: [
      '多模态系统需要统一意图层，避免语音、触控和视觉反馈之间产生状态冲突。',
      '涉及驾驶控制的建议必须采用可解释、可撤销和分级授权的交互策略。',
    ],
    insights: ['统一意图层是多模态协同基础。', '安全相关交互需要分级授权。', '端云协同影响响应与隐私。'],
  },
  {
    id: 'cockpit-product-benchmark',
    rank: 4,
    title: '主流车企智能座舱 AI 助手产品对比',
    type: 'news',
    publisher: '亿欧汽车',
    publishDate: '2023-12-18',
    freshness: '1 周前',
    credibility: 'medium',
    summary: '对比主流车企在连续对话、场景推荐、生态服务和端侧隐私方面的智能座舱方案。',
    keyInsight: '车企竞争从语音功能数量转向高频场景完成度、品牌人格和车端数据闭环。',
    tags: ['产品对比', '车企竞争', '场景服务'],
    url: 'https://example.com/auto/cockpit-ai-benchmark',
    addedToPool: false,
    excerpt: [
      '新一代座舱助手开始支持连续任务、主动建议和第三方服务调用。',
      '领先产品通过车端状态和用户习惯数据提升场景推荐的准确性。',
    ],
    insights: ['场景完成度取代功能数量。', '品牌人格成为差异化要素。', '数据闭环决定迭代速度。'],
  },
]

const cockpitReport: ReportSectionData[] = [
  {
    id: 'cockpit-report-summary',
    paragraphs: [{
      id: 'cockpit-summary-1',
      segments: [
        text('智能座舱 AI 语音交互正在从单轮指令控制转向连续对话、场景理解和跨域任务协同，大模型加快了这一能力升级'),
        citation('cockpit-industry-trend'),
        text('。'),
      ],
    }],
  },
  {
    id: 'cockpit-report-experience',
    heading: '任务成功率决定座舱语音体验',
    paragraphs: [{
      id: 'cockpit-experience-1',
      segments: [
        text('用户更看重稳定唤醒、意图理解、低延迟响应和错误恢复。拟人化表达只有在任务可靠完成的基础上才会转化为满意度'),
        citation('cockpit-user-experience'),
        text('。'),
      ],
    }],
    insight: '产品指标应从识别率扩展到端到端任务成功率、恢复成本和驾驶分心程度。',
  },
  {
    id: 'cockpit-report-hmi',
    heading: '多模态 HMI 与端云协同成为技术主线',
    paragraphs: [{
      id: 'cockpit-hmi-1',
      segments: [
        text('语音需要与屏幕、视线、触控和车辆状态共享统一意图层，并通过端云协同平衡响应速度、隐私和模型能力'),
        citation('cockpit-hmi-architecture'),
        text('。'),
      ],
    }, {
      id: 'cockpit-hmi-2',
      segments: [
        text('车企的差异化将更多来自高频场景完成度、品牌化助手人格以及基于车端数据的持续迭代'),
        citation('cockpit-product-benchmark'),
        text('。'),
      ],
    }],
  },
]

export const researchTopics: ResearchTopicData[] = [
  {
    id: 'low-code-market',
    topic: 'AI 低代码平台市场研究',
    keywords: ['低代码', '无代码', 'power platform'],
    summary: 'AI 低代码平台正从可视化搭建工具升级为企业级应用交付平台，增长动力来自应用现代化、开发人才短缺与生成式 AI 的成熟。',
    insights: [
      { id: 'lowcode-growth', title: '市场保持结构性增长', description: '企业应用需求持续高于专业开发资源供给，采购从局部试点转向企业级标准化。', sourceId: 'lowcode-gartner-market' },
      { id: 'lowcode-ai', title: '生成式 AI 重构开发入口', description: '自然语言覆盖需求、页面、流程与测试，治理和复核能力决定生产可用性。', sourceId: 'lowcode-mckinsey-genai' },
      { id: 'lowcode-ecosystem', title: '生态能力拉开厂商差距', description: '头部平台依靠云、数据和办公生态扩大优势，竞争焦点转向治理与集成。', sourceId: 'lowcode-power-platform' },
    ],
    sources: lowCodeSources,
    outline: [
      { id: 'lowcode-background', title: '1. 市场定义与研究背景', sourceIds: ['lowcode-gartner-market', 'lowcode-mckinsey-genai'], children: [
        { id: 'lowcode-background-scope', title: '1.1 低代码与无代码平台边界', sourceIds: ['lowcode-gartner-market'], children: [] },
        { id: 'lowcode-background-ai', title: '1.2 生成式 AI 对平台定义的影响', sourceIds: ['lowcode-mckinsey-genai'], children: [] },
      ] },
      { id: 'lowcode-trends', title: '2. 市场趋势与增长动力', sourceIds: ['lowcode-gartner-market', 'lowcode-mckinsey-genai'], children: [
        { id: 'lowcode-trends-growth', title: '2.1 市场规模与增长预测', sourceIds: ['lowcode-gartner-market'], children: [] },
        { id: 'lowcode-trends-ai', title: '2.2 AI 辅助开发的兴起', sourceIds: ['lowcode-mckinsey-genai'], children: [] },
      ] },
      { id: 'lowcode-competition', title: '3. 厂商竞争与生态格局', sourceIds: ['lowcode-power-platform', 'lowcode-forrester-governance'], children: [
        { id: 'lowcode-competition-ecosystem', title: '3.1 头部厂商生态布局', sourceIds: ['lowcode-power-platform'], children: [] },
        { id: 'lowcode-competition-governance', title: '3.2 治理与专业扩展差异', sourceIds: ['lowcode-forrester-governance'], children: [] },
      ] },
      { id: 'lowcode-recommendation', title: '4. 企业选型与落地建议', sourceIds: lowCodeSources.map((source) => source.id), children: [] },
    ],
    report: { title: 'AI 低代码平台市场研究：增长动力与竞争格局', sections: lowCodeReport },
    usesPrototypeData: false,
  },
  {
    id: 'contract-risk',
    topic: '企业合同签订流程与风险分析',
    keywords: ['合同', '签订', '法务', '协议'],
    summary: '企业合同风险贯穿需求、审查、审批、签署和履约交接，关键在于建立版本一致、授权清晰且证据完整的端到端流程。',
    insights: [
      { id: 'contract-control', title: '流程断点比单一条款更危险', description: '需求、审批、签署与履约数据脱节，会放大越权、版本替换和责任不清风险。', sourceId: 'contract-lifecycle-whitepaper' },
      { id: 'contract-dispute', title: '验收与变更是高频争议点', description: '交付标准不清、证据不足和变更程序缺失，是企业合同纠纷的集中来源。', sourceId: 'contract-dispute-cases' },
      { id: 'contract-evidence', title: '数字签署需要完整证据链', description: '身份认证、签署意愿、文档完整性和时间证据必须共同保存。', sourceId: 'contract-esign-maturity' },
    ],
    sources: contractSources,
    outline: [
      { id: 'contract-scope', title: '1. 合同签订流程范围与现状', sourceIds: ['contract-lifecycle-whitepaper', 'contract-audit-practice'], children: [
        { id: 'contract-scope-roles', title: '1.1 业务、法务与审批角色', sourceIds: ['contract-lifecycle-whitepaper'], children: [] },
        { id: 'contract-scope-gap', title: '1.2 现有流程断点识别', sourceIds: ['contract-audit-practice'], children: [] },
      ] },
      { id: 'contract-controls', title: '2. 合同审批与签署控制点', sourceIds: ['contract-lifecycle-whitepaper', 'contract-audit-practice', 'contract-esign-maturity'], children: [
        { id: 'contract-controls-approval', title: '2.1 授权矩阵与分级审批', sourceIds: ['contract-lifecycle-whitepaper', 'contract-audit-practice'], children: [] },
        { id: 'contract-controls-sign', title: '2.2 印章、电子签名与版本一致性', sourceIds: ['contract-esign-maturity', 'contract-audit-practice'], children: [] },
      ] },
      { id: 'contract-risks', title: '3. 核心条款与履约风险', sourceIds: ['contract-dispute-cases', 'contract-lifecycle-whitepaper'], children: [
        { id: 'contract-risks-delivery', title: '3.1 交付、验收与付款风险', sourceIds: ['contract-dispute-cases'], children: [] },
        { id: 'contract-risks-change', title: '3.2 变更、解除与争议解决', sourceIds: ['contract-dispute-cases'], children: [] },
      ] },
      { id: 'contract-roadmap', title: '4. 合同流程优化路线', sourceIds: contractSources.map((source) => source.id), children: [] },
    ],
    report: { title: '企业合同签订流程与风险分析：流程控制与合规建议', sections: contractReport },
    usesPrototypeData: false,
  },
  {
    id: 'smart-cockpit-voice',
    topic: '智能座舱 AI 语音交互趋势研究',
    keywords: ['座舱', '车载', '语音', 'hmi'],
    summary: '智能座舱 AI 语音交互正从单轮指令走向连续对话、场景理解和多模态协同，任务成功率、安全边界与端云成本决定落地质量。',
    insights: [
      { id: 'cockpit-evolution', title: '语音交互进入场景理解阶段', description: '大模型让座舱助手具备连续对话和跨域任务协同能力。', sourceId: 'cockpit-industry-trend' },
      { id: 'cockpit-success', title: '任务成功率决定用户信任', description: '响应稳定、错误恢复和反馈透明度比单纯拟人化表达更重要。', sourceId: 'cockpit-user-experience' },
      { id: 'cockpit-multimodal', title: '多模态 HMI 成为技术主线', description: '语音需要与屏幕、视线、触控和车辆状态共享统一意图。', sourceId: 'cockpit-hmi-architecture' },
    ],
    sources: cockpitSources,
    outline: [
      { id: 'cockpit-background', title: '1. 智能座舱语音交互演进', sourceIds: ['cockpit-industry-trend', 'cockpit-user-experience'], children: [
        { id: 'cockpit-background-stage', title: '1.1 从指令控制到场景助手', sourceIds: ['cockpit-industry-trend'], children: [] },
        { id: 'cockpit-background-user', title: '1.2 用户需求与高频场景', sourceIds: ['cockpit-user-experience'], children: [] },
      ] },
      { id: 'cockpit-technology', title: '2. 大模型与多模态 HMI 技术趋势', sourceIds: ['cockpit-industry-trend', 'cockpit-hmi-architecture'], children: [
        { id: 'cockpit-technology-model', title: '2.1 座舱大模型能力边界', sourceIds: ['cockpit-industry-trend'], children: [] },
        { id: 'cockpit-technology-hmi', title: '2.2 多模态融合与端云协同', sourceIds: ['cockpit-hmi-architecture'], children: [] },
      ] },
      { id: 'cockpit-experience', title: '3. 用户体验与安全约束', sourceIds: ['cockpit-user-experience', 'cockpit-hmi-architecture'], children: [] },
      { id: 'cockpit-competition', title: '4. 产品竞争与演进判断', sourceIds: cockpitSources.map((source) => source.id), children: [] },
    ],
    report: { title: '智能座舱 AI 语音交互趋势研究：体验、技术与产品演进', sections: cockpitReport },
    usesPrototypeData: false,
  },
]

export const defaultResearchTopic = researchTopics[0]

const topicCorrectionRules = [
  { incorrect: '具生智能', correct: '具身智能' },
  { incorrect: '低代吗', correct: '低代码' },
  { incorrect: '无代吗', correct: '无代码' },
] as const

export function normalizeTopicInput(input: string) {
  return input.normalize('NFKC').trim().replace(/\s+/g, ' ')
}

export function getTopicCorrection(input: string): TopicCorrection | null {
  const inputTopic = normalizeTopicInput(input)
  const suggestedTopic = topicCorrectionRules.reduce(
    (topic, rule) => topic.replaceAll(rule.incorrect, rule.correct),
    inputTopic,
  )
  return suggestedTopic !== inputTopic ? { inputTopic, suggestedTopic } : null
}

export function matchResearchTopic(input: string): ResearchTopicData | null {
  const normalizedInput = normalizeTopicInput(input).toLocaleLowerCase()
  return researchTopics.find((dataset) =>
    dataset.keywords.some((keyword) =>
      normalizedInput.includes(keyword.normalize('NFKC').toLocaleLowerCase()),
    ),
  ) ?? null
}

function createTopicHash(topic: string) {
  let hash = 0
  for (const character of topic) {
    hash = (hash * 31 + character.charCodeAt(0)) | 0
  }
  return Math.abs(hash).toString(36)
}

export function createGenericResearchTopic(input: string): ResearchTopicData {
  const topic = normalizeTopicInput(input) || '未命名研究主题'
  const prefix = `generic-${createTopicHash(topic)}`
  const sources: Source[] = [
    {
      id: `${prefix}-overview`, rank: 1, title: `${topic}：行业概览与关键问题`, type: 'report', publisher: '原型研究资料库', publishDate: '2024-04-18', freshness: '刚刚', credibility: 'medium',
      summary: `${topic}的通用行业概览，整理研究边界、主要参与者与当前关键问题。`, keyInsight: `${topic}需要先明确研究口径，再对关键参与者、现状数据与变化驱动进行交叉验证。`, tags: [topic, '行业概览', '研究边界'], url: `https://example.com/prototype/${prefix}/overview`, addedToPool: false,
      excerpt: [`${topic}当前缺少真实检索结果，本段用于演示如何组织行业范围与问题清单。`, `${topic}后续应接入权威行业报告、官方数据和一手访谈进行验证。`], insights: [`${topic}的研究口径需要优先确认。`, `${topic}的关键数据需要多来源交叉验证。`, `${topic}的参与者和利益关系需要系统梳理。`],
    },
    {
      id: `${prefix}-practice`, rank: 2, title: `${topic}：实践案例与实施路径`, type: 'web', publisher: '原型案例中心', publishDate: '2024-04-16', freshness: '1 天前', credibility: 'medium',
      summary: `${topic}的通用实践案例占位内容，展示典型场景、实施步骤与阶段性成果。`, keyInsight: `${topic}的实施应从边界清晰、风险可控的场景开始，并建立可量化的阶段目标。`, tags: [topic, '实践案例', '实施路径'], url: `https://example.com/prototype/${prefix}/practice`, addedToPool: false,
      excerpt: [`${topic}的原型案例建议采用小范围验证、指标复盘和逐步扩展的实施方式。`, `${topic}的实施效果需要同时观察业务价值、组织成本与风险变化。`], insights: [`${topic}适合采用分阶段实施。`, `${topic}需要明确可量化指标。`, `${topic}的试点结果应形成复用资产。`],
    },
    {
      id: `${prefix}-risk`, rank: 3, title: `${topic}：风险、治理与合规观察`, type: 'pdf', publisher: '原型风险观察站', publishDate: '2024-04-12', freshness: '3 天前', credibility: 'medium',
      summary: `${topic}的通用风险分析占位内容，覆盖治理责任、数据质量、合规和执行风险。`, keyInsight: `${topic}不能只评估潜在收益，还应同步定义责任边界、审查机制和异常处理流程。`, tags: [topic, '风险治理', '合规'], url: `https://example.com/prototype/${prefix}/risk`, addedToPool: false,
      excerpt: [`${topic}的风险清单应与实际业务流程和责任人对应。`, `${topic}的关键决策需要保留依据、版本和复核记录。`], insights: [`${topic}需要明确治理责任。`, `${topic}应建立数据与证据标准。`, `${topic}必须设计异常处理流程。`],
    },
    {
      id: `${prefix}-trend`, rank: 4, title: `${topic}：趋势信号与决策建议`, type: 'news', publisher: '原型趋势实验室', publishDate: '2024-04-08', freshness: '1 周前', credibility: 'medium',
      summary: `${topic}的通用趋势占位内容，归纳可能的变化信号、决策变量与后续跟踪方向。`, keyInsight: `${topic}的趋势判断应区分短期信号与长期结构变化，并持续更新关键假设。`, tags: [topic, '趋势判断', '决策建议'], url: `https://example.com/prototype/${prefix}/trend`, addedToPool: false,
      excerpt: [`${topic}的趋势信号需要通过时间序列和不同来源持续校验。`, `${topic}的决策建议应明确适用条件和不确定性。`], insights: [`${topic}需要区分短期与长期信号。`, `${topic}的判断依赖关键假设。`, `${topic}应建立持续跟踪指标。`],
    },
  ]

  const sections: ReportSectionData[] = [
    { id: `${prefix}-report-summary`, heading: `${topic}：研究概览`, paragraphs: [{ id: `${prefix}-summary-p`, segments: [text(`${topic}当前采用前端动态原型数据，用于展示从主题理解、来源整理到结论形成的完整研究链路`), citation(`${prefix}-overview`), text('。')] }] },
    { id: `${prefix}-report-practice`, heading: `${topic}：实践路径`, paragraphs: [{ id: `${prefix}-practice-p`, segments: [text(`${topic}建议从边界明确的小范围场景开始验证，建立业务价值、实施成本和风险指标后再逐步扩展`), citation(`${prefix}-practice`), text('。')] }] },
    { id: `${prefix}-report-risk`, heading: `${topic}：风险与治理`, paragraphs: [{ id: `${prefix}-risk-p`, segments: [text(`${topic}需要同步定义责任边界、数据标准、复核机制和异常处理流程，避免原型结论被误用为真实研究结果`), citation(`${prefix}-risk`), text('。')] }], insight: `${topic}当前为产品原型演示数据，正式决策前必须接入真实来源复核。` },
    { id: `${prefix}-report-trend`, heading: `${topic}：趋势与后续研究`, paragraphs: [{ id: `${prefix}-trend-p`, segments: [text(`${topic}后续应持续跟踪关键指标、验证核心假设，并用真实行业报告、官方数据和访谈替换当前占位内容`), citation(`${prefix}-trend`), text('。')] }] },
  ]

  return {
    id: prefix,
    topic,
    keywords: [topic],
    summary: `${topic}当前使用产品原型演示数据，内容围绕${topic}的研究范围、实践路径、风险治理与趋势判断动态生成。`,
    insights: [
      { id: `${prefix}-scope-insight`, title: `${topic}的研究边界需要确认`, description: `${topic}应先定义研究对象、时间范围和评估口径。`, sourceId: `${prefix}-overview` },
      { id: `${prefix}-practice-insight`, title: `${topic}的实践路径需要分阶段`, description: `${topic}适合从小范围验证开始，再依据指标逐步扩展。`, sourceId: `${prefix}-practice` },
      { id: `${prefix}-risk-insight`, title: `${topic}的风险治理需要同步设计`, description: `${topic}必须明确责任、证据和异常处理机制。`, sourceId: `${prefix}-risk` },
    ],
    sources,
    outline: [
      { id: `${prefix}-outline-scope`, title: `1. ${topic}的研究范围与核心问题`, sourceIds: [`${prefix}-overview`], children: [] },
      { id: `${prefix}-outline-practice`, title: `2. ${topic}的实践案例与实施路径`, sourceIds: [`${prefix}-practice`], children: [] },
      { id: `${prefix}-outline-risk`, title: `3. ${topic}的风险、治理与合规`, sourceIds: [`${prefix}-risk`], children: [] },
      { id: `${prefix}-outline-trend`, title: `4. ${topic}的趋势判断与决策建议`, sourceIds: [`${prefix}-trend`], children: [] },
    ],
    report: { title: `${topic}：产品原型研究报告`, sections },
    usesPrototypeData: true,
  }
}

export function selectResearchTopic(input: string): ResearchTopicData {
  return matchResearchTopic(input) ?? createGenericResearchTopic(input)
}

export function resolveResearchTopic(topicId: string, query: string): ResearchTopicData {
  if (topicId.startsWith('generic-')) return createGenericResearchTopic(query)
  return researchTopics.find((dataset) => dataset.id === topicId)
    ?? matchResearchTopic(query)
    ?? createGenericResearchTopic(query)
}

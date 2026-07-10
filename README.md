# AI Research Workspace

基于 Stitch 多页原型重新构建的专业 AI 研究工作台。项目不是逐页复制 HTML，而是先按原型中的 `DESIGN.md` 收敛设计 token，再用共享组件和统一状态流实现六个页面。

## 技术栈

- React 18
- TypeScript
- Vite
- Tailwind CSS
- React Router
- Lucide React

## 启动

```bash
npm install
npm run dev
```

生产构建：

```bash
npm run build
```

## 页面路由

| 路由 | 页面 |
| --- | --- |
| `/` | 创建研究任务 |
| `/plan` | 研究计划确认与编辑 |
| `/search` | AI 搜索 |
| `/sources/:sourceId` | 来源详情 |
| `/pool` | 资料池 |
| `/outline` | 研究大纲 |
| `/report` | 研究报告 |

## Mock 工作流

1. 输入研究主题；检测到常见错词时，可确认标准主题或保留原输入。
2. 查看主题对应的研究计划，并编辑研究范围、核心问题与来源偏好。
3. 确认计划，经过约 2.2 秒的四阶段模拟研究过程后进入 AI 搜索。
4. 将搜索结果中的来源加入资料池。
5. 在资料池把资料标记为“可信 / 存疑 / 无关”。
6. 仅用资料池中未标记为“无关”的来源生成研究大纲。
7. 每个大纲章节实时显示关联来源数量。
8. 从大纲生成报告，点击正文引用标记可联动右侧引用来源面板。

当前主题、研究计划和演示工作区状态均保存在浏览器 `localStorage` 中。项目不连接真实后端，也不会发起真实研究或导出服务请求。

## 动态主题数据

前端会根据研究主题切换完整的数据集：

- “低代码 / 无代码 / Power Platform”匹配 AI 低代码平台市场研究。
- “合同 / 签订 / 法务 / 协议”匹配企业合同签订流程与风险分析。
- “座舱 / 车载 / 语音 / HMI”匹配智能座舱 AI 语音交互趋势研究。

未匹配的输入会生成一套包含用户原始主题的通用占位数据，并在所有研究页面显示“当前为产品原型演示数据”。主题数据、匹配器和通用生成器位于 `src/data/researchTopics.ts`，主题化研究计划模板位于 `src/data/researchPlans.ts`。

## 设计系统

设计依据：`stitch_ai_research_workbench/stitch_ai_research_workbench/synthesized_intelligence/DESIGN.md`。

- 固定 260px 侧栏与 56px 顶栏；移动端侧栏切换为抽屉。
- 工作区画布 `#F8FAFC`，白色卡片，边框 `#E2E8F0`。
- 主操作色 `#2563EB`，深色链接与强调文字 `#004AC6`。
- 字体栈：Inter、PingFang SC、Microsoft YaHei、系统字体。
- 按钮与输入框使用 8px 圆角，主卡片使用 12px 圆角。
- AI 生成内容统一使用浅蓝背景和 2px 蓝色左边框。

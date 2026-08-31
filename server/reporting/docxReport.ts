import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  LineRuleType,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  TextRun,
  UnderlineType,
} from 'docx'
import type { ReportDocument, ReportDocumentSection } from './reportDocument'
import { formatReportDate, reportDepthLabel, researchDepthLabel } from './reportDocument'

const FONT = 'Noto Sans SC'
const INK = '172033'
const MUTED = '5F6B7A'
const PRIMARY = '155EEF'

function headingLevel(level: ReportDocumentSection['level']) {
  if (level === 1) return HeadingLevel.HEADING_1
  if (level === 2) return HeadingLevel.HEADING_2
  return HeadingLevel.HEADING_3
}

function bodyParagraph(content: string, citationIndexes: number[] = []) {
  const children = [new TextRun({ text: content, font: FONT, color: MUTED, size: 21 })]
  if (citationIndexes.length > 0) {
    children.push(new TextRun({
      text: ` ${citationIndexes.map((index) => `[${index}]`).join('')}`,
      font: FONT,
      color: PRIMARY,
      size: 19,
      bold: true,
    }))
  }
  return new Paragraph({
    children,
    alignment: AlignmentType.JUSTIFIED,
    spacing: { line: 360, lineRule: LineRuleType.AUTO, after: 180 },
    widowControl: true,
  })
}

function heading(text: string, level: ReportDocumentSection['level']) {
  return new Paragraph({
    text,
    heading: headingLevel(level),
    spacing: { before: level === 1 ? 320 : 220, after: 140 },
    keepNext: true,
  })
}

function bullet(text: string) {
  return new Paragraph({
    text,
    bullet: { level: 0 },
    spacing: { line: 300, after: 100 },
  })
}

export async function generateDocxReport(report: ReportDocument) {
  const children: Paragraph[] = [
    new Paragraph({
      children: [new TextRun({ text: 'AI RESEARCH WORKSPACE', bold: true, color: PRIMARY, size: 24, font: FONT })],
      spacing: { before: 1000, after: 500 },
    }),
    new Paragraph({
      children: [new TextRun({ text: report.title, bold: true, color: INK, size: 52, font: FONT })],
      heading: HeadingLevel.TITLE,
      spacing: { after: 240 },
    }),
    new Paragraph({
      children: [new TextRun({ text: report.subtitle, color: MUTED, size: 26, font: FONT })],
      spacing: { after: 600 },
    }),
    new Paragraph({
      children: [new TextRun({ text: '研究目标', bold: true, color: INK, size: 22, font: FONT })],
      spacing: { after: 100 },
    }),
    bodyParagraph(report.researchGoal || '未单独记录研究目标'),
    new Paragraph({
      children: [new TextRun({ text: `生成时间：${formatReportDate(report.generatedAt, true)}`, font: FONT, color: MUTED, size: 19 })],
      spacing: { before: 360, after: 80 },
    }),
    new Paragraph({ text: `研究深度：${researchDepthLabel(report.researchDepth)}`, spacing: { after: 80 } }),
    new Paragraph({ text: `报告规格：${reportDepthLabel(report.reportDepth)}`, spacing: { after: 80 } }),
    new Paragraph({ text: `引用来源：${report.sourceCount} 条`, spacing: { after: 80 } }),
    new Paragraph({ text: `报告字数：${report.wordCount} 字`, spacing: { after: 80 } }),
    new Paragraph({ children: [new PageBreak()] }),
    new Paragraph({ text: '执行摘要', heading: HeadingLevel.HEADING_1, keepNext: true }),
    bodyParagraph(report.executiveSummary),
    new Paragraph({ text: '目录', heading: HeadingLevel.HEADING_1, keepNext: true }),
    new Paragraph({
      children: [new TextRun({ text: '正文已使用 Word 标准标题层级，可在 Word 中插入自动目录。', italics: true, color: MUTED, font: FONT, size: 18 })],
      spacing: { after: 160 },
    }),
  ]

  report.sections.forEach((section, index) => {
    children.push(new Paragraph({
      children: [new TextRun({
        text: `${index + 1}. ${section.title}`,
        bold: section.level === 1,
        color: section.level === 1 ? INK : MUTED,
        font: FONT,
        size: section.level === 1 ? 21 : 19,
      })],
      indent: { left: (section.level - 1) * 360 },
      spacing: { after: 80 },
    }))
  })
  children.push(new Paragraph({ spacing: { after: 160 } }))

  report.sections.forEach((section) => {
    children.push(heading(section.title, section.level))
    section.paragraphs.forEach((paragraph) => {
      children.push(bodyParagraph(paragraph.content, paragraph.citationIndexes))
    })
  })

  if (report.conclusion) {
    children.push(new Paragraph({ text: '关键结论', heading: HeadingLevel.HEADING_1, keepNext: true }))
    children.push(bodyParagraph(report.conclusion))
  }

  children.push(new Paragraph({ text: '研究限制', heading: HeadingLevel.HEADING_1, keepNext: true }))
  report.limitations.forEach((limitation) => children.push(bullet(limitation)))
  if (report.warnings.length > 0) {
    children.push(new Paragraph({ text: '生成提示', heading: HeadingLevel.HEADING_2, keepNext: true }))
    report.warnings.forEach((warning) => children.push(bullet(warning)))
  }

  children.push(new Paragraph({ text: 'References / 参考来源', heading: HeadingLevel.HEADING_1, keepNext: true }))
  if (report.references.length === 0) {
    children.push(bodyParagraph('本报告暂无可追溯引用来源。'))
  } else {
    report.references.forEach((reference) => {
      children.push(new Paragraph({
        children: [new TextRun({ text: `[${reference.index}] ${reference.title}`, bold: true, color: INK, font: FONT, size: 21 })],
        spacing: { before: 160, after: 60 },
        keepNext: true,
      }))
      const sourceMeta = [reference.publisher, reference.publishedAt].filter(Boolean).join(' · ')
      if (sourceMeta) {
        children.push(new Paragraph({
          children: [new TextRun({ text: sourceMeta, color: MUTED, font: FONT, size: 18 })],
          spacing: { after: 50 },
          keepNext: true,
        }))
      }
      children.push(new Paragraph({
        children: [new ExternalHyperlink({
          link: reference.url,
          children: [new TextRun({
            text: reference.url,
            color: PRIMARY,
            font: FONT,
            size: 18,
            underline: { type: UnderlineType.SINGLE },
          })],
        })],
        spacing: { after: 180 },
      }))
    })
  }

  const emptyFirstHeader = new Header({ children: [new Paragraph('')] })
  const emptyFirstFooter = new Footer({ children: [new Paragraph('')] })
  const document = new Document({
    creator: 'AI Research Workspace',
    title: report.title,
    subject: report.researchGoal,
    description: 'Deep Research Report',
    styles: {
      default: {
        document: {
          run: { font: FONT, color: INK, size: 21 },
          paragraph: { spacing: { line: 360, lineRule: LineRuleType.AUTO, after: 160 } },
        },
        title: { run: { font: FONT, color: INK, size: 52, bold: true } },
        heading1: { run: { font: FONT, color: INK, size: 32, bold: true } },
        heading2: { run: { font: FONT, color: INK, size: 27, bold: true } },
        heading3: { run: { font: FONT, color: INK, size: 23, bold: true } },
      },
    },
    sections: [{
      properties: {
        titlePage: true,
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1134, right: 1134, bottom: 1134, left: 1134, header: 500, footer: 500 },
        },
      },
      headers: {
        first: emptyFirstHeader,
        default: new Header({
          children: [new Paragraph({
            children: [new TextRun({ text: 'AI Research Workspace', color: MUTED, font: FONT, size: 16 })],
          })],
        }),
      },
      footers: {
        first: emptyFirstFooter,
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({
              children: [`${formatReportDate(report.generatedAt)}    `, 'Page ', PageNumber.CURRENT, ' / ', PageNumber.TOTAL_PAGES],
              color: MUTED,
              font: FONT,
              size: 16,
            })],
          })],
        }),
      },
      children,
    }],
  })

  return Packer.toBuffer(document)
}

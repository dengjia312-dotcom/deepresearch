import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'
import { createFont } from 'fonteditor-core'
import PDFDocument from 'pdfkit'
import type { ReportDocument, ReportDocumentSection } from './reportDocument'
import { formatReportDate, reportDepthLabel, researchDepthLabel } from './reportDocument'

const regularFontPath = fileURLToPath(new URL('../assets/fonts/NotoSansSC-Regular.woff', import.meta.url))
const boldFontPath = fileURLToPath(new URL('../assets/fonts/NotoSansSC-Bold.woff', import.meta.url))
let cachedFonts: { regular: Buffer; bold: Buffer } | null = null

const PAGE_MARGIN = 57
const INK = '#172033'
const MUTED = '#5F6B7A'
const PRIMARY = '#155EEF'
const LIGHT_BLUE = '#EFF6FF'
const OUTLINE = '#D8DEE8'

function convertWoffToTtf(path: string) {
  return createFont(readFileSync(path), {
    type: 'woff',
    inflate: (value) => Array.from(inflateSync(Buffer.from(value))),
  }).write({ type: 'ttf', toBuffer: true })
}

function getPdfFonts() {
  if (!cachedFonts) {
    cachedFonts = {
      regular: convertWoffToTtf(regularFontPath),
      bold: convertWoffToTtf(boldFontPath),
    }
  }
  return cachedFonts
}

function citationText(indexes: number[]) {
  return indexes.map((index) => `[${index}]`).join('')
}

function sectionFontSize(section: ReportDocumentSection) {
  if (section.level === 1) return 17
  if (section.level === 2) return 14
  return 12.5
}

function collectPdfBuffer(pdf: PDFKit.PDFDocument) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    pdf.on('data', (chunk: Buffer) => chunks.push(chunk))
    pdf.on('end', () => resolve(Buffer.concat(chunks)))
    pdf.on('error', reject)
  })
}

export async function generatePdfReport(report: ReportDocument) {
  const fonts = getPdfFonts()
  const pdf = new PDFDocument({
    size: 'A4',
    margins: { top: 72, right: PAGE_MARGIN, bottom: 72, left: PAGE_MARGIN },
    bufferPages: true,
    info: {
      Title: report.title,
      Author: 'AI Research Workspace',
      Subject: report.researchGoal,
      CreationDate: new Date(report.generatedAt),
    },
  })
  const completed = collectPdfBuffer(pdf)
  pdf.registerFont('NotoSansSC', fonts.regular)
  pdf.registerFont('NotoSansSCBold', fonts.bold)
  pdf.font('NotoSansSC').fillColor(INK)

  const contentWidth = pdf.page.width - PAGE_MARGIN * 2
  const pageBottom = () => pdf.page.height - pdf.page.margins.bottom
  const ensureSpace = (height: number) => {
    if (pdf.y + height > pageBottom()) pdf.addPage()
  }
  const writeHeading = (text: string, size: number, color = INK) => {
    ensureSpace(size * 2.6)
    pdf.font('NotoSansSCBold').fontSize(size).fillColor(color).text(text, {
      width: contentWidth,
      lineGap: 3,
    })
    pdf.moveDown(0.55)
  }
  const writeBody = (text: string, options: { color?: string; gap?: number } = {}) => {
    pdf.font('NotoSansSC').fontSize(10.5).fillColor(options.color ?? MUTED).text(text, {
      width: contentWidth,
      align: 'left',
      lineGap: 6,
      features: [],
    })
    pdf.moveDown(options.gap ?? 0.8)
  }

  // Cover
  pdf.rect(0, 0, pdf.page.width, 18).fill(PRIMARY)
  pdf.font('NotoSansSCBold').fontSize(12).fillColor(PRIMARY)
    .text('AI RESEARCH WORKSPACE', PAGE_MARGIN, 86, { characterSpacing: 1 })
  pdf.font('NotoSansSCBold').fontSize(29).fillColor(INK)
    .text(report.title, PAGE_MARGIN, 155, { width: contentWidth, lineGap: 8 })
  pdf.font('NotoSansSC').fontSize(13).fillColor(MUTED)
    .text(report.subtitle, PAGE_MARGIN, pdf.y + 17, { width: contentWidth })
  pdf.moveTo(PAGE_MARGIN, pdf.y + 32).lineTo(PAGE_MARGIN + 76, pdf.y + 32)
    .lineWidth(3).strokeColor(PRIMARY).stroke()
  pdf.font('NotoSansSCBold').fontSize(10).fillColor(INK)
    .text('研究目标', PAGE_MARGIN, pdf.y + 60)
  pdf.font('NotoSansSC').fontSize(10.5).fillColor(MUTED)
    .text(report.researchGoal || '未单独记录研究目标', PAGE_MARGIN, pdf.y + 10, {
      width: contentWidth,
      lineGap: 5,
      features: [],
    })

  const metadataY = Math.max(pdf.y + 55, 555)
  const metadata = [
    ['生成时间', formatReportDate(report.generatedAt, true)],
    ['研究深度', researchDepthLabel(report.researchDepth)],
    ['报告规格', reportDepthLabel(report.reportDepth)],
    ['引用来源', `${report.sourceCount} 条`],
    ['报告字数', `${report.wordCount} 字`],
  ]
  metadata.forEach(([label, value], index) => {
    const x = PAGE_MARGIN + (index % 2) * 235
    const y = metadataY + Math.floor(index / 2) * 55
    pdf.font('NotoSansSC').fontSize(8.5).fillColor(MUTED).text(label, x, y)
    pdf.font('NotoSansSCBold').fontSize(10.5).fillColor(INK).text(value, x, y + 18)
  })

  // Main document
  pdf.addPage()
  writeHeading('执行摘要', 21)
  pdf.roundedRect(PAGE_MARGIN, pdf.y, contentWidth, 1, 0).fill(OUTLINE)
  pdf.moveDown(1)
  writeBody(report.executiveSummary, { color: INK, gap: 1.2 })

  writeHeading('目录', 21)
  report.sections.forEach((section, index) => {
    ensureSpace(24)
    const indent = (section.level - 1) * 18
    pdf.font(section.level === 1 ? 'NotoSansSCBold' : 'NotoSansSC')
      .fontSize(section.level === 1 ? 10.5 : 9.5)
      .fillColor(section.level === 1 ? INK : MUTED)
      .text(`${index + 1}. ${section.title}`, PAGE_MARGIN + indent, pdf.y, {
        width: contentWidth - indent,
        lineGap: 3,
      })
    pdf.moveDown(0.35)
  })

  report.sections.forEach((section) => {
    pdf.moveDown(0.9)
    writeHeading(section.title, sectionFontSize(section))
    section.paragraphs.forEach((paragraph) => {
      const citations = citationText(paragraph.citationIndexes)
      writeBody(citations ? `${paragraph.content} ${citations}` : paragraph.content)
    })
  })

  if (report.conclusion) {
    pdf.moveDown(0.8)
    writeHeading('关键结论', 17)
    writeBody(report.conclusion)
  }

  writeHeading('研究限制', 17)
  report.limitations.forEach((limitation) => writeBody(`• ${limitation}`, { gap: 0.35 }))
  if (report.warnings.length > 0) {
    pdf.moveDown(0.6)
    pdf.roundedRect(PAGE_MARGIN, pdf.y, contentWidth, 1, 0).fill(OUTLINE)
    pdf.moveDown(0.7)
    pdf.font('NotoSansSCBold').fontSize(10.5).fillColor(INK).text('生成提示')
    pdf.moveDown(0.35)
    report.warnings.forEach((warning) => writeBody(`• ${warning}`, { gap: 0.25 }))
  }

  pdf.addPage()
  writeHeading('References / 参考来源', 19)
  if (report.references.length === 0) {
    writeBody('本报告暂无可追溯引用来源。')
  } else {
    report.references.forEach((reference) => {
      ensureSpace(60)
      pdf.font('NotoSansSCBold').fontSize(10.5).fillColor(INK)
        .text(`[${reference.index}] ${reference.title}`, { width: contentWidth, lineGap: 3 })
      const sourceMeta = [reference.publisher, reference.publishedAt].filter(Boolean).join(' · ')
      if (sourceMeta) {
        pdf.font('NotoSansSC').fontSize(9).fillColor(MUTED)
          .text(sourceMeta, { width: contentWidth, lineGap: 2 })
      }
      pdf.font('NotoSansSC').fontSize(8.5).fillColor(PRIMARY)
        .text(reference.url, { width: contentWidth, lineGap: 2, link: reference.url, underline: true })
      pdf.moveDown(0.8)
    })
  }

  const pageRange = pdf.bufferedPageRange()
  for (let pageIndex = 1; pageIndex < pageRange.count; pageIndex += 1) {
    pdf.switchToPage(pageRange.start + pageIndex)
    const savedX = pdf.x
    const savedY = pdf.y
    const savedTopMargin = pdf.page.margins.top
    const savedBottomMargin = pdf.page.margins.bottom
    pdf.page.margins.top = 0
    pdf.page.margins.bottom = 0
    pdf.font('NotoSansSC').fontSize(8).fillColor(MUTED)
      .text('AI Research Workspace', PAGE_MARGIN, 29, {
        width: contentWidth,
        align: 'left',
        lineBreak: false,
      })
    pdf.moveTo(PAGE_MARGIN, 49).lineTo(PAGE_MARGIN + contentWidth, 49)
      .lineWidth(0.5).strokeColor(OUTLINE).stroke()
    pdf.moveTo(PAGE_MARGIN, pdf.page.height - 48)
      .lineTo(PAGE_MARGIN + contentWidth, pdf.page.height - 48)
      .lineWidth(0.5).strokeColor(OUTLINE).stroke()
    pdf.font('NotoSansSC').fontSize(8).fillColor(MUTED)
      .text(formatReportDate(report.generatedAt), PAGE_MARGIN, pdf.page.height - 36, {
        width: contentWidth / 2,
        lineBreak: false,
      })
    pdf.text(`${pageIndex} / ${pageRange.count - 1}`, PAGE_MARGIN + contentWidth / 2, pdf.page.height - 36, {
      width: contentWidth / 2,
      align: 'right',
      lineBreak: false,
    })
    pdf.x = savedX
    pdf.y = savedY
    pdf.page.margins.top = savedTopMargin
    pdf.page.margins.bottom = savedBottomMargin
  }

  pdf.end()
  return completed
}

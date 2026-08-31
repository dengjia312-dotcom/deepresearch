import type { Pool } from 'pg'
import { getOwnedTaskDetail } from '../db/repositories/taskRepository'
import { getDatabasePool } from '../db/pool'
import { generateDocxReport } from './docxReport'
import { generatePdfReport } from './pdfReport'
import { buildReportDocument, sanitizeReportFilename } from './reportDocument'

export type ReportExportFormat = 'pdf' | 'docx'

const exportMetadata = {
  pdf: { contentType: 'application/pdf' },
  docx: { contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
} as const

export async function exportOwnedReport(
  ownerSessionId: string,
  taskId: string,
  format: ReportExportFormat,
  pool: Pool = getDatabasePool(),
) {
  const detail = await getOwnedTaskDetail(ownerSessionId, taskId, pool)
  const document = buildReportDocument(detail)
  const buffer = format === 'pdf'
    ? await generatePdfReport(document)
    : await generateDocxReport(document)
  if (buffer.length === 0) throw new Error('Report export produced an empty file.')
  return {
    buffer,
    filename: sanitizeReportFilename(document.title, document.generatedAt, format),
    contentType: exportMetadata[format].contentType,
  }
}

export function reportContentDisposition(filename: string) {
  const dateAndExtension = filename.match(/_(\d{4}-\d{2}-\d{2}\.(?:pdf|docx))$/i)?.[1]
    ?? filename.split('.').pop()
    ?? 'file'
  const fallback = `deep-research-report_${dateAndExtension}`.replace(/[^a-z0-9._-]/gi, '_')
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

/**
 * Client-side Excel export. Every list/table in the system exports what is on screen (after the
 * user's filters), so callers pass the already-filtered rows and the columns in display order.
 * exceljs is loaded on click only — it stays out of the page bundles.
 */
export type ExportColumn<T> = {
  header: string
  /** Pull the cell value from a row. Dates may be ISO strings or Date; booleans export as כן/לא. */
  value: (row: T) => string | number | boolean | Date | null | undefined
  width?: number
  /** Excel number format, e.g. '#,##0' or '₪#,##0'. */
  numFmt?: string
}

export type ExportSpec<T> = {
  filename: string
  sheetName?: string
  columns: ExportColumn<T>[]
  rows: T[]
}

// Spreadsheet apps run text that starts with these as a formula. Landlords/renters type free text
// into our forms, so neutralise it instead of trusting it (CSV/formula injection).
const FORMULA_START = /^[=+\-@\t\r]/

function cell(v: string | number | boolean | Date | null | undefined): string | number | Date | null {
  if (v == null || v === '') return null
  if (typeof v === 'boolean') return v ? 'כן' : 'לא'
  if (typeof v === 'string') return FORMULA_START.test(v) ? `'${v}` : v
  return v
}

/** Excel worksheet names: max 31 chars, none of  \ / ? * [ ] : */
function safeSheetName(name: string): string {
  return name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet1'
}

export function exportFilename(base: string, now = new Date()): string {
  const d = now.toISOString().slice(0, 10)
  return `${base.replace(/[\\/:*?"<>|]/g, '_')}-${d}.xlsx`
}

export async function exportToExcel<T>(spec: ExportSpec<T>): Promise<void> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(safeSheetName(spec.sheetName || spec.filename), {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }],
  })
  ws.columns = spec.columns.map(c => ({ header: c.header, width: c.width ?? Math.max(12, c.header.length + 4), style: c.numFmt ? { numFmt: c.numFmt } : {} }))
  ws.getRow(1).font = { bold: true }
  ws.getRow(1).alignment = { vertical: 'middle', horizontal: 'right' }
  for (const row of spec.rows) ws.addRow(spec.columns.map(c => cell(c.value(row))))
  if (spec.rows.length > 0) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: spec.columns.length } }

  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = exportFilename(spec.filename)
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

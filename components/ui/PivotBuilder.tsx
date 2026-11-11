'use client'
import { useMemo, useState } from 'react'
import ExportButton from './ExportButton'
import type { ExportColumn } from '../../lib/export/xlsx'

/**
 * "פילוח לפי בחירה" — the user picks what to group rows by, optionally what to split columns by,
 * and which measure to total. Works on whatever rows the screen's filters already produced, and
 * exports exactly the table on screen. Reusable: each screen passes its own dimensions/measures.
 */
export type PivotDimension<T> = { key: string; label: string; get: (row: T) => string | null | undefined }
export type PivotMeasure<T> = { key: string; label: string; money?: boolean; get?: (row: T) => number | null | undefined }

const EMPTY = 'לא צוין'
const COUNT = '__count__'

export default function PivotBuilder<T>({ rows, dimensions, measures, filename, title = 'פילוח לפי בחירה' }: {
  rows: T[]
  dimensions: PivotDimension<T>[]
  measures: PivotMeasure<T>[]
  filename: string
  title?: string
}) {
  const [rowKey, setRowKey] = useState(dimensions[0]?.key ?? '')
  const [colKey, setColKey] = useState('')
  const [measureKey, setMeasureKey] = useState(COUNT)

  const rowDim = dimensions.find(d => d.key === rowKey)
  const colDim = dimensions.find(d => d.key === colKey && d.key !== rowKey)
  const measure = measures.find(m => m.key === measureKey)
  const money = !!measure?.money
  const fmt = (n: number) => (money ? `₪${Math.round(n).toLocaleString('he-IL')}` : n.toLocaleString('he-IL'))

  const table = useMemo(() => {
    const value = (r: T) => (measure?.get ? Number(measure.get(r) ?? 0) || 0 : 1)
    const cells = new Map<string, Map<string, number>>()
    const colSet = new Set<string>()
    for (const r of rows) {
      const rk = (rowDim?.get(r) || '').trim() || EMPTY
      const ck = colDim ? (colDim.get(r) || '').trim() || EMPTY : 'סה״כ'
      colSet.add(ck)
      const line = cells.get(rk) ?? new Map<string, number>()
      line.set(ck, (line.get(ck) ?? 0) + value(r))
      cells.set(rk, line)
    }
    const cols = Array.from(colSet).sort((a, b) => (a === EMPTY ? 1 : b === EMPTY ? -1 : a.localeCompare(b, 'he')))
    const rowTotal = (rk: string) => Array.from(cells.get(rk)?.values() ?? []).reduce((s, n) => s + n, 0)
    const lines = Array.from(cells.keys()).sort((a, b) => rowTotal(b) - rowTotal(a))
    const colTotal = (ck: string) => lines.reduce((s, rk) => s + (cells.get(rk)?.get(ck) ?? 0), 0)
    return { cells, cols, lines, rowTotal, colTotal, grand: lines.reduce((s, rk) => s + rowTotal(rk), 0) }
  }, [rows, rowDim, colDim, measure])

  const sel = 'rounded-md border border-brand-border px-2 py-1.5 text-sm'
  const showTotalCol = !!colDim

  return (
    <section className="surface-card" style={{ padding: 16 }} dir="rtl">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="font-display me-2" style={{ fontSize: 18 }}>{title}</h2>
        <label className="flex items-center gap-1 text-xs text-gray-500">שורות לפי
          <select value={rowKey} onChange={e => setRowKey(e.target.value)} className={sel}>
            {dimensions.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1 text-xs text-gray-500">עמודות לפי
          <select value={colKey} onChange={e => setColKey(e.target.value)} className={sel}>
            <option value="">בלי</option>
            {dimensions.filter(d => d.key !== rowKey).map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1 text-xs text-gray-500">מדד
          <select value={measureKey} onChange={e => setMeasureKey(e.target.value)} className={sel}>
            <option value={COUNT}>מספר רשומות</option>
            {measures.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
        </label>
        <span className="ms-auto">
          <ExportButton
            label="ייצוא הפילוח"
            disabled={table.lines.length === 0}
            getSpec={() => {
              const columns: ExportColumn<string>[] = [
                { header: rowDim?.label ?? '', value: rk => rk, width: 22 },
                ...table.cols.map(ck => ({ header: ck, value: (rk: string) => table.cells.get(rk)?.get(ck) ?? 0, width: 14, ...(money ? { numFmt: '₪#,##0' } : {}) })),
                ...(showTotalCol ? [{ header: 'סה״כ', value: (rk: string) => table.rowTotal(rk), width: 14, ...(money ? { numFmt: '₪#,##0' } : {}) }] : []),
              ]
              return { filename: `${filename} - ${rowDim?.label ?? ''}${colDim ? ` x ${colDim.label}` : ''}`, rows: table.lines, columns }
            }}
          />
        </span>
      </div>

      {table.lines.length === 0 ? (
        <div className="p-6 text-center text-sm text-gray-500">אין נתונים בתצוגה הנוכחית.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500">
                <th className="border-b border-brand-border bg-gray-50 px-3 py-2 text-right font-medium">{rowDim?.label}</th>
                {table.cols.map(ck => <th key={ck} className="border-b border-brand-border bg-gray-50 px-3 py-2 text-right font-medium whitespace-nowrap">{ck}</th>)}
                {showTotalCol && <th className="border-b border-brand-border bg-gray-50 px-3 py-2 text-right font-semibold">סה״כ</th>}
              </tr>
            </thead>
            <tbody>
              {table.lines.map(rk => (
                <tr key={rk}>
                  <td className="border-b border-gray-100 px-3 py-1.5">{rk}</td>
                  {table.cols.map(ck => <td key={ck} className="border-b border-gray-100 px-3 py-1.5 num">{table.cells.get(rk)?.get(ck) ? fmt(table.cells.get(rk)!.get(ck)!) : '—'}</td>)}
                  {showTotalCol && <td className="border-b border-gray-100 px-3 py-1.5 num font-semibold">{fmt(table.rowTotal(rk))}</td>}
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="px-3 py-2">סה״כ</td>
                {table.cols.map(ck => <td key={ck} className="px-3 py-2 num">{fmt(table.colTotal(ck))}</td>)}
                {showTotalCol && <td className="px-3 py-2 num">{fmt(table.grand)}</td>}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

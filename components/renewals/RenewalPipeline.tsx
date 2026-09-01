'use client'

import { useCallback, useEffect, useState, Fragment } from 'react'
import { Loader2, AlertCircle, ChevronRight, ChevronLeft } from 'lucide-react'
import { RenewalRowCells, RENEWAL_COLSPAN_DATA, type RenewalRow } from './RenewalQueue'

type Aggregates = { byMonth: Record<string, number>; byGrade: Record<string, number>; byCity: Record<string, number>; bySegment: Record<string, number> }

const STATUS_LABEL: Record<string, string> = {
  pending: 'ממתין', sent: 'נשלח', skipped: 'דולג', replied: 'התקבלה תגובה', won: 'נסגרה עסקה', lost: 'לא צלח',
}
const STATUS_TONE: Record<string, string> = {
  pending: 'pill-outline', sent: 'pill-blue', skipped: 'pill-ink', replied: 'pill-purple', won: 'pill-green', lost: 'pill-red',
}

const PAGE_SIZE = 50

export default function RenewalPipeline() {
  const [rows, setRows] = useState<RenewalRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [aggregates, setAggregates] = useState<Aggregates | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const [cityInput, setCityInput] = useState('')
  const [city, setCity] = useState('')
  const [grade, setGrade] = useState('')
  const [segment, setSegment] = useState('')
  const [status, setStatus] = useState('')
  const [qInput, setQInput] = useState('')
  const [q, setQ] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (city) params.set('city', city)
      if (grade) params.set('grade', grade)
      if (segment) params.set('segment', segment)
      if (status) params.set('status', status)
      if (q) params.set('q', q)
      params.set('page', String(page))
      const res = await fetch(`/api/v1/renewals/pipeline?${params.toString()}`)
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data?.error?.message || data?.error?.code || 'טעינה נכשלה')
      setRows(data.rows || [])
      setTotal(data.total || 0)
      setAggregates(data.aggregates || null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'טעינה נכשלה')
    } finally {
      setLoading(false)
    }
  }, [city, grade, segment, status, q, page])

  useEffect(() => { load() }, [load])

  function applyFilters() { setCity(cityInput.trim()); setQ(qInput.trim()); setPage(1) }
  function onGrade(v: string) { setGrade(v); setPage(1) }
  function onSegment(v: string) { setSegment(v); setPage(1) }
  function onStatus(v: string) { setStatus(v); setPage(1) }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <>
      {aggregates && <MonthChart byMonth={aggregates.byMonth} />}

      <div className="flex flex-wrap items-center gap-2 my-3">
        <input
          type="text"
          placeholder="חיפוש לפי עיר…"
          value={cityInput}
          onChange={e => setCityInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') applyFilters() }}
          className="rounded-md border border-brand-border bg-white px-3 py-1.5 text-sm w-36"
        />
        <input
          type="text"
          placeholder="חיפוש חופשי (מזהה/רחוב/עיר)…"
          value={qInput}
          onChange={e => setQInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') applyFilters() }}
          className="rounded-md border border-brand-border bg-white px-3 py-1.5 text-sm w-52"
        />
        <select value={grade} onChange={e => onGrade(e.target.value)} className="rounded-md border border-brand-border bg-white px-2 py-1.5 text-sm">
          <option value="">כל הציונים</option>
          <option value="A">A</option>
          <option value="B">B</option>
          <option value="C">C</option>
          <option value="D">D</option>
        </select>
        <select value={segment} onChange={e => onSegment(e.target.value)} className="rounded-md border border-brand-border bg-white px-2 py-1.5 text-sm">
          <option value="">כל הסגמנטים</option>
          <option value="private_once">פרטי</option>
          <option value="repeat">חוזר</option>
        </select>
        <select value={status} onChange={e => onStatus(e.target.value)} className="rounded-md border border-brand-border bg-white px-2 py-1.5 text-sm">
          <option value="">כל הסטטוסים</option>
          {Object.entries(STATUS_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <button type="button" onClick={applyFilters} className="btn border border-brand-border bg-white text-gray-600 hover:bg-gray-50">סינון</button>
        <div className="flex-1" />
        <span className="text-xs text-gray-500 tnum">סה״כ {total.toLocaleString('he-IL')}</span>
      </div>

      {loading && <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-brand-primary" /></div>}
      {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"><AlertCircle className="inline h-4 w-4 ml-1" />{error}</div>}
      {!loading && !error && rows.length === 0 && (
        <div className="text-center py-12 text-gray-500">אין לידים התואמים לסינון הנוכחי.</div>
      )}

      {!loading && !error && rows.length > 0 && (
        <div className="surface-card overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b text-right text-xs text-gray-500">
                <th className="px-3 py-2 font-medium">ציון</th>
                <th className="px-3 py-2 font-medium">כתובת</th>
                <th className="px-3 py-2 font-medium">סוג</th>
                <th className="px-3 py-2 font-medium">חד׳</th>
                <th className="px-3 py-2 font-medium">מחיר</th>
                <th className="px-3 py-2 font-medium">איש קשר</th>
                <th className="px-3 py-2 font-medium">טלפון</th>
                <th className="px-3 py-2 font-medium">ירד מפרסום</th>
                <th className="px-3 py-2 font-medium">ימים בפרסום</th>
                <th className="px-3 py-2 font-medium">סבבים</th>
                <th className="px-3 py-2 font-medium">מבשיל</th>
                <th className="px-3 py-2 font-medium">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <Fragment key={row.leadId}>
                  <tr className="border-b last:border-0">
                    <RenewalRowCells row={row} />
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <span className={`pill ${STATUS_TONE[row.status] || 'pill-outline'}`}>{STATUS_LABEL[row.status] || row.status}</span>
                        <button
                          type="button"
                          onClick={() => setExpanded(expanded === row.leadId ? null : row.leadId)}
                          className="rounded-md border border-brand-border bg-white px-2 py-1 text-xs hover:bg-gray-50"
                        >
                          {expanded === row.leadId ? 'סגירה' : 'תצוגה'}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expanded === row.leadId && (
                    <tr className="border-b bg-gray-50">
                      <td colSpan={RENEWAL_COLSPAN_DATA + 1} className="px-3 py-3">
                        {row.preview ? (
                          <p className="whitespace-pre-wrap text-sm text-gray-800">{row.preview}</p>
                        ) : (
                          <p className="text-sm text-amber-700">לא ניתן להציג תצוגה מקדימה: {row.previewError || 'שגיאה לא ידועה'}</p>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !error && rows.length > 0 && (
        <div className="flex items-center justify-center gap-3 mt-4">
          <button
            type="button"
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="btn border border-brand-border bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <ChevronRight size={14} /> הקודם
          </button>
          <span className="text-xs text-gray-500 tnum">עמוד {page} מתוך {totalPages} · סה״כ {total.toLocaleString('he-IL')}</span>
          <button
            type="button"
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="btn border border-brand-border bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            הבא <ChevronLeft size={14} />
          </button>
        </div>
      )}
    </>
  )
}

/**
 * Every 'YYYY-MM' from the earliest to the latest month present in `byMonth`, inclusive — not
 * just the keys the API happened to return. The Nadlan One export currently drops one month's
 * delist `תאריך` on ingest (2027-03, root cause: the external scraper feed, not this table),
 * which leaves a real hole in the source data. Filling the full range (rather than unioning in
 * that one known-bad literal) means ANY month with zero rows — this one or a future one — still
 * renders as an explicit hatched "אין נתונים" row instead of silently vanishing from the chart.
 */
function monthRange(byMonth: Record<string, number>): string[] {
  const keys = Object.keys(byMonth).sort()
  const first = keys[0]
  const last = keys[keys.length - 1]
  if (!first || !last) return keys
  const [startY, startM] = first.split('-').map(Number)
  const [endY, endM] = last.split('-').map(Number)
  if (startY == null || startM == null || endY == null || endM == null) return keys

  const months: string[] = []
  let y = startY
  let m = startM
  while (y < endY || (y === endY && m <= endM)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`)
    m++
    if (m > 12) { m = 1; y++ }
  }
  return months
}

/** Horizontal bar chart of aggregates.byMonth. Any gap month in the range renders hatched. */
function MonthChart({ byMonth }: { byMonth: Record<string, number> }) {
  const months = monthRange(byMonth)
  const max = Math.max(1, ...Object.values(byMonth))
  return (
    <div className="surface-card mb-4" style={{ padding: 16 }}>
      <div className="text-sm font-semibold text-gray-800 mb-3">התפלגות לפי חודש הבשלה (matures_at)</div>
      <div className="flex flex-col gap-1.5">
        {months.map(m => {
          const count = byMonth[m]
          const pct = count == null ? 100 : Math.max(2, Math.round((count / max) * 100))
          return (
            <div key={m} className="flex items-center gap-2 text-xs">
              <span className="tnum shrink-0 text-gray-500" style={{ width: 64 }}>{m}</span>
              <div className="flex-1 rounded" style={{ height: 14, background: 'var(--paper-2)', overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${pct}%`,
                    height: '100%',
                    borderRadius: 4,
                    ...(count == null
                      ? { background: 'repeating-linear-gradient(45deg, #E8DFCE, #E8DFCE 4px, #FAF6F0 4px, #FAF6F0 8px)', border: '1px dashed var(--line-2)' }
                      : { background: 'var(--brand)' }),
                  }}
                />
              </div>
              <span className="tnum shrink-0 text-gray-600" style={{ width: 88 }}>{count == null ? 'אין נתונים' : count.toLocaleString('he-IL')}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

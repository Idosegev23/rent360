'use client'

import { useCallback, useEffect, useState, Fragment } from 'react'
import { Loader2, AlertCircle, Send, SkipForward, Gauge, CheckCircle2 } from 'lucide-react'

// ---------------------------------------------------------------------------
// Shared shape + row rendering — used by both /renewals tabs (RenewalPipeline
// imports RenewalRowCells/fmtDate/gradeForScore from here) so the 11 shared
// data columns (ציון..מבשיל) are built exactly once. Mirrors `RenewalRow` from
// lib/outreach/renewal-shared.ts (server-side contract, not imported directly —
// that file also pulls in supabaseService()/OpenAI helpers we don't want in
// the client bundle).
// ---------------------------------------------------------------------------

export type Grade = 'A' | 'B' | 'C' | 'D'

export type RenewalRow = {
  leadId: string; propertyId: string; externalId: string
  contactName: string | null; phone: string; phoneAlt: string | null; phoneKind: string | null
  city: string | null; street: string | null; neighborhood: string | null
  kind: string | null; rooms: number | null; sqm: number | null
  priceLast: number | null; priceChangePct: number | null
  delistedAt: string; maturesAt: string; daysOnMarket: number | null; timesListed: number
  segment: 'private_once' | 'repeat'; score: number; status: string
  preview: string | null; previewError?: string
  received: { today: number; week: number }
}

export type TemplateStatus = 'approved' | 'pending' | 'missing'
export type Templates = { private: TemplateStatus; repeat: TemplateStatus }
type Counters = { sentToday: number; dailyCap: number; remaining: number }

// Grade boundaries (80/60/40) are duplicated in three other places that cannot share code across
// JS/TSX/SQL — keep all four in sync when changing these numbers: scripts/lib/renewal-merge.mjs
// (`gradeFor`), lib/outreach/renewal-shared.ts (`gradeScoreRange`), and the CASE in
// supabase/migrations/0039_renewal_leads_aggregates_rpc.sql.
export function gradeForScore(score: number): Grade {
  if (score >= 80) return 'A'
  if (score >= 60) return 'B'
  if (score >= 40) return 'C'
  return 'D'
}
const GRADE_TONE: Record<Grade, string> = { A: 'pill-green', B: 'pill-blue', C: 'pill-amber', D: 'pill-outline' }

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' })
}
function fmtPrice(n: number | null): string {
  return n != null ? `₪${n.toLocaleString('he-IL')}` : '—'
}

/** Number of <td> cells RenewalRowCells renders — callers add their own colSpan for checkbox/actions. */
export const RENEWAL_COLSPAN_DATA = 11

/** The 11 shared data columns (ציון .. מבשיל), identical in both tabs. */
export function RenewalRowCells({ row }: { row: RenewalRow }) {
  const grade = gradeForScore(row.score)
  const priceDrop = row.priceChangePct != null && row.priceChangePct <= -3
  const manyRounds = row.timesListed >= 2
  return (
    <>
      <td className="px-3 py-2"><span className={`pill ${GRADE_TONE[grade] || 'pill-outline'}`}>{grade}</span></td>
      <td className="px-3 py-2">
        <div className="font-semibold text-gray-900">{row.street || '—'}</div>
        <div className="text-xs text-gray-500">{[row.city, row.neighborhood].filter(Boolean).join(' · ') || '—'}</div>
      </td>
      <td className="px-3 py-2 text-gray-700">{row.kind || '—'}</td>
      <td className="px-3 py-2 tnum">{row.rooms != null ? row.rooms : '—'}</td>
      <td className="px-3 py-2">
        <div className="tnum">{fmtPrice(row.priceLast)}</div>
        {priceDrop && <span className="pill pill-red" style={{ marginTop: 2 }}>{row.priceChangePct}%</span>}
      </td>
      <td className="px-3 py-2 text-gray-700">{row.contactName || 'ללא שם'}</td>
      <td className="px-3 py-2">
        <div className="tnum">{row.phone || '—'}</div>
        {row.phoneAlt && <div className="tnum text-xs text-gray-500">{row.phoneAlt}</div>}
      </td>
      <td className="px-3 py-2 tnum whitespace-nowrap">{fmtDate(row.delistedAt)}</td>
      <td className="px-3 py-2 tnum">{row.daysOnMarket != null ? row.daysOnMarket : '—'}</td>
      <td className="px-3 py-2">
        <span className="tnum">{row.timesListed}</span>
        {manyRounds && <span className="pill pill-amber" style={{ marginInlineStart: 6 }}>מספר סבבים</span>}
      </td>
      <td className="px-3 py-2 tnum whitespace-nowrap">{fmtDate(row.maturesAt)}</td>
    </>
  )
}

// ---------------------------------------------------------------------------
// Tab "מבשילים" — the due-window send queue
// ---------------------------------------------------------------------------

export default function RenewalQueue() {
  const [rows, setRows] = useState<RenewalRow[]>([])
  const [counters, setCounters] = useState<Counters | null>(null)
  const [templates, setTemplates] = useState<Templates | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<string | null>(null)
  const [cityInput, setCityInput] = useState('')
  const [city, setCity] = useState('')
  const [grade, setGrade] = useState('')
  const [segment, setSegment] = useState('')
  const [sending, setSending] = useState(false)
  const [busyRow, setBusyRow] = useState<string | null>(null)
  const [results, setResults] = useState<{ sent: number; skipped: number } | null>(null)
  const [total, setTotal] = useState<number | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  // Mandatory gate (R): while either template is not Meta-approved, every send control is
  // disabled — review/filter/select still work, only dispatch is blocked.
  const blocked = !templates || templates.private !== 'approved' || templates.repeat !== 'approved'

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (city) params.set('city', city)
      if (grade) params.set('grade', grade)
      if (segment) params.set('segment', segment)
      const res = await fetch(`/api/v1/renewals/queue?${params.toString()}`)
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data?.error?.message || data?.error?.code || 'טעינה נכשלה')
      setRows(data.rows || [])
      setCounters(data.counters || null)
      setTemplates(data.templates || null)
      setTotal(typeof data.total === 'number' ? data.total : null)
      setHasMore(Boolean(data.hasMore))
      setSelected(new Set())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'טעינה נכשלה')
    } finally {
      setLoading(false)
    }
  }, [city, grade, segment])

  useEffect(() => { load() }, [load])

  // Separate from `load` (not memoized into its useEffect dependency) so appending a page never
  // re-triggers the fresh-load effect. Fixes the queue silently truncating at `limit` (300 today,
  // due window crosses that on 2026-09-05) with no pagination and no notice.
  async function loadMore() {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (city) params.set('city', city)
      if (grade) params.set('grade', grade)
      if (segment) params.set('segment', segment)
      params.set('offset', String(rows.length))
      const res = await fetch(`/api/v1/renewals/queue?${params.toString()}`)
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data?.error?.message || data?.error?.code || 'טעינה נכשלה')
      setRows(prev => [...prev, ...(data.rows || [])])
      setHasMore(Boolean(data.hasMore))
      if (typeof data.total === 'number') setTotal(data.total)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'טעינה נכשלה')
    } finally {
      setLoadingMore(false)
    }
  }

  function applyCity() { setCity(cityInput.trim()) }

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  const allSelected = rows.length > 0 && rows.every(r => selected.has(r.leadId))
  function toggleAll() {
    setSelected(prev => (allSelected ? new Set() : new Set(rows.map(r => r.leadId))))
  }
  function selectNextN(n: number) {
    setSelected(prev => {
      const next = new Set(prev)
      let added = 0
      for (const r of rows) {
        if (added >= n) break
        if (!next.has(r.leadId)) { next.add(r.leadId); added++ }
      }
      return next
    })
  }

  async function sendSelected() {
    if (blocked || sending || selected.size === 0) return
    const leadIds = Array.from(selected)
    if (!window.confirm(`לשלוח ל-${leadIds.length} נמענים? (אצווה כפופה לתקרה היומית)`)) return
    setSending(true)
    setError(null)
    setResults(null)
    try {
      const res = await fetch('/api/v1/renewals/send-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadIds }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data?.error?.message || data?.error?.code || 'השליחה נכשלה')
      setResults({ sent: data.sent || 0, skipped: data.skipped || 0 })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'השליחה נכשלה')
    } finally {
      setSending(false)
    }
  }

  async function sendOne(row: RenewalRow) {
    if (blocked || busyRow || !row.preview) return
    if (!window.confirm('לשלוח הודעה לנמען זה?')) return
    setBusyRow(row.leadId)
    try {
      const res = await fetch('/api/v1/renewals/send-one', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: row.leadId }),
      })
      // send-one returns RenewalDispatchResult unwrapped: { ok, code?, message? } — not { error: {...} }.
      const data: { ok: boolean; code?: string; message?: string } = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.message || data.code || 'השליחה נכשלה')
      setRows(prev => prev.filter(r => r.leadId !== row.leadId))
      setSelected(prev => { const n = new Set(prev); n.delete(row.leadId); return n })
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'השליחה נכשלה')
    } finally {
      setBusyRow(null)
    }
  }

  async function skipRow(row: RenewalRow) {
    if (busyRow) return
    if (!window.confirm('לדלג על הליד הזה ולהסיר אותו מהתור?')) return
    const reasonInput = window.prompt('סיבת הדילוג (רשות):', '')
    if (reasonInput === null) return // cancelled
    setBusyRow(row.leadId)
    try {
      const res = await fetch('/api/v1/renewals/skip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: row.leadId, ...(reasonInput.trim() ? { reason: reasonInput.trim() } : {}) }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data?.error?.message || data?.error?.code || 'הדילוג נכשל')
      setRows(prev => prev.filter(r => r.leadId !== row.leadId))
      setSelected(prev => { const n = new Set(prev); n.delete(row.leadId); return n })
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'הדילוג נכשל')
    } finally {
      setBusyRow(null)
    }
  }

  return (
    <>
      {blocked && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 mb-4 flex items-start gap-2" role="alert">
          <AlertCircle className="h-5 w-5 mt-0.5 shrink-0 text-amber-600" />
          <span style={{ fontWeight: 600 }}>
            התבניות עדיין ממתינות לאישור Meta. אפשר לסקור ולסנן, אבל שליחה תיחסם עד שהאישור יתקבל.
          </span>
        </div>
      )}

      <CountersBar counters={counters} />

      {!loading && !error && typeof total === 'number' && (
        <div className="text-xs text-gray-500 mt-2">
          מוצגים {rows.length} מתוך {total} לידים בתור ההבשלה{hasMore ? ' (יש עוד לטעינה)' : ''}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 my-3">
        <input
          type="text"
          placeholder="חיפוש לפי עיר…"
          value={cityInput}
          onChange={e => setCityInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') applyCity() }}
          className="rounded-md border border-brand-border bg-white px-3 py-1.5 text-sm w-40"
        />
        <select value={grade} onChange={e => setGrade(e.target.value)} className="rounded-md border border-brand-border bg-white px-2 py-1.5 text-sm">
          <option value="">כל הציונים</option>
          <option value="A">A</option>
          <option value="B">B</option>
          <option value="C">C</option>
          <option value="D">D</option>
        </select>
        <select value={segment} onChange={e => setSegment(e.target.value)} className="rounded-md border border-brand-border bg-white px-2 py-1.5 text-sm">
          <option value="">כל הסגמנטים</option>
          <option value="private_once">פרטי</option>
          <option value="repeat">חוזר</option>
        </select>
        <button type="button" onClick={applyCity} className="btn border border-brand-border bg-white text-gray-600 hover:bg-gray-50">סינון</button>
      </div>

      {!loading && !error && rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-brand-border bg-gray-50 p-2 mb-3">
          <button
            type="button"
            onClick={toggleAll}
            disabled={blocked}
            {...(blocked ? { title: 'הבחירה חסומה עד לאישור התבניות ב-Meta' } : {})}
            className="rounded-md border border-brand-border bg-white px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {allSelected ? 'ניקוי הכל' : 'בחירת הכל'}
          </button>
          <button
            type="button"
            onClick={() => selectNextN(50)}
            disabled={blocked}
            {...(blocked ? { title: 'הבחירה חסומה עד לאישור התבניות ב-Meta' } : {})}
            className="rounded-md bg-brand-primary/10 px-2.5 py-1 text-xs font-medium text-brand-primary hover:bg-brand-primary/20 disabled:opacity-50"
          >
            בחירת 50 הבאים
          </button>
          {selected.size > 0 && (
            <button type="button" onClick={() => setSelected(new Set())} className="rounded-md border border-brand-border bg-white px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50">
              ניקוי הבחירה
            </button>
          )}
          <span className="text-xs text-gray-500">נבחרו <strong className="text-gray-800">{selected.size}</strong> מתוך {rows.length}</span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={sendSelected}
            disabled={blocked || sending || selected.size === 0}
            {...(blocked ? { title: 'שליחה חסומה עד לאישור התבניות ב-Meta' } : {})}
            className="btn btn-brand disabled:opacity-50"
          >
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {sending ? 'שולח…' : `שליחה לנבחרים (${selected.size})`}
          </button>
        </div>
      )}

      {results && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 mb-3">
          <CheckCircle2 className="inline h-4 w-4 ml-1" />נשלחו {results.sent} · דולגו {results.skipped}
        </div>
      )}

      {loading && <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-brand-primary" /></div>}
      {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"><AlertCircle className="inline h-4 w-4 ml-1" />{error}</div>}
      {!loading && !error && rows.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <CheckCircle2 className="mx-auto h-10 w-10 mb-2 text-gray-300" />
          <p>אין כרגע לידים שמבשילים לפי הסינון הנוכחי.</p>
        </div>
      )}

      {!loading && !error && rows.length > 0 && (
        <div className="surface-card overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b text-right text-xs text-gray-500">
                <th className="px-3 py-2 font-medium"><input type="checkbox" checked={allSelected} onChange={toggleAll} disabled={blocked} className="h-4 w-4 disabled:opacity-50" aria-label="בחירת הכל" /></th>
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
                    <td className="px-3 py-2"><input type="checkbox" checked={selected.has(row.leadId)} onChange={() => toggle(row.leadId)} disabled={blocked} className="h-4 w-4 disabled:opacity-50" /></td>
                    <RenewalRowCells row={row} />
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setExpanded(expanded === row.leadId ? null : row.leadId)}
                          className="rounded-md border border-brand-border bg-white px-2 py-1 text-xs hover:bg-gray-50"
                        >
                          {expanded === row.leadId ? 'סגירה' : 'תצוגה'}
                        </button>
                        <button
                          type="button"
                          onClick={() => sendOne(row)}
                          disabled={blocked || busyRow === row.leadId || !row.preview}
                          {...(blocked ? { title: 'שליחה חסומה עד לאישור התבניות ב-Meta' } : {})}
                          className="rounded-md border border-brand-border bg-white px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-50 inline-flex items-center gap-1"
                        >
                          {busyRow === row.leadId ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}שליחה
                        </button>
                        <button
                          type="button"
                          onClick={() => skipRow(row)}
                          disabled={busyRow === row.leadId}
                          className="rounded-md border border-brand-border bg-white px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-50 inline-flex items-center gap-1"
                        >
                          <SkipForward className="h-3 w-3" />דילוג
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expanded === row.leadId && (
                    <tr className="border-b bg-gray-50">
                      <td colSpan={RENEWAL_COLSPAN_DATA + 2} className="px-3 py-3">
                        <div className="text-xs text-gray-500 mb-1">
                          נשלחו לנמען זה: {row.received.today} היום · {row.received.week} השבוע
                        </div>
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

      {!loading && !error && hasMore && (
        <div className="flex justify-center py-4">
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="btn border border-brand-border bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {loadingMore ? <Loader2 size={14} className="animate-spin" /> : null}
            {loadingMore ? 'טוען…' : `טעינת עוד (${rows.length}${total != null ? ` מתוך ${total}` : ''})`}
          </button>
        </div>
      )}
    </>
  )
}

function CountersBar({ counters }: { counters: Counters | null }) {
  if (!counters) return null
  const pct = counters.dailyCap > 0 ? Math.min(100, Math.round((counters.sentToday / counters.dailyCap) * 100)) : 0
  return (
    <div className="surface-card" style={{ padding: '14px 18px' }}>
      <div className="flex flex-wrap items-center justify-between gap-2" style={{ marginBottom: 8 }}>
        <span className="inline-flex items-center gap-1.5" style={{ fontWeight: 700, fontSize: 14 }}>
          <Gauge className="h-4 w-4" />מגבלת שליחה יומית (תקרה משותפת לצוות)
        </span>
        <span className="tnum" style={{ fontSize: 13, color: 'var(--ink-3)' }}>
          נשלחו {counters.sentToday} / {counters.dailyCap} · נותרו {counters.remaining}
        </span>
      </div>
      <div style={{ height: 6, borderRadius: 999, background: 'var(--paper-2)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: 'var(--brand)', borderRadius: 999 }} />
      </div>
    </div>
  )
}

'use client'

import { useEffect, useState } from 'react'
import { Home, Loader2, CheckCircle2, X, Search } from 'lucide-react'

type Candidate = { id: string; name?: string; label?: string; phone?: string; price?: number | null; score?: number | null }

/**
 * "Mark as rented" — links a renter ↔ property into a tenancy (a closed deal).
 * mode='property': page is a property → pick which renter rented it.
 * mode='renter':   page is a renter → pick which property they rented.
 *
 * Shows the matched/sent candidates as quick suggestions, AND a smart search over the WHOLE
 * database (so you can close with someone who was never matched/contacted through the system).
 */
export default function MarkRented({ mode, id, onDone }: { mode: 'property' | 'renter'; id: string; onDone?: () => void }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [matched, setMatched] = useState<Candidate[]>([])
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<Candidate[]>([])
  const [picked, setPicked] = useState<Candidate | null>(null)
  const [rent, setRent] = useState('')
  const [startedAt, setStartedAt] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const labelOf = (c: Candidate) => (c.name || c.label || '—') + (c.phone ? ` · ${c.phone}` : '')

  async function load() {
    setOpen(true); setLoading(true); setErr(null)
    try {
      const q = mode === 'property' ? `propertyId=${id}` : `renterId=${id}`
      const r = await fetch(`/api/v1/tenancies?${q}`)
      const d = await r.json()
      setMatched(mode === 'property' ? (d.renters || []) : (d.properties || []))
    } catch { setErr('טעינת המועמדים נכשלה') } finally { setLoading(false) }
  }

  // Smart search across the whole database (debounced).
  useEffect(() => {
    if (!open) return
    const term = query.trim()
    if (term.length < 2) { setResults([]); setSearching(false); return }
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const url = mode === 'property'
          ? `/api/v1/renters?search=${encodeURIComponent(term)}&limit=20`
          : `/api/v1/properties?search=${encodeURIComponent(term)}&limit=20`
        const d = await fetch(url).then(r => r.json())
        if (mode === 'property') {
          setResults((d.renters || []).map((r: any) => ({ id: r.id, name: [r.first_name, r.last_name].filter(Boolean).join(' ') || 'ללא שם', phone: r.phone })))
        } else {
          setResults((d.properties || []).map((p: any) => ({
            id: p.id,
            label: [p.street || p.address, (p.city || '').replace(/\s*-\s*(מגורים|משרדים).*$/, '').trim()].filter(Boolean).join(', ') || p.title,
            price: p.price,
          })))
        }
      } catch {/* keep previous */} finally { setSearching(false) }
    }, 250)
    return () => clearTimeout(t)
  }, [query, open, mode])

  async function submit() {
    if (!picked || saving) return
    setSaving(true); setErr(null)
    try {
      const payload: any = { started_at: startedAt || undefined, monthly_rent: rent || undefined }
      if (mode === 'property') { payload.property_id = id; payload.renter_id = picked.id }
      else { payload.renter_id = id; payload.property_id = picked.id }
      const r = await fetch('/api/v1/tenancies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const d = await r.json()
      if (!r.ok || d.error) throw new Error(d?.error?.message || 'failed')
      setDone(true); onDone?.()
    } catch (e) { setErr(e instanceof Error ? e.message : 'השמירה נכשלה') } finally { setSaving(false) }
  }

  if (done) {
    return (
      <div className="inline-flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-800">
        <CheckCircle2 className="h-4 w-4" /> העסקה נסגרה ✓ — שויכה והעמלה חושבה
      </div>
    )
  }

  if (!open) {
    return (
      <button type="button" onClick={load}
        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700">
        <Home className="h-4 w-4" /> נסגרה עסקה
      </button>
    )
  }

  const showMatched = !picked && query.trim().length < 2

  return (
    <div className="rounded-xl border border-emerald-200 bg-white p-4 shadow-sm" style={{ minWidth: 300 }} dir="rtl">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-bold text-gray-900">{mode === 'property' ? 'עם מי נסגרה העסקה?' : 'איזו דירה נסגרה?'}</div>
        <button type="button" onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
      </div>

      {picked ? (
        <div className="mb-2 flex items-center justify-between rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2">
          <span className="text-sm font-medium text-emerald-900">{labelOf(picked)}</span>
          <button type="button" onClick={() => setPicked(null)} className="text-xs text-emerald-700 hover:underline">שנה</button>
        </div>
      ) : (
        <>
          {/* Smart search over the whole database */}
          <div className="relative mb-2">
            <Search className="absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={mode === 'property' ? 'חיפוש שוכר לפי שם או טלפון…' : 'חיפוש נכס לפי כתובת…'}
              className="w-full rounded-md border border-gray-300 py-2 pr-8 pl-2 text-sm"
            />
          </div>

          {/* Results: matched suggestions when no query, else search hits */}
          {loading && <div className="py-4 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-emerald-600" /></div>}
          {searching && <div className="py-2 text-center text-xs text-gray-400">מחפש…</div>}

          {showMatched && !loading && (
            <div className="max-h-52 overflow-y-auto">
              {matched.length > 0 && <div className="px-1 pb-1 text-[11px] font-medium text-gray-400">מותאמים / נשלחו</div>}
              {matched.map(c => (
                <button key={c.id} type="button" onClick={() => setPicked(c)} className="flex w-full items-center justify-between rounded-md px-2 py-2 text-sm hover:bg-gray-50">
                  <span>{c.name || c.label}{c.phone ? <span className="text-gray-400"> · {c.phone}</span> : ''}</span>
                  {c.score != null && <span className="text-xs text-gray-400">{Math.round(c.score)}%</span>}
                </button>
              ))}
              <div className="px-1 pt-1 text-[11px] text-gray-400">לא מופיע? הקלד/י שם או כתובת לחיפוש בכל המאגר.</div>
            </div>
          )}

          {!showMatched && (
            <div className="max-h-52 overflow-y-auto">
              {results.map(c => (
                <button key={c.id} type="button" onClick={() => setPicked(c)} className="flex w-full items-center justify-between rounded-md px-2 py-2 text-sm hover:bg-gray-50">
                  <span>{c.name || c.label}{c.phone ? <span className="text-gray-400"> · {c.phone}</span> : ''}</span>
                  {c.price != null && <span className="text-xs text-gray-400">₪{Number(c.price).toLocaleString('he-IL')}</span>}
                </button>
              ))}
              {!searching && query.trim().length >= 2 && results.length === 0 && (
                <div className="py-3 text-center text-xs text-gray-400">לא נמצאו תוצאות.</div>
              )}
            </div>
          )}
        </>
      )}

      {picked && (
        <>
          <div className="flex gap-2 mb-1">
            <input type="number" inputMode="numeric" dir="ltr" value={rent} onChange={e => setRent(e.target.value)} placeholder="שכ״ד חודשי ₪" className="flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
            <input type="date" value={startedAt} onChange={e => setStartedAt(e.target.value)} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm" title="תאריך כניסה" />
          </div>
          <div className="text-[11px] text-gray-500 mb-2">דמי התיווך יחושבו לפי חודש שכירות{rent ? ` — ₪${Number(rent).toLocaleString('he-IL')}` : ''}. ניתן לעדכן במסך עמלות.</div>
          <button type="button" onClick={submit} disabled={saving}
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} סגירת עסקה ושיוך
          </button>
        </>
      )}
      {err && <div className="mt-2 text-xs text-red-600">{err}</div>}
    </div>
  )
}

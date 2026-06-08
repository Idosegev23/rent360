'use client'

import { useState } from 'react'
import { Home, Loader2, CheckCircle2, X } from 'lucide-react'

type Candidate = { id: string; name?: string; label?: string; phone?: string; price?: number | null; score?: number | null }

/**
 * "Mark as rented" — links a renter ↔ property into a tenancy (a closed deal).
 * mode='property': page is a property → pick which renter rented it (from matched renters).
 * mode='renter':   page is a renter → pick which property they rented (from their matches).
 */
export default function MarkRented({ mode, id, onDone }: { mode: 'property' | 'renter'; id: string; onDone?: () => void }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [cands, setCands] = useState<Candidate[]>([])
  const [picked, setPicked] = useState('')
  const [rent, setRent] = useState('')
  const [startedAt, setStartedAt] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function load() {
    setOpen(true); setLoading(true); setErr(null)
    try {
      const q = mode === 'property' ? `propertyId=${id}` : `renterId=${id}`
      const r = await fetch(`/api/v1/tenancies?${q}`)
      const d = await r.json()
      setCands(mode === 'property' ? (d.renters || []) : (d.properties || []))
    } catch { setErr('טעינת המועמדים נכשלה') } finally { setLoading(false) }
  }

  async function submit() {
    if (!picked || saving) return
    setSaving(true); setErr(null)
    try {
      const payload: any = { started_at: startedAt || undefined, monthly_rent: rent || undefined }
      if (mode === 'property') { payload.property_id = id; payload.renter_id = picked }
      else { payload.renter_id = id; payload.property_id = picked }
      const r = await fetch('/api/v1/tenancies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const d = await r.json()
      if (!r.ok || d.error) throw new Error(d?.error?.message || 'failed')
      setDone(true); onDone?.()
    } catch (e) { setErr(e instanceof Error ? e.message : 'השמירה נכשלה') } finally { setSaving(false) }
  }

  if (done) {
    return (
      <div className="inline-flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-800">
        <CheckCircle2 className="h-4 w-4" /> סומן כהושכר ✓
      </div>
    )
  }

  if (!open) {
    return (
      <button type="button" onClick={load}
        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50">
        <Home className="h-4 w-4" /> {mode === 'property' ? 'סמן כהושכר' : 'סמן כשכר/ה דירה'}
      </button>
    )
  }

  return (
    <div className="rounded-xl border border-emerald-200 bg-white p-4 shadow-sm" style={{ minWidth: 280 }} dir="rtl">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-bold text-gray-900">{mode === 'property' ? 'מי שכר את הנכס?' : 'איזו דירה נשכרה?'}</div>
        <button type="button" onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
      </div>

      {loading && <div className="py-4 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-emerald-600" /></div>}

      {!loading && cands.length === 0 && (
        <div className="text-xs text-gray-500 py-2">אין מועמדים מתאימים (לא נשלחו/הותאמו). אפשר לבחור ידנית מהמאגר בהמשך.</div>
      )}

      {!loading && cands.length > 0 && (
        <>
          <select value={picked} onChange={e => setPicked(e.target.value)} className="w-full rounded-md border border-gray-300 px-2 py-2 text-sm mb-2">
            <option value="">בחר/י…</option>
            {cands.map(c => (
              <option key={c.id} value={c.id}>
                {(c.name || c.label)}{c.phone ? ` · ${c.phone}` : ''}{c.score != null ? ` · ${Math.round(c.score)}%` : ''}
              </option>
            ))}
          </select>
          <div className="flex gap-2 mb-2">
            <input type="number" inputMode="numeric" dir="ltr" value={rent} onChange={e => setRent(e.target.value)} placeholder="שכ״ד ₪ (לא חובה)" className="flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
            <input type="date" value={startedAt} onChange={e => setStartedAt(e.target.value)} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm" title="תאריך כניסה" />
          </div>
          <button type="button" onClick={submit} disabled={!picked || saving}
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} אישור — סמן כהושכר
          </button>
        </>
      )}
      {err && <div className="mt-2 text-xs text-red-600">{err}</div>}
    </div>
  )
}

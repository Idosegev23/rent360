'use client'

import { useState, useEffect } from 'react'
import { CheckCircle2, Loader2, ChevronDown } from 'lucide-react'

type Status = {
  approved: boolean
  approved_at?: string | null
  approval_method?: 'manual' | 'conversation' | 'questionnaire' | null
  approval_summary?: string | null
  conversation_transcript?: string | null
  approved_by_name?: string | null
  irrelevant_at?: string | null
  irrelevant_reason?: string | null
  recheck_at?: string | null
}

const methodLabel = (m?: string | null) =>
  m === 'conversation' ? 'אושר בשיחה' : m === 'questionnaire' ? 'אושר בשאלון' : 'אישור ידני'

function fmt(d?: string | null) {
  if (!d) return ''
  try { return new Date(d).toLocaleDateString('he-IL') } catch { return '' }
}

/** "אשר תיווך" on the property page — POSTs the manual approval, or shows the existing approval
 *  (incl. the conversational summary the bot captured) with an option to revoke. */
export default function ApproveBrokerage({ propertyId }: { propertyId: string }) {
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)

  async function load() {
    try {
      const r = await fetch(`/api/v1/properties/${propertyId}/approve`)
      setStatus(await r.json())
    } catch { setStatus({ approved: false }) }
  }
  useEffect(() => { load() }, [propertyId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function approve() {
    if (busy) return
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/v1/properties/${propertyId}/approve`, { method: 'POST' })
      const d = await r.json()
      if (!r.ok || d.error) throw new Error(d?.error?.message || 'failed')
      await load()
    } catch (e) { setErr(e instanceof Error ? e.message : 'השמירה נכשלה') } finally { setBusy(false) }
  }
  async function revoke() {
    if (busy || !confirm('לבטל את אישור התיווך לנכס זה?')) return
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/v1/properties/${propertyId}/approve`, { method: 'DELETE' })
      if (!r.ok) throw new Error('failed')
      await load()
    } catch { setErr('הביטול נכשל') } finally { setBusy(false) }
  }

  async function setIrrelevant() {
    const reason = window.prompt('למה הנכס לא רלוונטי? (למשל: הושכר שלא דרכנו). אפשר להשאיר ריק:')
    if (reason === null) return // cancelled
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/v1/properties/${propertyId}/approve`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ irrelevant: true, reason }),
      })
      const d = await r.json()
      if (!r.ok || d.error) throw new Error(d?.error?.message || 'failed')
      await load()
    } catch (e) { setErr(e instanceof Error ? e.message : 'הסימון נכשל') } finally { setBusy(false) }
  }
  async function setRelevant() {
    if (busy) return
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/v1/properties/${propertyId}/approve`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ irrelevant: false }),
      })
      if (!r.ok) throw new Error('failed')
      await load()
    } catch { setErr('נכשל') } finally { setBusy(false) }
  }

  if (!status) return null

  if (!status.approved) {
    return (
      <div className="flex flex-col items-stretch gap-1">
        {!confirming ? (
          <button
            onClick={() => setConfirming(true)}
            disabled={busy}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg transition-colors shadow-sm disabled:opacity-50"
          >
            <CheckCircle2 className="h-4 w-4" />
            <span>אשר תיווך</span>
          </button>
        ) : (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2">
            <span className="text-sm font-medium text-emerald-800">לאשר תיווך לנכס?</span>
            <button
              onClick={approve}
              disabled={busy}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-md disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              <span>כן, אשר</span>
            </button>
            <button onClick={() => setConfirming(false)} disabled={busy} className="text-sm text-gray-500 hover:text-gray-700">ביטול</button>
          </div>
        )}
        {err && <span className="text-xs text-red-600">{err}</span>}
      </div>
    )
  }

  const hasDetails = !!(status.approval_summary || status.conversation_transcript)
  return (
    <div className="flex flex-col items-stretch gap-1">
      <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
        <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
        <div className="text-sm leading-tight">
          <div className="font-semibold text-emerald-800">מאושר לתיווך</div>
          <div className="text-xs text-emerald-700">{methodLabel(status.approval_method)}{fmt(status.approved_at) ? ` · ${fmt(status.approved_at)}` : ''}{status.approved_by_name ? ` · ${status.approved_by_name}` : ''}</div>
        </div>
        {hasDetails && (
          <button onClick={() => setOpen(o => !o)} className="text-emerald-600 hover:text-emerald-800" title="פרטי האישור">
            <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>
      {open && hasDetails && (
        <div className="rounded-lg border border-gray-200 bg-white p-3 text-xs text-gray-700 space-y-2 max-w-md">
          {status.approval_summary && (
            <div><div className="font-semibold text-gray-800 mb-1">סיכום</div><div className="whitespace-pre-wrap">{status.approval_summary}</div></div>
          )}
          {status.conversation_transcript && (
            <details><summary className="cursor-pointer font-semibold text-gray-800">תמלול השיחה</summary><div className="mt-1 whitespace-pre-wrap text-gray-600">{status.conversation_transcript}</div></details>
          )}
        </div>
      )}
      {status.irrelevant_at ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <div className="font-semibold">מסומן כלא רלוונטי{status.recheck_at ? ` · תזכורת לבדיקה חוזרת ב-${fmt(status.recheck_at)}` : ''}</div>
          {status.irrelevant_reason && <div className="mt-0.5">סיבה: {status.irrelevant_reason}</div>}
          <button onClick={setRelevant} disabled={busy} className="mt-1 underline hover:text-amber-900">החזר לרלוונטי</button>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <button onClick={revoke} disabled={busy} className="text-xs text-gray-400 hover:text-red-600">בטל אישור</button>
          <button onClick={setIrrelevant} disabled={busy} className="text-xs text-gray-400 hover:text-amber-700">סמן כלא רלוונטי</button>
        </div>
      )}
      {err && <span className="text-xs text-red-600">{err}</span>}
    </div>
  )
}

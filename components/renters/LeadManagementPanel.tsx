'use client'

import { useEffect, useState } from 'react'
import { Briefcase, Star, Check, Loader2, AlertCircle } from 'lucide-react'

/**
 * Lead-management (CRM) panel for a renter — pipeline stage, source, 1-5 rating, vetted budget,
 * and owning agent. Each control auto-saves via PATCH /api/v1/renters/:id. Sits on top of the
 * (read-only here) questionnaire data. Gender-neutral Hebrew.
 */

type Member = { id: string; name: string | null; title?: string | null }

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'new', label: 'חדש' },
  { value: 'contacted', label: 'נוצר קשר' },
  { value: 'qualified', label: 'מוסמך' },
  { value: 'viewing', label: 'בצפייה' },
  { value: 'negotiating', label: 'במו״מ' },
  { value: 'placed', label: 'שובץ' },
  { value: 'lost', label: 'אבוד' },
]
const STATUS_COLOR: Record<string, string> = {
  new: 'bg-gray-100 text-gray-700 border-gray-200',
  contacted: 'bg-blue-50 text-blue-700 border-blue-200',
  qualified: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  viewing: 'bg-amber-50 text-amber-700 border-amber-200',
  negotiating: 'bg-purple-50 text-purple-700 border-purple-200',
  placed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  lost: 'bg-rose-50 text-rose-700 border-rose-200',
}
const SOURCE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: '— לא ידוע —' },
  { value: 'facebook', label: 'פייסבוק' },
  { value: 'whatsapp', label: 'וואטסאפ' },
  { value: 'referral', label: 'הפניה' },
  { value: 'manual', label: 'ידני' },
  { value: 'website', label: 'אתר' },
  { value: 'other', label: 'אחר' },
]

export default function LeadManagementPanel(props: {
  renterId: string
  initialStatus: string | null
  initialSource: string | null
  initialRating: number | null
  initialApprovedBudget: number | null
  initialAssignedTo: string | null
  statedBudget: number | null
  onSaved?: () => void
}) {
  const [status, setStatus] = useState(props.initialStatus || 'new')
  const [source, setSource] = useState(props.initialSource || '')
  const [rating, setRating] = useState<number | null>(props.initialRating ?? null)
  const [approvedBudget, setApprovedBudget] = useState(props.initialApprovedBudget != null ? String(props.initialApprovedBudget) : '')
  const [assignedTo, setAssignedTo] = useState(props.initialAssignedTo || '')
  const [members, setMembers] = useState<Member[]>([])
  const [saving, setSaving] = useState<string | null>(null)
  const [savedField, setSavedField] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/v1/team')
      .then(r => r.json())
      .then(d => setMembers(Array.isArray(d.members) ? d.members : []))
      .catch(() => setMembers([]))
  }, [])

  async function patch(field: string, payload: Record<string, unknown>) {
    setSaving(field)
    setErr(null)
    try {
      const res = await fetch(`/api/v1/renters/${props.renterId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error?.message || 'שמירה נכשלה')
      setSavedField(field)
      setTimeout(() => setSavedField(f => (f === field ? null : f)), 1500)
      props.onSaved?.()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'שמירה נכשלה')
    } finally {
      setSaving(s => (s === field ? null : s))
    }
  }

  const savingOrSaved = (field: string) =>
    saving === field ? <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />
      : savedField === field ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : null

  function setRatingAndSave(n: number) {
    const next = rating === n ? null : n // click the current rating to clear
    setRating(next)
    patch('rating', { rating: next })
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 mb-4">
      <div className="flex items-center gap-2 mb-3">
        <Briefcase className="h-4 w-4 text-brand-primary" />
        <h3 className="font-semibold text-sm">ניהול ליד</h3>
        {err && (
          <span className="ms-auto inline-flex items-center gap-1 text-xs text-rose-600">
            <AlertCircle className="h-3.5 w-3.5" /> {err}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Status */}
        <label className="block">
          <span className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">סטטוס {savingOrSaved('lead_status')}</span>
          <select
            value={status}
            onChange={e => { setStatus(e.target.value); patch('lead_status', { lead_status: e.target.value }) }}
            className={`w-full rounded-md border px-2.5 py-1.5 text-sm font-medium ${STATUS_COLOR[status] || STATUS_COLOR.new}`}
          >
            {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>

        {/* Rating */}
        <div className="block">
          <span className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">דירוג {savingOrSaved('rating')}</span>
          <div className="flex items-center gap-0.5 h-[34px]">
            {[1, 2, 3, 4, 5].map(n => (
              <button
                key={n}
                type="button"
                onClick={() => setRatingAndSave(n)}
                aria-label={`דירוג ${n}`}
                className="p-0.5"
              >
                <Star className={`h-5 w-5 ${rating != null && n <= rating ? 'fill-amber-400 text-amber-400' : 'text-gray-300'}`} />
              </button>
            ))}
            {rating != null && <span className="ms-1 text-xs text-gray-400">{rating}/5</span>}
          </div>
        </div>

        {/* Source */}
        <label className="block">
          <span className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">מקור {savingOrSaved('source')}</span>
          <select
            value={source}
            onChange={e => { setSource(e.target.value); patch('source', { source: e.target.value || null }) }}
            className="w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-sm"
          >
            {SOURCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>

        {/* Approved budget */}
        <label className="block">
          <span className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
            תקציב מאושר {savingOrSaved('approved_budget')}
            {props.statedBudget != null && <span className="text-gray-300">· מוצהר: {props.statedBudget.toLocaleString('he-IL')} ₪</span>}
          </span>
          <div className="relative">
            <input
              type="number"
              inputMode="numeric"
              value={approvedBudget}
              onChange={e => setApprovedBudget(e.target.value)}
              onBlur={() => {
                const orig = props.initialApprovedBudget != null ? String(props.initialApprovedBudget) : ''
                if (approvedBudget !== orig) patch('approved_budget', { approved_budget: approvedBudget === '' ? null : approvedBudget })
              }}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
              placeholder="—"
              className="w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-sm pe-7"
            />
            <span className="absolute inset-y-0 end-2.5 flex items-center text-xs text-gray-400">₪</span>
          </div>
        </label>

        {/* Assigned agent */}
        <label className="block sm:col-span-2">
          <span className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">שיוך לאיש צוות {savingOrSaved('assigned_to')}</span>
          <select
            value={assignedTo}
            onChange={e => { setAssignedTo(e.target.value); patch('assigned_to', { assigned_to: e.target.value || null }) }}
            className="w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-sm"
          >
            <option value="">— לא משויך —</option>
            {members.map(m => (
              <option key={m.id} value={m.id}>{m.name || 'צוות'}{m.title ? ` · ${m.title}` : ''}</option>
            ))}
          </select>
        </label>
      </div>
    </div>
  )
}

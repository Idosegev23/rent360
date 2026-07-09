'use client'

import { useEffect, useState } from 'react'
import { Coins, Upload, Loader2, FileCheck2, ExternalLink } from 'lucide-react'

type Doc = { id: string; name: string; kind: string | null; created_at: string }

/**
 * Agreed brokerage commission (in MONTHS of rent) captured at recruitment + saved proof.
 * Commission model: one month's rent incl. VAT, half-month floor. The ₪ figure is derived from
 * the property price. Proof files are stored via the documents vault (kind='commission_proof').
 */
export default function AgreedCommission({
  propertyId,
  price,
  initialMonths,
  initialNote,
  onSaved,
}: {
  propertyId: string
  price: number | null
  initialMonths: number | null
  initialNote: string | null
  onSaved?: () => void
}) {
  const [months, setMonths] = useState(initialMonths != null ? String(initialMonths) : '')
  const [note, setNote] = useState(initialNote || '')
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [proofs, setProofs] = useState<Doc[]>([])
  const [uploading, setUploading] = useState(false)

  async function loadProofs() {
    const r = await fetch(`/api/v1/documents?entity_type=property&entity_id=${propertyId}`)
    const d = await r.json().catch(() => ({ documents: [] }))
    setProofs((d.documents || []).filter((x: Doc) => x.kind === 'commission_proof'))
  }
  useEffect(() => {
    loadProofs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId])

  const monthsNum = months.trim() === '' ? null : parseFloat(months)
  const shekels = monthsNum != null && Number.isFinite(monthsNum) && price ? Math.round(monthsNum * price) : null
  const belowFloor = monthsNum != null && Number.isFinite(monthsNum) && monthsNum > 0 && monthsNum < 0.5

  async function save() {
    setSaving(true)
    setErr(null)
    setSavedAt(false)
    try {
      const r = await fetch(`/api/v1/properties/${propertyId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: {
            agreed_commission_months: months.trim() === '' ? null : monthsNum,
            agreed_commission_note: note.trim() === '' ? null : note.trim(),
          },
        }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'שמירה נכשלה')
      setSavedAt(true)
      onSaved?.()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'שגיאה')
    } finally {
      setSaving(false)
    }
  }

  async function uploadProof(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setErr(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('entity_type', 'property')
      fd.append('entity_id', propertyId)
      fd.append('kind', 'commission_proof')
      const r = await fetch('/api/v1/documents/upload', { method: 'POST', body: fd })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error?.message || d.error?.code || 'העלאה נכשלה')
      await loadProofs()
    } catch (uploadErr) {
      setErr(uploadErr instanceof Error ? uploadErr.message : 'העלאה נכשלה')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  return (
    <div className="surface-card p-4" dir="rtl">
      <div className="mb-3 flex items-center gap-2 text-sm font-bold text-gray-800">
        <Coins className="h-4 w-4 text-brand-primary" /> עמלה מוסכמת
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-gray-500">חודשי שכירות</label>
          <input
            type="number"
            step="0.25"
            min="0"
            inputMode="decimal"
            value={months}
            onChange={(e) => setMonths(e.target.value)}
            placeholder="1"
            className="mt-1 w-28 rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="pb-2 text-sm text-gray-700">
          {shekels != null ? (
            <>
              ≈ <span className="num font-bold text-brand-primary">₪{shekels.toLocaleString('he-IL')}</span>
              <span className="text-gray-400"> · כולל מע״מ</span>
            </>
          ) : (
            <span className="text-gray-400">הזן חודשים כדי לחשב לפי שכר הדירה</span>
          )}
        </div>
      </div>
      {belowFloor && <div className="mt-1 text-xs text-amber-600">שים לב: מתחת לרצפת חצי חודש שכירות.</div>}

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="הערה על ההסכמה (תנאים, מי סיכם, הסתייגויות)…"
        rows={2}
        className="mt-3 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
      />

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-md bg-brand-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          שמור עמלה
        </button>
        {savedAt && <span className="text-xs text-emerald-600">נשמר ✓</span>}
        {err && <span className="text-xs text-red-600">{err}</span>}
      </div>

      {/* Proof of agreement */}
      <div className="mt-4 border-t border-gray-100 pt-3">
        <div className="mb-2 text-xs font-medium text-gray-600">הוכחת ההסכמה</div>
        {proofs.length > 0 && (
          <div className="mb-2 space-y-1">
            {proofs.map((p) => (
              <a
                key={p.id}
                href={`/api/v1/documents/${p.id}/file`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-brand-primary hover:underline"
              >
                <FileCheck2 className="h-4 w-4 text-emerald-600" />
                <span className="truncate">{p.name}</span>
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
            ))}
          </div>
        )}
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {proofs.length > 0 ? 'הוסף הוכחה' : 'העלה הוכחה (צילום/הסכם)'}
          <input type="file" accept="image/*,.pdf" onChange={uploadProof} disabled={uploading} className="hidden" />
        </label>
      </div>
    </div>
  )
}

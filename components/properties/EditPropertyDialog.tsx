'use client'
import { useState } from 'react'
import { Pencil, X, Loader2 } from 'lucide-react'
import { type ExtendedProperty } from '../../types/property'

/** "ערוך פרטים" — edit the scalar details of a property. PATCHes /api/v1/properties/[id]
 *  with { fields }, which is whitelisted + type-coerced server-side. */
export default function EditPropertyDialog({
  property,
  onSaved,
}: {
  property: ExtendedProperty
  onSaved?: () => void | Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const p = property as ExtendedProperty & Record<string, unknown>

  const initial = () => ({
    title: (property.title ?? '') as string,
    type: ((p.type as string) ?? '') as string,
    condition: ((p.condition as string) ?? '') as string,
    status: (property.status ?? '') as string,
    city: (property.city ?? '') as string,
    neighborhood: (property.neighborhood ?? '') as string,
    street: (property.street ?? '') as string,
    address: (property.address ?? '') as string,
    price: property.price != null ? String(property.price) : '',
    rooms: property.rooms != null ? String(property.rooms) : '',
    sqm: property.sqm != null ? String(property.sqm) : '',
    floor: property.floor != null ? String(property.floor) : '',
    available_from: (property.available_from ?? '').slice(0, 10),
    evacuation_date: (property.evacuation_date ?? '').slice(0, 10),
    contact_name: (property.contact_name ?? '') as string,
    contact_phone: (property.contact_phone ?? '') as string,
    description: (property.description ?? '') as string,
    pets_allowed: p.pets_allowed == null ? '' : String(p.pets_allowed),
    smokers_allowed: p.smokers_allowed == null ? '' : String(p.smokers_allowed),
    long_term: p.long_term == null ? '' : String(p.long_term),
  })
  const [f, setF] = useState(initial)

  function openDialog() {
    setF(initial())
    setError(null)
    setOpen(true)
  }
  const set = (k: keyof ReturnType<typeof initial>) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF(prev => ({ ...prev, [k]: e.target.value }))

  async function save() {
    if (saving) return
    if (!f.title.trim() || !f.city.trim() || !f.price.trim()) {
      setError('כותרת, עיר ומחיר הם שדות חובה.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/properties/${property.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: f }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'העדכון נכשל')
      setOpen(false)
      await onSaved?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'העדכון נכשל')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className="inline-flex items-center gap-1.5 rounded-lg border border-brand-border bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        <Pencil className="h-4 w-4" /> ערוך פרטים
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-6" dir="rtl" onClick={() => !saving && setOpen(false)}>
          <div className="surface-card my-4 w-full max-w-2xl p-0" onClick={e => e.stopPropagation()}>
            {/* header */}
            <div className="flex items-center justify-between border-b p-4" style={{ borderColor: 'var(--line)' }}>
              <h2 className="text-base font-bold" style={{ color: 'var(--ink)' }}>עריכת פרטי הנכס</h2>
              <button type="button" onClick={() => !saving && setOpen(false)} className="text-gray-400 hover:text-gray-700"><X className="h-5 w-5" /></button>
            </div>

            {/* body */}
            <div className="max-h-[70vh] space-y-5 overflow-y-auto p-4">
              <Section title="פרטי הנכס">
                <Field label="כותרת *" wide><input value={f.title} onChange={set('title')} className={inp} /></Field>
                <Field label="סוג נכס"><input value={f.type} onChange={set('type')} placeholder="מגורים…" className={inp} /></Field>
                <Field label="מצב"><input value={f.condition} onChange={set('condition')} placeholder="משופצת…" className={inp} /></Field>
                <Field label="סטטוס"><input value={f.status} onChange={set('status')} className={inp} /></Field>
              </Section>

              <Section title="מיקום">
                <Field label="עיר *"><input value={f.city} onChange={set('city')} className={inp} /></Field>
                <Field label="שכונה"><input value={f.neighborhood} onChange={set('neighborhood')} className={inp} /></Field>
                <Field label="רחוב"><input value={f.street} onChange={set('street')} className={inp} /></Field>
                <Field label="כתובת מלאה"><input value={f.address} onChange={set('address')} className={inp} /></Field>
              </Section>

              <Section title="מאפיינים">
                <Field label="מחיר (₪) *"><input type="number" inputMode="numeric" min="0" value={f.price} onChange={set('price')} className={inp} /></Field>
                <Field label="חדרים"><input type="number" inputMode="decimal" step="0.5" min="0" value={f.rooms} onChange={set('rooms')} className={inp} /></Field>
                <Field label="שטח (מ״ר)"><input type="number" inputMode="numeric" min="0" value={f.sqm} onChange={set('sqm')} className={inp} /></Field>
                <Field label="קומה"><input type="number" inputMode="numeric" value={f.floor} onChange={set('floor')} className={inp} /></Field>
              </Section>

              <Section title="תאריך כניסה">
                <Field label="פנוי מתאריך"><input type="date" value={f.available_from} onChange={set('available_from')} className={inp} /></Field>
                <Field label="תאריך פינוי"><input type="date" value={f.evacuation_date} onChange={set('evacuation_date')} className={inp} /></Field>
              </Section>

              <Section title="איש קשר">
                <Field label="שם"><input value={f.contact_name} onChange={set('contact_name')} className={inp} /></Field>
                <Field label="טלפון"><input value={f.contact_phone} onChange={set('contact_phone')} dir="ltr" className={inp} /></Field>
              </Section>

              <Section title="מדיניות">
                <Field label="חיות מחמד"><select value={f.pets_allowed} onChange={set('pets_allowed')} className={inp}><TriOpts /></select></Field>
                <Field label="מעשנים"><select value={f.smokers_allowed} onChange={set('smokers_allowed')} className={inp}><TriOpts /></select></Field>
                <Field label="טווח ארוך"><select value={f.long_term} onChange={set('long_term')} className={inp}><TriOpts /></select></Field>
              </Section>

              <div>
                <label className="mb-1 block text-xs" style={{ color: 'var(--ink-4)' }}>תיאור</label>
                <textarea value={f.description} onChange={set('description')} rows={4} className={`${inp} resize-y`} />
              </div>
            </div>

            {/* footer */}
            <div className="flex items-center justify-between gap-3 border-t p-4" style={{ borderColor: 'var(--line)' }}>
              {error ? <span className="text-sm text-red-600">{error}</span> : <span />}
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => !saving && setOpen(false)} className="rounded-lg border border-brand-border bg-white px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">ביטול</button>
                <button type="button" onClick={save} disabled={saving} className="btn btn-brand disabled:opacity-50">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} שמירה
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

const inp = 'w-full rounded-md border border-brand-border bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/30'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-xs font-bold" style={{ color: 'var(--ink-3)' }}>{title}</div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>
    </div>
  )
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <label className={wide ? 'sm:col-span-2' : ''}>
      <span className="mb-1 block text-xs" style={{ color: 'var(--ink-4)' }}>{label}</span>
      {children}
    </label>
  )
}

function TriOpts() {
  return (
    <>
      <option value="">לא ידוע</option>
      <option value="true">כן</option>
      <option value="false">לא</option>
    </>
  )
}

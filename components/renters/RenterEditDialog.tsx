'use client'

import { useState } from 'react'
import { Pencil, X, Loader2 } from 'lucide-react'

/**
 * "ערוך פרטים" for a renter — edit the full questionnaire profile (identity, search area, budget,
 * apartment, move-in, household, employment, amenity preferences, notes). PATCHes /api/v1/renters/[id],
 * which validates + coerces server-side and recomputes matches when a match-affecting field changed.
 * Mirrors EditPropertyDialog. Gender-neutral Hebrew.
 */
type Renter = Record<string, any>

const numStr = (v: unknown) => (v == null || v === '' ? '' : String(v))
const triStr = (v: unknown) => (v === true ? 'true' : v === false ? 'false' : '')
const arrJoin = (v: unknown) => (Array.isArray(v) ? v.filter(Boolean).join(', ') : '')
const splitArr = (v: string) => v.split(/[,\n]/).map(s => s.trim()).filter(Boolean)

const LEVELS = [{ v: 'must', t: 'חובה' }, { v: 'nice', t: 'יתרון' }, { v: 'any', t: 'לא משנה' }]
const RANKED_AMENITIES = [{ k: 'elevator', l: 'מעלית' }, { k: 'yard', l: 'חצר' }, { k: 'mamad', l: 'ממ״ד' }]
const WANTED_AMENITIES = [
  { k: 'storage', l: 'מחסן' }, { k: 'solar_heater', l: 'דוד שמש' }, { k: 'bars', l: 'סורגים' },
  { k: 'quiet', l: 'שקט' }, { k: 'fiber_internet', l: 'אינטרנט סיבים' }, { k: 'shelter', l: 'מקלט' },
]
const PARKING_TYPES = [{ v: 'any', t: 'לא משנה' }, { v: 'private', t: 'פרטית' }, { v: 'shared', t: 'משותפת' }, { v: 'street', t: 'רחוב' }]
const AMOUNTS = [{ v: 'any', t: 'לא משנה' }, { v: 'none', t: 'אין' }, { v: 'partial', t: 'חלקי' }, { v: 'full', t: 'מלא' }]
const ACCESS_TYPES = [{ v: 'any', t: 'לא משנה' }, { v: 'no-stairs', t: 'בלי מדרגות' }, { v: 'ramp', t: 'רמפה' }, { v: 'wide-door', t: 'דלת רחבה' }]

function initPrefs(src: any): Record<string, any> {
  const p = (src && typeof src === 'object') ? src : {}
  const lvl = (k: string) => (p[k]?.level ?? 'any')
  return {
    parking: { level: lvl('parking'), type: p.parking?.type ?? 'any' },
    elevator: { level: lvl('elevator') },
    balcony: { level: lvl('balcony'), min_sqm: numStr(p.balcony?.min_sqm) },
    yard: { level: lvl('yard') },
    furnished: { level: lvl('furnished'), amount: p.furnished?.amount ?? 'any' },
    aircon: { level: lvl('aircon'), amount: p.aircon?.amount ?? 'any' },
    mamad: { level: lvl('mamad') },
    accessibility: { level: lvl('accessibility'), type: p.accessibility?.type ?? 'any' },
    storage: { wanted: !!p.storage?.wanted },
    solar_heater: { wanted: !!p.solar_heater?.wanted },
    bars: { wanted: !!p.bars?.wanted },
    quiet: { wanted: !!p.quiet?.wanted },
    fiber_internet: { wanted: !!p.fiber_internet?.wanted },
    shelter: { wanted: !!p.shelter?.wanted },
    divided_ok: p.divided_ok !== false,
  }
}

export default function RenterEditDialog({ renter, onSaved }: { renter: Renter; onSaved?: () => void | Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const initial = () => ({
    first_name: renter.first_name ?? '', last_name: renter.last_name ?? '', email: renter.email ?? '',
    preferred_cities: arrJoin(renter.preferred_cities), preferred_neighborhoods: arrJoin(renter.preferred_neighborhoods),
    budget_min: numStr(renter.budget_min), budget_max: numStr(renter.budget_max), budget_flexibility: numStr(renter.budget_flexibility),
    vaad_bayit_max: numStr(renter.vaad_bayit_max), arnona_max: numStr(renter.arnona_max), contract_length: renter.contract_length ?? '',
    preferred_rooms: numStr(renter.preferred_rooms), rooms_flexible: renter.rooms_flexible ? 'true' : 'false', min_sqm: numStr(renter.min_sqm),
    floor_min: numStr(renter.floor_min), floor_max: numStr(renter.floor_max), top_floor_preference: renter.top_floor_preference ?? 'any',
    condition_preference: renter.condition_preference ?? 'any', move_in_date: String(renter.move_in_date ?? '').slice(0, 10), move_in_flexible: renter.move_in_flexible ? 'true' : 'false',
    household_type: renter.household_type ?? '', household_size: numStr(renter.household_size), has_children: triStr(renter.has_children),
    children_count: numStr(renter.children_count), has_pets: triStr(renter.has_pets), smokers: triStr(renter.smokers),
    employment_status: renter.employment_status ?? '', employer: renter.employer ?? '', has_payslips: triStr(renter.has_payslips),
    has_security_checks: triStr(renter.has_security_checks), has_guarantors: triStr(renter.has_guarantors), notes: renter.notes ?? '',
  })
  const [f, setF] = useState(initial)
  const [prefs, setPrefs] = useState<Record<string, any>>(() => initPrefs(renter.preferences))

  function openDialog() { setF(initial()); setPrefs(initPrefs(renter.preferences)); setError(null); setOpen(true) }
  // All form values are strings ('true'/'false' for the two checkboxes); the server coerces them.
  const set = (k: keyof ReturnType<typeof initial>) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF(prev => ({ ...prev, [k]: e.target.value }))
  const setBool = (k: 'rooms_flexible' | 'move_in_flexible') => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF(prev => ({ ...prev, [k]: e.target.checked ? 'true' : 'false' }))
  const setPref = (k: string, patch: Record<string, unknown>) => setPrefs(prev => ({ ...prev, [k]: { ...prev[k], ...patch } }))

  async function save() {
    if (saving) return
    if (!String(f.first_name).trim()) { setError('שם פרטי הוא שדה חובה.'); return }
    setSaving(true); setError(null)
    try {
      const body = {
        ...f,
        preferred_cities: splitArr(f.preferred_cities),
        preferred_neighborhoods: splitArr(f.preferred_neighborhoods),
        preferences: prefs,
      }
      const res = await fetch(`/api/v1/renters/${renter.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error?.message || 'העדכון נכשל')
      setOpen(false)
      await onSaved?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'העדכון נכשל')
    } finally { setSaving(false) }
  }

  return (
    <>
      <button type="button" onClick={openDialog}
        className="inline-flex items-center gap-1.5 rounded-lg border border-brand-border bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
        <Pencil className="h-4 w-4" /> ערוך פרטים
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-6" dir="rtl" onClick={() => !saving && setOpen(false)}>
          <div className="surface-card my-4 w-full max-w-2xl p-0" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b p-4" style={{ borderColor: 'var(--line)' }}>
              <h2 className="text-base font-bold" style={{ color: 'var(--ink)' }}>עריכת פרטי השוכר</h2>
              <button type="button" onClick={() => !saving && setOpen(false)} className="text-gray-400 hover:text-gray-700"><X className="h-5 w-5" /></button>
            </div>

            <div className="max-h-[72vh] space-y-5 overflow-y-auto p-4">
              <Section title="זהות">
                <Field label="שם פרטי *"><input value={f.first_name} onChange={set('first_name')} className={inp} /></Field>
                <Field label="שם משפחה"><input value={f.last_name} onChange={set('last_name')} className={inp} /></Field>
                <Field label="אימייל" wide><input value={f.email} onChange={set('email')} dir="ltr" className={inp} /></Field>
              </Section>

              <Section title="מיקום (איזור חיפוש)">
                <Field label="ערים (מופרד בפסיקים)" wide><input value={f.preferred_cities} onChange={set('preferred_cities')} placeholder="קרית ביאליק, קרית מוצקין" className={inp} /></Field>
                <Field label="שכונות (מופרד בפסיקים)" wide><input value={f.preferred_neighborhoods} onChange={set('preferred_neighborhoods')} className={inp} /></Field>
              </Section>

              <Section title="תקציב">
                <Field label="תקציב מקס׳ (₪)"><input type="number" inputMode="numeric" value={f.budget_max} onChange={set('budget_max')} className={inp} /></Field>
                <Field label="תקציב מינ׳ (₪)"><input type="number" inputMode="numeric" value={f.budget_min} onChange={set('budget_min')} className={inp} /></Field>
                <Field label="גמישות תקציב (₪)"><input type="number" inputMode="numeric" value={f.budget_flexibility} onChange={set('budget_flexibility')} className={inp} /></Field>
                <Field label="אורך חוזה"><select value={f.contract_length} onChange={set('contract_length')} className={inp}><option value="">—</option><option value="6">6 חודשים</option><option value="12">שנה</option><option value="flexible">גמיש</option></select></Field>
                <Field label="ועד בית מקס׳ (₪)"><input type="number" inputMode="numeric" value={f.vaad_bayit_max} onChange={set('vaad_bayit_max')} className={inp} /></Field>
                <Field label="ארנונה מקס׳ (₪)"><input type="number" inputMode="numeric" value={f.arnona_max} onChange={set('arnona_max')} className={inp} /></Field>
              </Section>

              <Section title="דירה">
                <Field label="חדרים"><input type="number" inputMode="decimal" step="0.5" value={f.preferred_rooms} onChange={set('preferred_rooms')} className={inp} /></Field>
                <Field label="גמיש בחדרים"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.rooms_flexible === 'true'} onChange={setBool('rooms_flexible')} /> כן</label></Field>
                <Field label="מ״ר מינ׳"><input type="number" inputMode="numeric" value={f.min_sqm} onChange={set('min_sqm')} className={inp} /></Field>
                <Field label="קומה מינ׳"><input type="number" inputMode="numeric" value={f.floor_min} onChange={set('floor_min')} className={inp} /></Field>
                <Field label="קומה מקס׳"><input type="number" inputMode="numeric" value={f.floor_max} onChange={set('floor_max')} className={inp} /></Field>
                <Field label="קומה עליונה"><select value={f.top_floor_preference} onChange={set('top_floor_preference')} className={inp}><option value="any">לא משנה</option><option value="yes">מעדיף/ה</option><option value="no">לא מעוניין/ת</option></select></Field>
                <Field label="מצב הדירה"><select value={f.condition_preference} onChange={set('condition_preference')} className={inp}><option value="any">לא משנה</option><option value="renovated">משופצת</option><option value="good">טובה</option><option value="needs-work">זקוקה לשיפוץ</option></select></Field>
              </Section>

              <Section title="כניסה">
                <Field label="תאריך כניסה"><input type="date" value={f.move_in_date} onChange={set('move_in_date')} className={inp} /></Field>
                <Field label="גמיש בתאריך"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.move_in_flexible === 'true'} onChange={setBool('move_in_flexible')} /> כן</label></Field>
              </Section>

              <Section title="משק בית">
                <Field label="סוג"><select value={f.household_type} onChange={set('household_type')} className={inp}><option value="">—</option><option value="single">יחיד</option><option value="couple">זוג</option><option value="family">משפחה</option><option value="roommates">שותפים</option><option value="students">סטודנטים</option><option value="other">אחר</option></select></Field>
                <Field label="נפשות"><input type="number" inputMode="numeric" value={f.household_size} onChange={set('household_size')} className={inp} /></Field>
                <Field label="ילדים"><select value={f.has_children} onChange={set('has_children')} className={inp}><TriOpts /></select></Field>
                <Field label="מספר ילדים"><input type="number" inputMode="numeric" value={f.children_count} onChange={set('children_count')} className={inp} /></Field>
                <Field label="חיות מחמד"><select value={f.has_pets} onChange={set('has_pets')} className={inp}><TriOpts /></select></Field>
                <Field label="מעשנים"><select value={f.smokers} onChange={set('smokers')} className={inp}><TriOpts /></select></Field>
              </Section>

              <Section title="תעסוקה וביטחונות">
                <Field label="מצב תעסוקה"><select value={f.employment_status} onChange={set('employment_status')} className={inp}><option value="">—</option><option value="employed">שכיר/ה</option><option value="self_employed">עצמאי/ת</option><option value="student">סטודנט/ית</option><option value="other">אחר</option></select></Field>
                <Field label="מקום עבודה"><input value={f.employer} onChange={set('employer')} className={inp} /></Field>
                <Field label="תלושי שכר"><select value={f.has_payslips} onChange={set('has_payslips')} className={inp}><TriOpts /></select></Field>
                <Field label="צ׳קים לביטחון"><select value={f.has_security_checks} onChange={set('has_security_checks')} className={inp}><TriOpts /></select></Field>
                <Field label="ערבים"><select value={f.has_guarantors} onChange={set('has_guarantors')} className={inp}><TriOpts /></select></Field>
              </Section>

              <Section title="העדפות (חובה / יתרון / לא משנה)">
                <PrefRow label="חניה" level={prefs.parking.level} onLevel={v => setPref('parking', { level: v })}>
                  <select value={prefs.parking.type} onChange={e => setPref('parking', { type: e.target.value })} className={inpSm}>{PARKING_TYPES.map(o => <option key={o.v} value={o.v}>{o.t}</option>)}</select>
                </PrefRow>
                <PrefRow label="מרפסת" level={prefs.balcony.level} onLevel={v => setPref('balcony', { level: v })}>
                  <input type="number" inputMode="numeric" placeholder="מ״ר מינ׳" value={prefs.balcony.min_sqm} onChange={e => setPref('balcony', { min_sqm: e.target.value })} className={inpSm} />
                </PrefRow>
                <PrefRow label="ריהוט" level={prefs.furnished.level} onLevel={v => setPref('furnished', { level: v })}>
                  <select value={prefs.furnished.amount} onChange={e => setPref('furnished', { amount: e.target.value })} className={inpSm}>{AMOUNTS.map(o => <option key={o.v} value={o.v}>{o.t}</option>)}</select>
                </PrefRow>
                <PrefRow label="מזגן" level={prefs.aircon.level} onLevel={v => setPref('aircon', { level: v })}>
                  <select value={prefs.aircon.amount} onChange={e => setPref('aircon', { amount: e.target.value })} className={inpSm}>{AMOUNTS.map(o => <option key={o.v} value={o.v}>{o.t}</option>)}</select>
                </PrefRow>
                <PrefRow label="נגישות" level={prefs.accessibility.level} onLevel={v => setPref('accessibility', { level: v })}>
                  <select value={prefs.accessibility.type} onChange={e => setPref('accessibility', { type: e.target.value })} className={inpSm}>{ACCESS_TYPES.map(o => <option key={o.v} value={o.v}>{o.t}</option>)}</select>
                </PrefRow>
                {RANKED_AMENITIES.map(a => (
                  <PrefRow key={a.k} label={a.l} level={prefs[a.k].level} onLevel={v => setPref(a.k, { level: v })} />
                ))}
                <div className="mt-1 border-t pt-2" style={{ borderColor: 'var(--line)' }}>
                  <div className="mb-1 text-xs" style={{ color: 'var(--ink-4)' }}>נחוץ / לא נחוץ:</div>
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                    {WANTED_AMENITIES.map(a => (
                      <label key={a.k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={prefs[a.k].wanted} onChange={e => setPref(a.k, { wanted: e.target.checked })} /> {a.l}</label>
                    ))}
                  </div>
                  <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={prefs.divided_ok} onChange={e => setPrefs(prev => ({ ...prev, divided_ok: e.target.checked }))} /> דירה מחולקת מתאימה</label>
                </div>
              </Section>

              <div>
                <label className="mb-1 block text-xs" style={{ color: 'var(--ink-4)' }}>הערות</label>
                <textarea value={f.notes} onChange={set('notes')} rows={4} className={`${inp} resize-y`} />
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-t p-4" style={{ borderColor: 'var(--line)' }}>
              {error ? <span className="text-sm text-red-600">{error}</span> : <span className="text-xs" style={{ color: 'var(--ink-4)' }}>שמירה תרענן אוטומטית את ההתאמות</span>}
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
const inpSm = 'rounded-md border border-brand-border bg-white px-2 py-1 text-sm w-full'

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

function PrefRow({ label, level, onLevel, children }: { label: string; level: string; onLevel: (v: string) => void; children?: React.ReactNode }) {
  return (
    <div className="sm:col-span-2 flex items-center gap-2">
      <span className="w-20 shrink-0 text-sm" style={{ color: 'var(--ink-2)' }}>{label}</span>
      <select value={level} onChange={e => onLevel(e.target.value)} className={inpSm} style={{ maxWidth: 120 }}>
        {LEVELS.map(o => <option key={o.v} value={o.v}>{o.t}</option>)}
      </select>
      {children}
    </div>
  )
}

function TriOpts() {
  return (<><option value="">לא ידוע</option><option value="true">כן</option><option value="false">לא</option></>)
}

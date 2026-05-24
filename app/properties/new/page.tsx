'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { uploadPropertyImage } from '../../../lib/storage'
import { useAddressSearch } from '../../../lib/hooks/useAddressSearch'
import { useDraftAutosave, loadDraft, clearDraft } from '../../../lib/hooks/useDraftAutosave'
import {
  ArrowRight, User, Phone, MapPin, Home, Ruler, Building, Calendar, Camera,
  Check, Loader2, AlertCircle, X, Sparkles, Search, Save,
} from 'lucide-react'

type Amenities = {
  elevator: boolean
  parking: boolean
  balcony: boolean
  airConditioner: boolean
  storage: boolean
  mamad: boolean
}

const AMENITY_LABELS: Record<keyof Amenities, string> = {
  elevator: 'מעלית',
  parking: 'חניה',
  balcony: 'מרפסת',
  airConditioner: 'מזגן',
  storage: 'מחסן',
  mamad: 'ממ"ד',
}

const CITIES = ['קריית אתא', 'קריית ביאליק', 'קריית מוצקין', 'קריית ים', 'קריית חיים', 'חיפה', 'נשר']

function newUuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  // RFC4122 v4 fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

const DRAFT_KEY = 'new-property'

type FormState = {
  contact_name: string
  contact_phone: string
  city: string
  customCity: string
  street: string
  neighborhood: string
  floor: string
  rooms: string
  sqm: string
  price: string
  available_from: string
  description: string
  pets_allowed: boolean
  smokers_allowed: boolean
}

const INITIAL_FORM: FormState = {
  contact_name: '',
  contact_phone: '',
  city: '',
  customCity: '',
  street: '',
  neighborhood: '',
  floor: '',
  rooms: '',
  sqm: '',
  price: '',
  available_from: '',
  description: '',
  pets_allowed: false,
  smokers_allowed: false,
}

const INITIAL_AMENITIES: Amenities = {
  elevator: false,
  parking: false,
  balcony: false,
  airConditioner: false,
  storage: false,
  mamad: false,
}

export default function NewPropertyPage() {
  const router = useRouter()
  const propertyId = useMemo(newUuid, [])

  const [form, setForm] = useState<FormState>(INITIAL_FORM)
  const [amenities, setAmenities] = useState<Amenities>(INITIAL_AMENITIES)
  const [draftLoaded, setDraftLoaded] = useState(false)
  const [draftRestored, setDraftRestored] = useState(false)

  // On mount: offer to restore draft
  useEffect(() => {
    if (draftLoaded) return
    setDraftLoaded(true)
    const saved = loadDraft<{ form: FormState; amenities: Amenities }>(DRAFT_KEY)
    if (saved && saved.form) {
      const ageMin = Math.round((Date.now() - saved._savedAt) / 60000)
      const ageLabel = ageMin < 1 ? 'פחות מדקה' : ageMin === 1 ? 'דקה' : `${ageMin} דקות`
      const yes = window.confirm(`נמצאה טיוטה שמורה מלפני ${ageLabel}. לטעון אותה?`)
      if (yes) {
        setForm(saved.form)
        if (saved.amenities) setAmenities(saved.amenities)
        setDraftRestored(true)
      } else {
        clearDraft(DRAFT_KEY)
      }
    }
  }, [draftLoaded])

  // Autosave every 5s
  const { savedAt } = useDraftAutosave(DRAFT_KEY, { form, amenities }, 5000)

  const [files, setFiles] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const [uploadProgress, setUploadProgress] = useState<number>(0)
  const [autoApprove, setAutoApprove] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  function addFiles(list: FileList | null) {
    if (!list) return
    const arr = Array.from(list).filter(f => f.type.startsWith('image/'))
    setFiles(prev => [...prev, ...arr])
    setPreviews(prev => [...prev, ...arr.map(f => URL.createObjectURL(f))])
  }

  function removeFile(idx: number) {
    setFiles(prev => prev.filter((_, i) => i !== idx))
    setPreviews(prev => {
      const removed = prev[idx]
      if (removed) URL.revokeObjectURL(removed)
      return prev.filter((_, i) => i !== idx)
    })
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    setError(null)

    const city = form.city === '__other__' ? form.customCity.trim() : form.city
    if (!form.contact_name.trim()) return setError('שם בעל הנכס חובה')
    if (!form.contact_phone.trim()) return setError('מספר טלפון חובה')
    if (!city) return setError('עיר חובה')
    if (!form.price || Number(form.price) <= 0) return setError('מחיר חובה')
    if (files.length === 0) {
      const proceed = window.confirm('לא העלית תמונות. בלי תמונה לא נוכל לשלוח פנייה ראשונה לבעל הנכס. להמשיך בכל זאת?')
      if (!proceed) return
    }

    setSubmitting(true)
    try {
      // 1. Upload images to property-images/<propertyId>/...
      const imageUrls: string[] = []
      for (let i = 0; i < files.length; i++) {
        setUploadProgress(Math.round((i / files.length) * 100))
        try {
          const { publicUrl } = await uploadPropertyImage(propertyId, files[i] as File)
          imageUrls.push(publicUrl)
        } catch (err) {
          console.error('upload error', err)
        }
      }
      setUploadProgress(100)

      // 2. Submit to API
      const res = await fetch('/api/v1/properties/manual-add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId,
          contact_name: form.contact_name.trim(),
          contact_phone: form.contact_phone.trim(),
          city,
          neighborhood: form.neighborhood.trim() || undefined,
          street: form.street.trim() || undefined,
          address: form.street.trim() ? `${form.street.trim()}, ${city}` : city,
          floor: form.floor !== '' ? Number(form.floor) : undefined,
          rooms: form.rooms !== '' ? Number(form.rooms) : undefined,
          sqm: form.sqm !== '' ? Number(form.sqm) : undefined,
          price: Number(form.price),
          available_from: form.available_from || undefined,
          description: form.description.trim() || undefined,
          amenities,
          pets_allowed: form.pets_allowed,
          smokers_allowed: form.smokers_allowed,
          images: imageUrls,
          auto_approve: autoApprove,
          title: `${form.street || form.neighborhood || city} ${form.rooms ? `· ${form.rooms} חד׳` : ''}`.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error?.message || data?.error?.code || 'שמירה נכשלה')
      clearDraft(DRAFT_KEY)
      setSuccess(true)
      setTimeout(() => router.push(autoApprove ? '/approved-properties' : '/properties'), 800)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שמירה נכשלה')
    } finally {
      setSubmitting(false)
    }
  }

  if (success) {
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <div className="mx-auto h-16 w-16 rounded-full bg-emerald-100 flex items-center justify-center mb-4">
          <Check className="h-8 w-8 text-emerald-600" />
        </div>
        <h2 className="text-xl font-bold">הנכס נוסף בהצלחה 🎉</h2>
        <p className="text-sm text-gray-600 mt-2">{autoApprove ? 'מועבר לדף נכסים מאושרים...' : 'מועבר לדף נכסים...'}</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 pb-32">
      <button type="button" onClick={() => router.back()} className="inline-flex items-center gap-1 text-sm text-brand-primary hover:underline mb-4">
        <ArrowRight className="h-4 w-4" /> חזרה
      </button>

      <div className="flex items-center gap-3 mb-2">
        <Sparkles className="h-6 w-6 text-brand-primary" />
        <h1 className="text-2xl font-bold">הוספת נכס חדש</h1>
      </div>
      <p className="text-sm text-gray-600 mb-6">
        טופס מהיר לעובדים. הנכס יסומן כמאושר תיווך אוטומטית — אלא אם תבטל למטה.
      </p>

      <form onSubmit={onSubmit} className="space-y-6">
        {/* Section: Landlord */}
        <Section title="בעל הנכס" icon={<User className="h-5 w-5" />}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="שם פרטי *" required>
              <input
                type="text"
                value={form.contact_name}
                onChange={e => setForm(v => ({ ...v, contact_name: e.target.value }))}
                placeholder="דני"
                className="input"
                required
              />
            </Field>
            <Field label="מספר טלפון *" required hint="ניתן להזין עם או בלי קידומת">
              <div className="relative">
                <Phone className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="tel"
                  inputMode="tel"
                  value={form.contact_phone}
                  onChange={e => setForm(v => ({ ...v, contact_phone: e.target.value }))}
                  placeholder="050-1234567"
                  className="input pr-8"
                  required
                />
              </div>
            </Field>
          </div>
        </Section>

        {/* Section: Location */}
        <Section title="מיקום" icon={<MapPin className="h-5 w-5" />}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="עיר *" required>
              <select
                value={form.city}
                onChange={e => setForm(v => ({ ...v, city: e.target.value }))}
                className="input"
                required
              >
                <option value="">בחר עיר</option>
                {CITIES.map(c => <option key={c} value={c}>{c}</option>)}
                <option value="__other__">עיר אחרת (הזן ידנית)</option>
              </select>
              {form.city === '__other__' && (
                <input
                  type="text"
                  value={form.customCity}
                  onChange={e => setForm(v => ({ ...v, customCity: e.target.value }))}
                  placeholder="שם העיר"
                  className="input mt-2"
                  required
                />
              )}
            </Field>
            <Field label="שכונה">
              <input
                type="text"
                value={form.neighborhood}
                onChange={e => setForm(v => ({ ...v, neighborhood: e.target.value }))}
                placeholder="לדוגמה: נווה שאנן"
                className="input"
              />
            </Field>
            <div className="sm:col-span-2">
              <AddressAutocomplete
                value={form.street}
                onChange={street => setForm(v => ({ ...v, street }))}
                onPick={({ street, city, neighborhood }) => {
                  setForm(v => ({
                    ...v,
                    street: street || v.street,
                    // Only auto-fill city/neighborhood if they're empty (don't override manual choices)
                    city: v.city || (city ? (CITIES.includes(city) ? city : '__other__') : v.city),
                    customCity: v.customCity || (city && !CITIES.includes(city) ? city : v.customCity),
                    neighborhood: v.neighborhood || (neighborhood || ''),
                  }))
                }}
              />
            </div>
          </div>
        </Section>

        {/* Section: Property details */}
        <Section title="פרטי הדירה" icon={<Home className="h-5 w-5" />}>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="חדרים">
              <input
                type="number"
                step="0.5"
                min="0"
                value={form.rooms}
                onChange={e => setForm(v => ({ ...v, rooms: e.target.value }))}
                placeholder="3"
                className="input"
              />
            </Field>
            <Field label="גודל במ&quot;ר">
              <input
                type="number"
                min="0"
                value={form.sqm}
                onChange={e => setForm(v => ({ ...v, sqm: e.target.value }))}
                placeholder="80"
                className="input"
              />
            </Field>
            <Field label="קומה">
              <input
                type="number"
                min="0"
                value={form.floor}
                onChange={e => setForm(v => ({ ...v, floor: e.target.value }))}
                placeholder="2"
                className="input"
              />
            </Field>
            <Field label="מחיר חודשי (₪) *" required>
              <input
                type="number"
                min="0"
                value={form.price}
                onChange={e => setForm(v => ({ ...v, price: e.target.value }))}
                placeholder="4500"
                className="input"
                required
              />
            </Field>
            <Field label="תאריך כניסה" className="sm:col-span-2">
              <input
                type="date"
                value={form.available_from}
                onChange={e => setForm(v => ({ ...v, available_from: e.target.value }))}
                className="input"
              />
            </Field>
          </div>

          <div className="mt-4">
            <div className="text-sm text-gray-600 mb-2">מאפיינים</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {(Object.keys(AMENITY_LABELS) as Array<keyof Amenities>).map(k => (
                <label key={k} className={`flex items-center gap-2 rounded-md border px-3 py-2 cursor-pointer transition ${
                  amenities[k] ? 'border-brand-primary bg-brand-primary/5 text-brand-primary' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                }`}>
                  <input
                    type="checkbox"
                    checked={amenities[k]}
                    onChange={e => setAmenities(a => ({ ...a, [k]: e.target.checked }))}
                    className="sr-only"
                  />
                  <Check className={`h-4 w-4 ${amenities[k] ? 'opacity-100' : 'opacity-0'}`} />
                  {AMENITY_LABELS[k]}
                </label>
              ))}
            </div>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <label className={`flex items-center gap-2 rounded-md border px-3 py-2 cursor-pointer transition ${
              form.pets_allowed ? 'border-brand-primary bg-brand-primary/5 text-brand-primary' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
            }`}>
              <input
                type="checkbox"
                checked={form.pets_allowed}
                onChange={e => setForm(v => ({ ...v, pets_allowed: e.target.checked }))}
                className="sr-only"
              />
              <Check className={`h-4 w-4 ${form.pets_allowed ? 'opacity-100' : 'opacity-0'}`} />
              מתאים לחיות מחמד
            </label>
            <label className={`flex items-center gap-2 rounded-md border px-3 py-2 cursor-pointer transition ${
              form.smokers_allowed ? 'border-brand-primary bg-brand-primary/5 text-brand-primary' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
            }`}>
              <input
                type="checkbox"
                checked={form.smokers_allowed}
                onChange={e => setForm(v => ({ ...v, smokers_allowed: e.target.checked }))}
                className="sr-only"
              />
              <Check className={`h-4 w-4 ${form.smokers_allowed ? 'opacity-100' : 'opacity-0'}`} />
              מותר עישון
            </label>
          </div>
        </Section>

        {/* Section: Description */}
        <Section title="תיאור" icon={<Building className="h-5 w-5" />}>
          <Field label="תיאור חופשי" hint="מה שהבוט יכול להשתמש בו בשיחות עם בעלי דירות + שוכרים">
            <textarea
              value={form.description}
              onChange={e => setForm(v => ({ ...v, description: e.target.value }))}
              rows={4}
              placeholder="דירה משופצת, מטבח חדש, נוף לים, חניה בטאבו..."
              className="input"
            />
          </Field>
        </Section>

        {/* Section: Images */}
        <Section title="תמונות" icon={<Camera className="h-5 w-5" />}>
          <div className="rounded-md border-2 border-dashed border-gray-300 p-4 text-center">
            <label className="block cursor-pointer">
              <input
                type="file"
                multiple
                accept="image/*"
                onChange={e => addFiles(e.target.files)}
                className="hidden"
              />
              <Camera className="mx-auto h-8 w-8 text-gray-400 mb-2" />
              <div className="text-sm text-gray-700">לחץ להוספת תמונות</div>
              <div className="text-xs text-gray-500 mt-1">חשוב — בלי לפחות תמונה אחת לא נוכל לשלוח פנייה ראשונה</div>
            </label>
          </div>
          {previews.length > 0 && (
            <div className="grid grid-cols-3 gap-2 mt-3">
              {previews.map((src, i) => (
                <div key={i} className="relative aspect-square rounded-md overflow-hidden border border-gray-200">
                  <img src={src} alt="" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    className="absolute top-1 left-1 rounded-full bg-black/70 p-1 text-white hover:bg-black"
                    aria-label="הסר תמונה"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Auto-approve */}
        <div className="rounded-lg border border-brand-border bg-white p-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={autoApprove}
              onChange={e => setAutoApprove(e.target.checked)}
              className="mt-1 h-5 w-5 accent-brand-primary"
            />
            <div>
              <div className="font-medium">סמן כמאושר תיווך אוטומטית</div>
              <div className="text-xs text-gray-600 mt-1">
                בעל הנכס כבר הסכים בעל-פה. הנכס יופיע מיד ב-״נכסים מאושרים״ ויהיה זמין לבוט לשליחת פנייה.
              </div>
            </div>
          </label>
        </div>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {submitting && uploadProgress > 0 && uploadProgress < 100 && (
          <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
            מעלה תמונות: {uploadProgress}%
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full flex items-center justify-center gap-2 rounded-md bg-brand-primary px-4 py-3 text-base font-semibold text-white hover:opacity-90 disabled:opacity-60"
        >
          {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
          {submitting ? 'שומר...' : (autoApprove ? 'הוסף נכס + אישור תיווך' : 'הוסף נכס')}
        </button>

        <div className="flex items-center justify-center gap-1.5 text-xs text-gray-500">
          <Save className="h-3 w-3" />
          {savedAt
            ? <SavedAtLabel ts={savedAt} restored={draftRestored} />
            : draftRestored
              ? <span>טיוטה שוחזרה</span>
              : <span>שמירה אוטומטית פעילה</span>
          }
        </div>
      </form>

      <style jsx global>{`
        .input {
          width: 100%;
          border-radius: 0.375rem;
          border: 1px solid #e5e7eb;
          padding: 0.5rem 0.75rem;
          font-size: 0.95rem;
          background: white;
        }
        .input:focus {
          outline: none;
          border-color: var(--brand-primary, #3b82f6);
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
        }
      `}</style>
    </div>
  )
}

function SavedAtLabel({ ts, restored }: { ts: number; restored: boolean }) {
  const [, force] = useState(0)
  useEffect(() => {
    const id = setInterval(() => force(x => x + 1), 5000)
    return () => clearInterval(id)
  }, [])
  const secs = Math.max(1, Math.round((Date.now() - ts) / 1000))
  const label = secs < 60 ? `נשמרה לפני ${secs} שניות` : `נשמרה לפני ${Math.round(secs / 60)} דק׳`
  return <span>{label}{restored ? ' · שוחזרה ממסשן קודם' : ''}</span>
}

function AddressAutocomplete({
  value,
  onChange,
  onPick,
}: {
  value: string
  onChange: (v: string) => void
  onPick: (picked: { street: string | null; city: string | null; neighborhood: string | null }) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState(value)
  const containerRef = useRef<HTMLDivElement>(null)
  const { results, loading } = useAddressSearch(query)

  useEffect(() => { setQuery(value) }, [value])

  // Close dropdown on outside click
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  return (
    <label className="block" ref={containerRef as any}>
      <span className="block text-sm font-medium text-gray-700 mb-1">רחוב + מספר</span>
      <div className="relative">
        <Search className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); onChange(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder="התחל להקליד כתובת..."
          className="input pr-8"
          autoComplete="off"
        />
        {loading && <Loader2 className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-gray-400" />}
        {open && results.length > 0 && (
          <ul className="absolute z-20 mt-1 w-full max-h-72 overflow-auto rounded-md border border-gray-200 bg-white shadow-lg">
            {results.map((r, i) => {
              const streetLabel = [r.street, r.housenumber].filter(Boolean).join(' ')
              return (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => {
                      const streetFull = streetLabel || (r.display_name.split(',')[0] || '').trim()
                      onChange(streetFull)
                      onPick({ street: streetFull, city: r.city, neighborhood: r.neighbourhood })
                      setQuery(streetFull)
                      setOpen(false)
                    }}
                    className="block w-full text-right px-3 py-2 hover:bg-gray-50 text-sm border-b border-gray-50 last:border-0"
                  >
                    <div className="font-medium text-gray-900">{streetLabel || r.display_name.split(',')[0]}</div>
                    <div className="text-xs text-gray-500 truncate">
                      {[r.neighbourhood, r.city].filter(Boolean).join(' · ')}
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <span className="block text-xs text-gray-500 mt-1">אוטומט מ-OpenStreetMap — מילוי-עצמי של עיר ושכונה</span>
    </label>
  )
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-brand-border bg-white p-4">
      <div className="flex items-center gap-2 mb-3 pb-2 border-b border-gray-100">
        <span className="text-brand-primary">{icon}</span>
        <h2 className="font-semibold">{title}</h2>
      </div>
      {children}
    </section>
  )
}

function Field({
  label,
  hint,
  required,
  className = '',
  children,
}: {
  label: string
  hint?: string
  required?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-sm font-medium text-gray-700 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-xs text-gray-500 mt-1">{hint}</span>}
    </label>
  )
}

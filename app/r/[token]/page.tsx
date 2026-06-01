'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'

// =============================================================
// Types
// =============================================================

type HouseholdType = 'single' | 'couple' | 'family' | 'roommates' | 'students' | 'other'
type EmploymentStatus = 'employed' | 'self_employed' | 'student' | 'other'
type ContractLength = '6' | '12' | 'flexible'
type Condition = 'renovated' | 'good' | 'needs-work' | 'any'
type TopFloorPref = 'any' | 'yes' | 'no'
type PrefLevel = 'must' | 'nice' | 'any'
type ParkingType = 'any' | 'private' | 'shared' | 'street'
type LevelAmount = 'none' | 'partial' | 'full' | 'any'
type AccessType = 'any' | 'no-stairs' | 'ramp' | 'wide-door'

type RankedPref = { level: PrefLevel }
type ParkingPref = { level: PrefLevel; type: ParkingType }
type BalconyPref = { level: PrefLevel; min_sqm: number | null }
type LevelPref = { level: PrefLevel; amount: LevelAmount }
type AccessPref = { level: PrefLevel; type: AccessType }
type Wanted = { wanted: boolean }

type Preferences = {
  parking: ParkingPref
  elevator: RankedPref
  balcony: BalconyPref
  furnished: LevelPref
  aircon: LevelPref
  mamad: RankedPref
  accessibility: AccessPref
  storage: Wanted
  solar_heater: Wanted
  bars: Wanted
  quiet: Wanted
  fiber_internet: Wanted
  shelter: Wanted
}

type FormData = {
  firstName: string
  lastName: string
  phone: string
  email: string

  preferredCities: string[]
  customCity: string
  preferredNeighborhoods: string[]
  budgetMin: string
  budgetMax: string
  budgetFlexibility: string
  vaadBayitMax: string
  arnonaMax: string
  contractLength: ContractLength | ''

  preferredRooms: string
  roomsFlexible: boolean
  minSqm: string
  floorMin: string
  floorMax: string
  topFloorPreference: TopFloorPref
  conditionPreference: Condition

  moveInDate: string
  moveInFlexible: boolean | null

  householdType: HouseholdType | ''
  householdSize: string
  hasChildren: boolean | null
  childrenCount: string
  hasPets: boolean | null
  smokers: boolean | null

  preferences: Preferences

  employmentStatus: EmploymentStatus | ''
  employer: string
  hasPayslips: boolean | null
  hasSecurityChecks: boolean | null
  hasGuarantors: boolean | null

  notes: string
}

const KRAYOT_CITIES = [
  'קרית ביאליק',
  'קרית מוצקין',
  'קרית אתא',
  'קרית ים',
  'חיפה',
  'נשר',
  'טירת כרמל',
  'עכו',
]

const initialPreferences: Preferences = {
  parking: { level: 'any', type: 'any' },
  elevator: { level: 'any' },
  balcony: { level: 'any', min_sqm: null },
  furnished: { level: 'any', amount: 'any' },
  aircon: { level: 'any', amount: 'any' },
  mamad: { level: 'any' },
  accessibility: { level: 'any', type: 'any' },
  storage: { wanted: false },
  solar_heater: { wanted: false },
  bars: { wanted: false },
  quiet: { wanted: false },
  fiber_internet: { wanted: false },
  shelter: { wanted: false },
}

const initial: FormData = {
  firstName: '',
  lastName: '',
  phone: '',
  email: '',
  preferredCities: [],
  customCity: '',
  preferredNeighborhoods: [],
  budgetMin: '',
  budgetMax: '',
  budgetFlexibility: '',
  vaadBayitMax: '',
  arnonaMax: '',
  contractLength: '',
  preferredRooms: '',
  roomsFlexible: false,
  minSqm: '',
  floorMin: '',
  floorMax: '',
  topFloorPreference: 'any',
  conditionPreference: 'any',
  moveInDate: '',
  moveInFlexible: null,
  householdType: '',
  householdSize: '',
  hasChildren: null,
  childrenCount: '',
  hasPets: null,
  smokers: null,
  preferences: initialPreferences,
  employmentStatus: '',
  employer: '',
  hasPayslips: null,
  hasSecurityChecks: null,
  hasGuarantors: null,
  notes: '',
}

// =============================================================
// Page
// =============================================================

export default function RenterFormPage() {
  const params = useParams<{ token: string }>()
  const token = params?.token || ''

  const [loadingInvite, setLoadingInvite] = useState(true)
  const [inviteError, setInviteError] = useState<'not_found' | 'already_submitted' | 'network' | null>(null)
  const [hasStarted, setHasStarted] = useState(false)
  const [data, setData] = useState<FormData>(initial)

  const [step, setStep] = useState(0)
  const totalSteps = 6

  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  // Surfaced from the submit response so the success screen can branch on
  // whether we triggered an invite email (renter provided an address) or not.
  const [submitResult, setSubmitResult] = useState<{ krayot_app_url?: string; will_receive_email?: boolean } | null>(null)
  const [submitError, setSubmitError] = useState('')

  useEffect(() => {
    if (!token) {
      setInviteError('not_found')
      setLoadingInvite(false)
      return
    }
    fetch(`/api/v1/renters/invite/${token}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(res => {
        if (!res?.found) {
          setInviteError('not_found')
        } else if (res.invite.already_submitted) {
          setInviteError('already_submitted')
          setData(prev => ({
            ...prev,
            firstName: res.invite.first_name,
            lastName: res.invite.last_name,
            phone: res.invite.phone,
          }))
        } else {
          setData(prev => ({
            ...prev,
            firstName: res.invite.first_name,
            lastName: res.invite.last_name,
            phone: res.invite.phone,
          }))
        }
      })
      .catch(() => setInviteError('network'))
      .finally(() => setLoadingInvite(false))
  }, [token])

  const set = <K extends keyof FormData>(field: K, value: FormData[K]) => {
    setData(prev => ({ ...prev, [field]: value }))
  }

  const setPref = <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
    setData(prev => ({ ...prev, preferences: { ...prev.preferences, [key]: value } }))
  }

  const toggleCity = (city: string) => {
    setData(prev => {
      const exists = prev.preferredCities.includes(city)
      return {
        ...prev,
        preferredCities: exists
          ? prev.preferredCities.filter(c => c !== city)
          : [...prev.preferredCities, city],
      }
    })
  }

  const toggleNeighborhood = (nbh: string) => {
    setData(prev => {
      const exists = prev.preferredNeighborhoods.includes(nbh)
      return {
        ...prev,
        preferredNeighborhoods: exists
          ? prev.preferredNeighborhoods.filter(n => n !== nbh)
          : [...prev.preferredNeighborhoods, nbh],
      }
    })
  }

  // Live-load the neighborhoods available in the cities the renter has picked.
  // Optional step — we don't block the form on it, and a renter can ignore
  // this whole section (empty list = neutral on the neighborhood dimension).
  const [neighborhoodOptions, setNeighborhoodOptions] = useState<Array<{ name: string; city: string; count: number }>>([])
  useEffect(() => {
    const extras = data.customCity.split(/[,\n]/).map(c => c.trim()).filter(Boolean)
    const cities = Array.from(new Set([...data.preferredCities, ...extras]))
    if (cities.length === 0) {
      setNeighborhoodOptions([])
      return
    }
    const ctrl = new AbortController()
    fetch(`/api/v1/neighborhoods?cities=${encodeURIComponent(cities.join(','))}`, { signal: ctrl.signal })
      .then(r => r.json())
      .then(d => setNeighborhoodOptions(d?.neighborhoods || []))
      .catch(() => {/* network/abort — silently ignore */})
    return () => ctrl.abort()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.preferredCities.join('|'), data.customCity])

  const allCities = (): string[] => {
    const extras = data.customCity
      .split(/[,\n]/)
      .map(c => c.trim())
      .filter(Boolean)
    return Array.from(new Set([...data.preferredCities, ...extras]))
  }

  const canProceed = () => {
    switch (step) {
      case 0:
        return !!(data.firstName.trim() && data.phone.trim())
      case 1:
        return allCities().length > 0 && data.budgetMax.trim() !== ''
      case 2:
        return data.preferredRooms.trim() !== ''
      case 3:
        return data.householdType !== '' && data.hasPets !== null && data.smokers !== null
      case 4:
        return true // preferences step is fully optional
      case 5:
        return (
          data.employmentStatus !== '' &&
          data.hasPayslips !== null &&
          data.hasSecurityChecks !== null &&
          data.hasGuarantors !== null
        )
      default:
        return false
    }
  }

  const handleNext = () => {
    if (step < totalSteps - 1 && canProceed()) {
      setStep(s => s + 1)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  const handleBack = () => {
    if (step > 0) {
      setStep(s => s - 1)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  const handleSubmit = async () => {
    if (!canProceed() || submitting) return
    setSubmitting(true)
    setSubmitError('')

    try {
      const res = await fetch('/api/v1/renters/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invite_token: token,
          first_name: data.firstName.trim(),
          last_name: data.lastName.trim(),
          phone: data.phone.trim(),
          email: data.email.trim(),

          preferred_cities: allCities(),
          preferred_neighborhoods: data.preferredNeighborhoods,
          budget_min: data.budgetMin,
          budget_max: data.budgetMax,
          budget_flexibility: data.budgetFlexibility,
          vaad_bayit_max: data.vaadBayitMax,
          arnona_max: data.arnonaMax,
          contract_length: data.contractLength,

          preferred_rooms: data.preferredRooms,
          rooms_flexible: data.roomsFlexible,
          min_sqm: data.minSqm,
          floor_min: data.floorMin,
          floor_max: data.floorMax,
          top_floor_preference: data.topFloorPreference,
          condition_preference: data.conditionPreference,

          move_in_date: data.moveInDate || null,
          move_in_flexible: data.moveInFlexible,

          household_type: data.householdType,
          household_size: data.householdSize,
          has_children: data.hasChildren,
          children_count: data.hasChildren ? data.childrenCount : null,
          has_pets: data.hasPets,
          smokers: data.smokers,

          preferences: data.preferences,

          employment_status: data.employmentStatus,
          employer: data.employer.trim(),
          has_payslips: data.hasPayslips,
          has_security_checks: data.hasSecurityChecks,
          has_guarantors: data.hasGuarantors,

          notes: data.notes.trim(),
        }),
      })
      if (!res.ok) throw new Error('server')
      const json = await res.json().catch(() => ({}))
      setSubmitResult({
        krayot_app_url: json?.krayot_app_url,
        will_receive_email: json?.will_receive_email === true,
      })
      setSubmitted(true)
    } catch (err) {
      console.error(err)
      setSubmitError('אירעה שגיאה, נסה/י שוב')
    } finally {
      setSubmitting(false)
    }
  }

  // ============== Render states ==============

  if (loadingInvite) return <CenterMessage><Spinner /> טוען...</CenterMessage>

  if (inviteError === 'not_found')
    return (
      <CenterMessage>
        <EmojiPanel emoji="🔗" title="הקישור לא נמצא" body="ייתכן שהקישור הועתק חלקית או שפג תוקפו. אנא פנו אלינו ונשלח חדש." />
      </CenterMessage>
    )

  if (inviteError === 'network')
    return (
      <CenterMessage>
        <EmojiPanel emoji="📡" title="בעיית רשת" body="לא הצלחנו לטעון את הטופס. נסו לרענן את הדף." />
      </CenterMessage>
    )

  if (inviteError === 'already_submitted')
    return (
      <CenterMessage>
        <EmojiPanel emoji="✅" title={`תודה ${data.firstName}!`} body="כבר קיבלנו את הפרטים שלך. נחזור אליך בקרוב." />
      </CenterMessage>
    )

  if (submitted) {
    return (
      <CenterMessage>
        <motion.div
          initial={{ scale: 0.92, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.35 }}
          className="bg-brand-surface border border-brand-border rounded-2xl shadow-card p-8 text-center max-w-md w-full"
        >
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.15, type: 'spring', stiffness: 220 }}
            className="w-20 h-20 rounded-full bg-brand-successSoft border border-brand-success/30 flex items-center justify-center mx-auto mb-6"
          >
            <svg className="w-10 h-10 text-brand-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </motion.div>
          <h2 className="text-2xl font-bold text-brand-ink mb-3">תודה {data.firstName}!</h2>
          <p className="text-brand-inkMuted leading-relaxed mb-6">
            קיבלנו את הפרטים שלך.
            <br />
            <span className="text-brand-ink font-semibold">פתחנו לך גם חשבון באפליקציית השוכרים שלנו</span> — שם תוכל/י לראות בזמן אמת דירות שמתאימות לך, לסמן מועדפות ולפנות ישירות למתווכים.
          </p>

          {submitResult?.will_receive_email && data.email && (
            <div className="mb-5 rounded-lg border border-brand-border bg-brand-surfaceMuted p-3 text-sm text-brand-inkMuted text-start">
              📩 שלחנו מייל ל-<span className="font-medium text-brand-ink">{data.email}</span> עם קישור להתחברות. לחצ/י עליו וקבע/י סיסמא — בלי למלא שום פרט מחדש.
            </div>
          )}

          {!submitResult?.will_receive_email && (
            <div className="mb-5 rounded-lg border border-brand-border bg-brand-surfaceMuted p-3 text-sm text-brand-inkMuted text-start">
              💡 לא נתת לנו כתובת מייל — לכן הרישום לאפליקציית השוכרים יעשה ידנית. קישור:
            </div>
          )}

          <a
            href={submitResult?.krayot_app_url || 'https://rent360-app.vercel.app/'}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 w-full bg-brand-primary text-white font-semibold py-3 px-6 rounded-md hover:bg-brand-primaryHover transition-colors"
          >
            פתח/י את אפליקציית השוכרים 🏠
          </a>
        </motion.div>
      </CenterMessage>
    )
  }

  if (!hasStarted) {
    return (
      <main className="min-h-dvh flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-lg"
        >
          <div className="flex justify-center mb-6">
            <img src="/logo.svg" alt="Rent360" className="h-10 w-auto" />
          </div>

          <div className="bg-brand-surface border border-brand-border rounded-2xl shadow-card p-7 sm:p-8">
            <div className="text-center mb-6">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-brand-primarySoft mb-4">
                <span className="text-2xl">🏠</span>
              </div>
              <h1 className="text-2xl font-bold text-brand-ink mb-2">שלום {data.firstName || ''} 👋</h1>
              <p className="text-brand-inkMuted leading-relaxed">
                כמה שאלות קצרות יעזרו לנו למצוא לך את הדירה המדויקת.
                <br />
                לוקח בערך 3 דקות.
              </p>
            </div>

            <div className="space-y-2.5 mb-7">
              <Bullet>פרטי קשר</Bullet>
              <Bullet>תקציב ומיקום</Bullet>
              <Bullet>איזו דירה</Bullet>
              <Bullet>מי גר בבית</Bullet>
              <Bullet>מה חשוב לך בדירה</Bullet>
              <Bullet>תעסוקה וביטחונות</Bullet>
            </div>

            <button
              onClick={() => setHasStarted(true)}
              className="w-full py-3.5 px-6 bg-brand-primary text-white font-semibold rounded-md hover:bg-brand-primaryHover transition-colors"
            >
              בואו נתחיל
            </button>
          </div>

          <p className="text-center text-xs text-brand-inkSoft mt-5">
            הפרטים שלך נשמרים אצלנו בלבד.
          </p>
        </motion.div>
      </main>
    )
  }

  // ============== Wizard ==============
  return (
    <main className="min-h-dvh">
      <header className="sticky top-0 z-10 bg-brand-bg/85 backdrop-blur-md border-b border-brand-border">
        <div className="max-w-lg mx-auto px-4 py-4">
          <div className="flex items-center justify-between mb-3">
            <img src="/logo.svg" alt="Rent360" className="h-7 w-auto" />
            <span className="text-sm text-brand-inkMuted font-medium">
              {step + 1} / {totalSteps}
            </span>
          </div>
          <div className="h-1.5 bg-brand-bgAlt rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-brand-primary rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${((step + 1) / totalSteps) * 100}%` }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
            />
          </div>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-6">
        <AnimatePresence mode="wait">
          {/* ---------- Step 0: Contact ---------- */}
          {step === 0 && (
            <StepWrap key="step-0">
              <Card title="פרטי קשר" subtitle="נוודא שהפרטים נכונים">
                <div className="space-y-4">
                  <div className="flex gap-3">
                    <Field label="שם פרטי" className="flex-1">
                      <input type="text" value={data.firstName} onChange={e => set('firstName', e.target.value)} className={inputCls} />
                    </Field>
                    <Field label="שם משפחה" className="flex-1">
                      <input type="text" value={data.lastName} onChange={e => set('lastName', e.target.value)} className={inputCls} />
                    </Field>
                  </div>
                  <Field label="טלפון">
                    <input type="tel" inputMode="tel" dir="ltr" value={data.phone} onChange={e => set('phone', e.target.value)} className={inputCls} placeholder="050-0000000" />
                  </Field>
                  <Field label="אימייל (לא חובה)">
                    <input type="email" inputMode="email" dir="ltr" value={data.email} onChange={e => set('email', e.target.value)} className={inputCls} placeholder="name@example.com" />
                  </Field>
                </div>
              </Card>
            </StepWrap>
          )}

          {/* ---------- Step 1: Location & Budget ---------- */}
          {step === 1 && (
            <StepWrap key="step-1">
              <Card title="איפה ובכמה?" subtitle="ערים, תקציב ותנאי החוזה">
                <div className="space-y-5">
                  <div>
                    <label className="block text-sm font-medium text-brand-ink mb-2">ערים מועדפות</label>
                    <div className="flex flex-wrap gap-2">
                      {KRAYOT_CITIES.map(city => {
                        const active = data.preferredCities.includes(city)
                        return (
                          <button
                            key={city}
                            type="button"
                            onClick={() => toggleCity(city)}
                            className={`px-3.5 py-2 rounded-full border text-sm font-medium transition-all ${
                              active
                                ? 'bg-brand-primary text-white border-brand-primary'
                                : 'bg-brand-surfaceMuted text-brand-inkMuted border-brand-border hover:border-brand-borderStrong'
                            }`}
                          >
                            {city}
                          </button>
                        )
                      })}
                    </div>
                    <input
                      type="text"
                      value={data.customCity}
                      onChange={e => set('customCity', e.target.value)}
                      placeholder="עוד ערים? הוסיפו כאן, מופרדות בפסיק"
                      className={`${inputCls} mt-3 text-sm`}
                    />
                  </div>

                  {neighborhoodOptions.length > 0 && (
                    <div>
                      <label className="block text-sm font-medium text-brand-ink mb-1">שכונות מועדפות <span className="text-brand-inkMuted text-xs">(לא חובה — דלגו אם לא משנה לכם)</span></label>
                      <p className="text-xs text-brand-inkMuted mb-2">{neighborhoodOptions.length} שכונות זמינות בערים שבחרתם. ככל שתבחרו פחות — נראה לכם יותר אפשרויות.</p>
                      <div className="flex flex-wrap gap-2 max-h-56 overflow-y-auto pb-1">
                        {neighborhoodOptions.map(nbh => {
                          const active = data.preferredNeighborhoods.includes(nbh.name)
                          return (
                            <button
                              key={`${nbh.city}::${nbh.name}`}
                              type="button"
                              onClick={() => toggleNeighborhood(nbh.name)}
                              className={`px-3 py-1.5 rounded-full border text-xs font-medium transition-all ${
                                active
                                  ? 'bg-brand-primary text-white border-brand-primary'
                                  : 'bg-brand-surfaceMuted text-brand-inkMuted border-brand-border hover:border-brand-borderStrong'
                              }`}
                              title={`${nbh.city} · ${nbh.count} נכסים`}
                            >
                              {nbh.name}
                              <span className="opacity-60 mr-1">· {nbh.count}</span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-brand-ink mb-1.5">תקציב חודשי (₪)</label>
                    <div className="flex gap-3 items-center">
                      <input type="number" inputMode="numeric" dir="ltr" value={data.budgetMin} onChange={e => set('budgetMin', e.target.value)} className={inputCls} placeholder="מ-" />
                      <span className="text-brand-inkSoft">—</span>
                      <input type="number" inputMode="numeric" dir="ltr" value={data.budgetMax} onChange={e => set('budgetMax', e.target.value)} className={inputCls} placeholder="עד" />
                    </div>
                  </div>

                  <Field label="גמישות תקציב (±₪) — לא חובה">
                    <input type="number" inputMode="numeric" dir="ltr" value={data.budgetFlexibility} onChange={e => set('budgetFlexibility', e.target.value)} className={inputCls} placeholder="500" />
                  </Field>

                  <div className="flex gap-3">
                    <Field label="ועד בית מקסימום" className="flex-1">
                      <input type="number" inputMode="numeric" dir="ltr" value={data.vaadBayitMax} onChange={e => set('vaadBayitMax', e.target.value)} className={inputCls} placeholder="לא חובה" />
                    </Field>
                    <Field label="ארנונה מקסימום" className="flex-1">
                      <input type="number" inputMode="numeric" dir="ltr" value={data.arnonaMax} onChange={e => set('arnonaMax', e.target.value)} className={inputCls} placeholder="לא חובה" />
                    </Field>
                  </div>

                  <Field label="משך חוזה רצוי">
                    <Choices
                      value={data.contractLength}
                      onChange={v => set('contractLength', v as ContractLength)}
                      options={[
                        { value: '12', label: 'שנה' },
                        { value: '6', label: '6 חודשים' },
                        { value: 'flexible', label: 'גמיש' },
                      ]}
                    />
                  </Field>
                </div>
              </Card>
            </StepWrap>
          )}

          {/* ---------- Step 2: Property details ---------- */}
          {step === 2 && (
            <StepWrap key="step-2">
              <Card title="איזו דירה?" subtitle="גודל, קומה, מצב ותאריך כניסה">
                <div className="space-y-5">
                  <Field label="מספר חדרים רצוי">
                    <div className="flex gap-3">
                      <input
                        type="number"
                        inputMode="decimal"
                        step="0.5"
                        dir="ltr"
                        value={data.preferredRooms}
                        onChange={e => set('preferredRooms', e.target.value)}
                        className={inputCls}
                        placeholder="3.5"
                      />
                    </div>
                    <label className="flex items-center gap-2 mt-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={data.roomsFlexible}
                        onChange={e => set('roomsFlexible', e.target.checked)}
                        className="w-4 h-4 accent-brand-primary"
                      />
                      <span className="text-sm text-brand-inkMuted">גמיש ±0.5 חדר</span>
                    </label>
                  </Field>

                  <Field label="מ״ר מינימום (לא חובה)">
                    <input type="number" inputMode="numeric" dir="ltr" value={data.minSqm} onChange={e => set('minSqm', e.target.value)} className={inputCls} placeholder="70" />
                  </Field>

                  <div className="flex gap-3">
                    <Field label="קומה מ-" className="flex-1">
                      <input type="number" inputMode="numeric" dir="ltr" value={data.floorMin} onChange={e => set('floorMin', e.target.value)} className={inputCls} placeholder="0" />
                    </Field>
                    <Field label="קומה עד-" className="flex-1">
                      <input type="number" inputMode="numeric" dir="ltr" value={data.floorMax} onChange={e => set('floorMax', e.target.value)} className={inputCls} placeholder="10" />
                    </Field>
                  </div>

                  <Field label="קומה אחרונה?">
                    <Choices
                      value={data.topFloorPreference}
                      onChange={v => set('topFloorPreference', v as TopFloorPref)}
                      options={[
                        { value: 'any', label: 'לא משנה' },
                        { value: 'yes', label: 'אדרבה' },
                        { value: 'no', label: 'מעדיף שלא' },
                      ]}
                    />
                  </Field>

                  <Field label="מצב הדירה">
                    <Choices
                      value={data.conditionPreference}
                      onChange={v => set('conditionPreference', v as Condition)}
                      options={[
                        { value: 'any', label: 'לא משנה' },
                        { value: 'renovated', label: 'משופצת' },
                        { value: 'good', label: 'במצב טוב' },
                        { value: 'needs-work', label: 'מקבל גם דורש שיפוץ' },
                      ]}
                    />
                  </Field>

                  <div className="flex gap-3">
                    <Field label="תאריך כניסה רצוי" className="flex-1">
                      <input type="date" value={data.moveInDate} onChange={e => set('moveInDate', e.target.value)} className={inputCls} />
                    </Field>
                  </div>

                  <YesNo label="גמישות בתאריך?" value={data.moveInFlexible} onChange={v => set('moveInFlexible', v)} />
                </div>
              </Card>
            </StepWrap>
          )}

          {/* ---------- Step 3: Household ---------- */}
          {step === 3 && (
            <StepWrap key="step-3">
              <Card title="מי גר בבית" subtitle="כדי שנדע מה מתאים לכם">
                <div className="space-y-5">
                  <Field label="הרכב משק הבית">
                    <Choices
                      value={data.householdType}
                      onChange={v => set('householdType', v as HouseholdType)}
                      options={[
                        { value: 'single', label: 'יחיד/ה' },
                        { value: 'couple', label: 'זוג' },
                        { value: 'family', label: 'משפחה' },
                        { value: 'roommates', label: 'שותפים' },
                        { value: 'students', label: 'סטודנטים' },
                        { value: 'other', label: 'אחר' },
                      ]}
                    />
                  </Field>

                  <Field label="מספר נפשות">
                    <input type="number" inputMode="numeric" min="1" dir="ltr" value={data.householdSize} onChange={e => set('householdSize', e.target.value)} className={inputCls} placeholder="2" />
                  </Field>

                  <YesNo
                    label="יש ילדים?"
                    value={data.hasChildren}
                    onChange={v => {
                      set('hasChildren', v)
                      if (!v) set('childrenCount', '')
                    }}
                  />

                  <AnimatePresence>
                    {data.hasChildren && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                        <Field label="כמה ילדים?">
                          <input type="number" inputMode="numeric" min="1" dir="ltr" value={data.childrenCount} onChange={e => set('childrenCount', e.target.value)} className={inputCls} placeholder="2" />
                        </Field>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <YesNo label="יש בעלי חיים?" value={data.hasPets} onChange={v => set('hasPets', v)} />
                  <YesNo label="עישון בדירה?" value={data.smokers} onChange={v => set('smokers', v)} />
                </div>
              </Card>
            </StepWrap>
          )}

          {/* ---------- Step 4: Property features (deal breakers + nice-to-have) ---------- */}
          {step === 4 && (
            <StepWrap key="step-4">
              <Card title="מה חשוב לך בדירה" subtitle="חובה = לא תוותר/י עליו. יתרון = יהיה כיף. לא משנה = לא רלוונטי.">
                <div className="space-y-4">
                  <RankedRow
                    label="חניה"
                    level={data.preferences.parking.level}
                    onLevel={l => setPref('parking', { ...data.preferences.parking, level: l })}
                    extra={
                      data.preferences.parking.level !== 'any' && (
                        <Choices
                          value={data.preferences.parking.type}
                          onChange={v => setPref('parking', { ...data.preferences.parking, type: v as ParkingType })}
                          options={[
                            { value: 'any', label: 'כל סוג' },
                            { value: 'private', label: 'פרטית' },
                            { value: 'shared', label: 'משותפת' },
                            { value: 'street', label: 'רחוב' },
                          ]}
                        />
                      )
                    }
                  />
                  <RankedRow label="מעלית" level={data.preferences.elevator.level} onLevel={l => setPref('elevator', { level: l })} />
                  <RankedRow
                    label="מרפסת"
                    level={data.preferences.balcony.level}
                    onLevel={l => setPref('balcony', { ...data.preferences.balcony, level: l })}
                    extra={
                      data.preferences.balcony.level === 'must' && (
                        <Field label="גודל מרפסת מינימלי (מ״ר)">
                          <input
                            type="number"
                            inputMode="numeric"
                            dir="ltr"
                            value={data.preferences.balcony.min_sqm ?? ''}
                            onChange={e => {
                              const n = parseInt(e.target.value, 10)
                              setPref('balcony', { ...data.preferences.balcony, min_sqm: Number.isFinite(n) ? n : null })
                            }}
                            className={inputCls}
                            placeholder="6"
                          />
                        </Field>
                      )
                    }
                  />
                  <RankedRow
                    label="מרוהט"
                    level={data.preferences.furnished.level}
                    onLevel={l => setPref('furnished', { ...data.preferences.furnished, level: l })}
                    extra={
                      data.preferences.furnished.level !== 'any' && (
                        <Choices
                          value={data.preferences.furnished.amount}
                          onChange={v => setPref('furnished', { ...data.preferences.furnished, amount: v as LevelAmount })}
                          options={[
                            { value: 'any', label: 'לא משנה' },
                            { value: 'partial', label: 'חלקי' },
                            { value: 'full', label: 'מלא' },
                          ]}
                        />
                      )
                    }
                  />
                  <RankedRow
                    label="מזגן"
                    level={data.preferences.aircon.level}
                    onLevel={l => setPref('aircon', { ...data.preferences.aircon, level: l })}
                    extra={
                      data.preferences.aircon.level !== 'any' && (
                        <Choices
                          value={data.preferences.aircon.amount}
                          onChange={v => setPref('aircon', { ...data.preferences.aircon, amount: v as LevelAmount })}
                          options={[
                            { value: 'any', label: 'לא משנה' },
                            { value: 'partial', label: 'חלקי' },
                            { value: 'full', label: 'מלא' },
                          ]}
                        />
                      )
                    }
                  />
                  <RankedRow label="ממ״ד" level={data.preferences.mamad.level} onLevel={l => setPref('mamad', { level: l })} />
                  <RankedRow
                    label="נגישות"
                    level={data.preferences.accessibility.level}
                    onLevel={l => setPref('accessibility', { ...data.preferences.accessibility, level: l })}
                    extra={
                      data.preferences.accessibility.level !== 'any' && (
                        <Choices
                          value={data.preferences.accessibility.type}
                          onChange={v => setPref('accessibility', { ...data.preferences.accessibility, type: v as AccessType })}
                          options={[
                            { value: 'any', label: 'כל סוג' },
                            { value: 'no-stairs', label: 'בלי מדרגות' },
                            { value: 'ramp', label: 'רמפה' },
                            { value: 'wide-door', label: 'דלת רחבה' },
                          ]}
                        />
                      )
                    }
                  />
                </div>
              </Card>

              <Card title="שיפורים שכיף שיהיו" subtitle="סמן/י כל מה שאת/ה אוהב/ת">
                <div className="grid grid-cols-2 gap-2.5">
                  {[
                    { key: 'storage' as const, label: 'מחסן' },
                    { key: 'solar_heater' as const, label: 'דוד שמש' },
                    { key: 'bars' as const, label: 'סורגים' },
                    { key: 'quiet' as const, label: 'שקט' },
                    { key: 'fiber_internet' as const, label: 'אינטרנט סיבים' },
                    { key: 'shelter' as const, label: 'מקלט בבניין' },
                  ].map(opt => {
                    const wanted = data.preferences[opt.key].wanted
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => setPref(opt.key, { wanted: !wanted })}
                        className={`py-2.5 px-3 rounded-md border-2 text-sm font-medium transition-all ${
                          wanted
                            ? 'border-brand-primary bg-brand-primarySoft text-brand-primary'
                            : 'border-brand-border bg-brand-surfaceMuted text-brand-inkMuted hover:border-brand-borderStrong'
                        }`}
                      >
                        {wanted ? '✓ ' : ''}
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
              </Card>
            </StepWrap>
          )}

          {/* ---------- Step 5: Employment & notes ---------- */}
          {step === 5 && (
            <StepWrap key="step-5">
              <Card title="תעסוקה וביטחונות" subtitle="עוזר לבעלי הנכסים לדעת שאת/ה שוכר/ת אמין/ה">
                <div className="space-y-5">
                  <Field label="סטטוס תעסוקה">
                    <Choices
                      value={data.employmentStatus}
                      onChange={v => set('employmentStatus', v as EmploymentStatus)}
                      options={[
                        { value: 'employed', label: 'שכיר/ה' },
                        { value: 'self_employed', label: 'עצמאי/ת' },
                        { value: 'student', label: 'סטודנט/ית' },
                        { value: 'other', label: 'אחר' },
                      ]}
                    />
                  </Field>

                  <Field label="מקום עבודה / מוסד לימודים (לא חובה)">
                    <input type="text" value={data.employer} onChange={e => set('employer', e.target.value)} className={inputCls} placeholder="לדוגמה: חברת XYZ" />
                  </Field>

                  <YesNo label="יש תלושי שכר של 3 חודשים אחרונים?" value={data.hasPayslips} onChange={v => set('hasPayslips', v)} />
                  <YesNo label="יכול/ה לתת צ׳קים לביטחון?" value={data.hasSecurityChecks} onChange={v => set('hasSecurityChecks', v)} />
                  <YesNo label="יש לך ערבים?" value={data.hasGuarantors} onChange={v => set('hasGuarantors', v)} />
                </div>
              </Card>

              <Card title="הערות חופשיות">
                <textarea
                  value={data.notes}
                  onChange={e => set('notes', e.target.value)}
                  className={`${inputCls} resize-none`}
                  rows={4}
                  placeholder="כל מה שחשוב לך שנדע..."
                />
              </Card>
            </StepWrap>
          )}
        </AnimatePresence>

        {submitError && (
          <div className="bg-brand-errorSoft border border-brand-error/30 rounded-md px-4 py-3 mb-4 text-center">
            <p className="text-sm text-brand-error">{submitError}</p>
          </div>
        )}

        <div className="flex gap-3 mt-6">
          {step > 0 && (
            <button onClick={handleBack} className="flex-1 py-3.5 px-6 border border-brand-border text-brand-ink font-medium rounded-md hover:bg-brand-surfaceMuted transition-colors">
              חזרה
            </button>
          )}
          {step < totalSteps - 1 ? (
            <button onClick={handleNext} disabled={!canProceed()} className="flex-1 py-3.5 px-6 bg-brand-primary text-white font-semibold rounded-md hover:bg-brand-primaryHover transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              המשך
            </button>
          ) : (
            <button onClick={handleSubmit} disabled={!canProceed() || submitting} className="flex-1 py-3.5 px-6 bg-brand-primary text-white font-semibold rounded-md hover:bg-brand-primaryHover transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
              {submitting ? (<><Spinner /> שולח...</>) : 'סיום ושליחה'}
            </button>
          )}
        </div>
      </div>
    </main>
  )
}

// =============================================================
// Building blocks
// =============================================================

const inputCls = 'w-full px-4 py-3 bg-brand-surfaceMuted border border-brand-border rounded-md text-brand-ink placeholder:text-brand-inkSoft'

function StepWrap({ children }: { children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }} transition={{ duration: 0.25 }}>
      {children}
    </motion.div>
  )
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-brand-surface border border-brand-border rounded-2xl shadow-soft p-6 mb-5">
      <h2 className="text-lg font-bold text-brand-ink mb-1">{title}</h2>
      {subtitle && <p className="text-sm text-brand-inkMuted mb-5">{subtitle}</p>}
      {children}
    </div>
  )
}

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="block text-sm font-medium text-brand-ink mb-1.5">{label}</label>
      {children}
    </div>
  )
}

function YesNo({ label, value, onChange }: { label: string; value: boolean | null; onChange: (v: boolean) => void }) {
  return (
    <div>
      <p className="text-brand-ink font-medium mb-2.5">{label}</p>
      <div className="flex gap-3">
        <ChoiceButton active={value === true} tone="success" onClick={() => onChange(true)} className="flex-1">כן</ChoiceButton>
        <ChoiceButton active={value === false} tone="error" onClick={() => onChange(false)} className="flex-1">לא</ChoiceButton>
      </div>
    </div>
  )
}

function ChoiceButton({
  active,
  tone,
  children,
  onClick,
  className = '',
}: {
  active: boolean
  tone: 'success' | 'error' | 'primary'
  children: React.ReactNode
  onClick: () => void
  className?: string
}) {
  let cls = 'border-brand-border text-brand-inkMuted hover:border-brand-borderStrong bg-brand-surfaceMuted'
  if (active) {
    if (tone === 'success') cls = 'border-brand-success bg-brand-successSoft text-brand-success'
    else if (tone === 'error') cls = 'border-brand-error bg-brand-errorSoft text-brand-error'
    else cls = 'border-brand-primary bg-brand-primarySoft text-brand-primary'
  }
  return (
    <button type="button" onClick={onClick} className={`py-3 px-4 rounded-md border-2 font-medium transition-all ${cls} ${className}`}>
      {children}
    </button>
  )
}

function Choices<T extends string>({ value, onChange, options }: { value: T | ''; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
      {options.map(opt => (
        <ChoiceButton key={opt.value} active={value === opt.value} tone="primary" onClick={() => onChange(opt.value)}>
          {opt.label}
        </ChoiceButton>
      ))}
    </div>
  )
}

function RankedRow({
  label,
  level,
  onLevel,
  extra,
}: {
  label: string
  level: PrefLevel
  onLevel: (l: PrefLevel) => void
  extra?: React.ReactNode
}) {
  const options: { value: PrefLevel; label: string; tone: 'success' | 'primary' | 'border' }[] = [
    { value: 'must', label: 'חובה', tone: 'success' },
    { value: 'nice', label: 'יתרון', tone: 'primary' },
    { value: 'any', label: 'לא משנה', tone: 'border' },
  ]
  return (
    <div className="border border-brand-border rounded-lg p-3.5 bg-brand-surfaceMuted/40">
      <div className="flex items-center justify-between gap-3 mb-2">
        <span className="text-brand-ink font-medium">{label}</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {options.map(opt => {
          const active = level === opt.value
          let cls = 'border-brand-border text-brand-inkMuted bg-brand-surface hover:border-brand-borderStrong'
          if (active && opt.tone === 'success') cls = 'border-brand-success bg-brand-successSoft text-brand-success'
          else if (active && opt.tone === 'primary') cls = 'border-brand-primary bg-brand-primarySoft text-brand-primary'
          else if (active && opt.tone === 'border') cls = 'border-brand-inkMuted bg-brand-bgAlt text-brand-ink'
          return (
            <button key={opt.value} type="button" onClick={() => onLevel(opt.value)} className={`py-2 px-3 rounded-md border-2 text-sm font-medium transition-all ${cls}`}>
              {opt.label}
            </button>
          )
        })}
      </div>
      {extra && <div className="mt-3">{extra}</div>}
    </div>
  )
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-1.5 h-1.5 rounded-full bg-brand-primary" />
      <span className="text-sm text-brand-ink">{children}</span>
    </div>
  )
}

function CenterMessage({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-dvh flex items-center justify-center p-4">
      <div className="text-brand-inkMuted text-center">{children}</div>
    </main>
  )
}

function EmojiPanel({ emoji, title, body }: { emoji: string; title: string; body: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="bg-brand-surface border border-brand-border rounded-2xl shadow-card p-8 max-w-md w-full text-center">
      <div className="text-5xl mb-4">{emoji}</div>
      <h2 className="text-xl font-bold text-brand-ink mb-2">{title}</h2>
      <p className="text-brand-inkMuted leading-relaxed">{body}</p>
    </motion.div>
  )
}

function Spinner() {
  return (
    <svg className="inline-block animate-spin h-5 w-5 -mt-0.5" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

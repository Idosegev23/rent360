'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  ArrowRight, Phone, Mail, User, Home, MapPin, Calendar, Users, Loader2, AlertCircle,
  CreditCard, FileCheck, RefreshCw, ExternalLink, ChevronDown, ChevronUp, AlertTriangle,
  Send, Check,
} from 'lucide-react'
import MarkRented from '../../../components/MarkRented'
import { ActivityTimeline } from '@/components/activity/ActivityTimeline'
import { AddTaskButton } from '@/components/tasks/AddTaskButton'
import { RelatedItems } from '@/components/RelatedItems'
import DocumentsPanel from '@/components/DocumentsPanel'
import NotesBanner from '@/components/NotesBanner'
import ScheduleMeetingButton from '@/components/ScheduleMeetingButton'

type Renter = Record<string, any>
type MatchProperty = {
  id: string
  title: string | null
  city: string | null
  street: string | null
  address: string | null
  price: number | null
  rooms: number | null
  sqm: number | null
  floor: number | null
  images: string[] | null
  evacuation_date: string | null
}
type AmenityItem = { key: string; label: string; level: 'must' | 'nice'; has: boolean }
type BreakdownEntry = { weight: number; raw: number; weighted: number; note: string; applies?: boolean; items?: AmenityItem[] }
type Match = {
  id: string
  property_id: string
  score: number | null
  is_disqualified: boolean
  disqualifying_reasons: string[] | null
  breakdown: Record<string, BreakdownEntry> | null
  reasons: string[] | null
  status: string | null
  property: MatchProperty | null
  interested?: boolean
  renter_notified_at?: string | null
}

const DIM_LABEL: Record<string, string> = {
  budget: 'תקציב',
  city: 'עיר',
  neighborhood: 'שכונה',
  rooms: 'חדרים',
  amenities_must: 'אמצעים — חובה',
  amenities_nice: 'אמצעים — רצוי',
  amenities: 'אמצעים', // backwards-compat for old rows still in DB
  text_similarity: 'דמיון טקסטואלי',
  sqm: 'שטח',
  floor: 'קומה',
  timing: 'תזמון',
  demographic: 'דמוגרפיה',
}

// Order the breakdown rows so the most impactful dimensions appear first.
const DIM_ORDER = [
  'budget', 'city', 'neighborhood', 'rooms',
  'amenities_must', 'amenities_nice', 'amenities',
  'text_similarity',
  'sqm', 'floor', 'timing', 'demographic',
]

const PREF_LABEL: Record<string, string> = {
  balcony: 'מרפסת',
  parking: 'חניה',
  elevator: 'מעלית',
  aircon: 'מזגן',
  mamad: 'ממ״ד',
  storage: 'מחסן',
  furnished: 'ריהוט',
  accessibility: 'נגישות',
  solar_heater: 'דוד שמש',
  bars: 'סורגים',
  shelter: 'מקלט',
  fiber_internet: 'אינטרנט סיבים',
  quiet: 'שקט',
}
const LEVEL_LABEL: Record<string, string> = { must: 'חובה', nice: 'רצוי', any: 'לא משנה' }
const HOUSEHOLD_LABEL: Record<string, string> = {
  single: 'יחיד', couple: 'זוג', family: 'משפחה', roommates: 'שותפים', students: 'סטודנטים', other: 'אחר',
}
const EMPLOYMENT_LABEL: Record<string, string> = {
  employed: 'שכיר', self_employed: 'עצמאי', student: 'סטודנט', other: 'אחר',
}
const CONDITION_LABEL: Record<string, string> = {
  renovated: 'משופץ', good: 'טוב', 'needs-work': 'דורש שיפוץ', any: 'לא משנה',
}
const CONTRACT_LABEL: Record<string, string> = {
  '6': '6 חודשים', '12': 'שנה', flexible: 'גמיש',
}

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  try { return new Date(iso).toLocaleDateString('he-IL') } catch { return iso }
}

export default function RenterDetailPage({ params }: { params: { id: string } }) {
  const [renter, setRenter] = useState<Renter | null>(null)
  const [matches, setMatches] = useState<Match[]>([])
  const [lastSubmission, setLastSubmission] = useState<any | null>(null)
  const [sendCounts, setSendCounts] = useState<{ today: number; total: number }>({ today: 0, total: 0 })
  // Real per-day cap (env-overridable on the server) — drives the send-counter badge.
  const [perDayCap, setPerDayCap] = useState(3)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [recomputing, setRecomputing] = useState(false)
  const [sendingInvite, setSendingInvite] = useState(false)
  const [sendingTop, setSendingTop] = useState(false)
  const [showLowMatches, setShowLowMatches] = useState(false)
  const [activeTab, setActiveTab] = useState<'approved' | 'recruit'>('approved')

  async function load() {
    setLoading(true)
    try {
      const res = await fetch(`/api/v1/renters/${params.id}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error?.message || 'load failed')
      setRenter(data.renter)
      setMatches(data.matches || [])
      setLastSubmission(data.last_submission || null)
      setSendCounts(data.send_counts || { today: 0, total: 0 })
      if (typeof data.per_day_cap === 'number') setPerDayCap(data.per_day_cap)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'load failed')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [params.id]) // eslint-disable-line

  async function recompute() {
    if (recomputing) return
    setRecomputing(true)
    try {
      await fetch('/api/v1/matches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ renter_id: params.id }),
      })
      // Give the background a moment, then reload
      setTimeout(() => load(), 2500)
    } finally {
      setTimeout(() => setRecomputing(false), 2500)
    }
  }

  async function sendQuestionnaire() {
    if (sendingInvite) return
    setSendingInvite(true)
    try {
      const res = await fetch(`/api/v1/renters/${params.id}/invite`, { method: 'POST', headers: { 'Content-Type': 'application/json' } })
      const data = await res.json()
      if (res.ok && data.waUrl) {
        window.open(data.waUrl, '_blank')
      } else {
        alert(data?.error?.message || 'שליחת השאלון נכשלה')
      }
    } catch {
      alert('שליחת השאלון נכשלה')
    } finally {
      setSendingInvite(false)
    }
  }

  // Send the renter their top-5 matches (90%+) in one click. The server picks the eligible set
  // (not disqualified, not already sent to this renter, not offered to another renter).
  async function sendTop5() {
    if (sendingTop) return
    const eligible = matches.filter(m => !m.is_disqualified && (m.score || 0) >= 90 && !m.renter_notified_at)
    if (eligible.length === 0) { alert('אין התאמות 90%+ שטרם נשלחו.'); return }
    if (!window.confirm(`לשלוח לשוכר את ${Math.min(eligible.length, 5)} ההתאמות הכי טובות (90%+) בוואטסאפ?`)) return
    setSendingTop(true)
    try {
      const res = await fetch(`/api/v1/renters/${params.id}/send-top-matches`, { method: 'POST', headers: { 'Content-Type': 'application/json' } })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error?.message || 'שליחה נכשלה')
      const parts = [`נשלחו ${data.sent}`]
      if (data.skipped) parts.push(`דולגו ${data.skipped}`)
      if (data.skippedTaken) parts.push(`${data.skippedTaken} כבר נשלחו לשוכר אחר`)
      alert(parts.join(' · '))
      load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'שליחה נכשלה')
    } finally {
      setSendingTop(false)
    }
  }

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-brand-primary" /></div>
  if (error) return <div className="mx-auto max-w-3xl p-4"><div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"><AlertCircle className="inline h-4 w-4 ml-1" />{error}</div></div>
  if (!renter) return null

  const fullName = [renter.first_name, renter.last_name].filter(Boolean).join(' ')
  const cities = Array.isArray(renter.preferred_cities) ? renter.preferred_cities : []
  const neighborhoods = Array.isArray(renter.preferred_neighborhoods) ? renter.preferred_neighborhoods : []
  const vetting: string[] = []
  if (renter.has_payslips) vetting.push('תלושים')
  if (renter.has_security_checks) vetting.push('צ׳ק ביטחון')
  if (renter.has_guarantors) vetting.push('ערבים')

  const nonDqMatches = matches.filter(m => !m.is_disqualified)
  const dqMatches = matches.filter(m => m.is_disqualified)
  // Show strong matches (90%+) by default; weaker + disqualified hide behind an accordion.
  const strongMatches = nonDqMatches.filter(m => (m.score || 0) >= 90)
  const lowMatches = nonDqMatches.filter(m => (m.score || 0) < 90)
  const hiddenCount = lowMatches.length + dqMatches.length
  // Top matches eligible for the one-click send: 90%+, not yet sent to this renter.
  const topEligible = strongMatches.filter(m => !m.renter_notified_at).slice(0, 5)

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 pb-32">
      <Link href="/renters" className="inline-flex items-center gap-1 text-sm text-brand-primary hover:underline mb-4">
        <ArrowRight className="h-4 w-4" /> חזרה למאגר
      </Link>

      {/* Profile header */}
      <div className="rounded-lg border border-brand-border bg-white p-5 mb-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h1 className="text-2xl font-bold">{fullName || 'ללא שם'}</h1>
            <div className="flex items-center gap-4 text-sm text-gray-600 mt-1">
              <span className="inline-flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{renter.phone}</span>
              {renter.email && <span className="inline-flex items-center gap-1"><Mail className="h-3.5 w-3.5" />{renter.email}</span>}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              הצטרף {fmtDate(renter.created_at)} · {renter.submissions_count} שאלונים
            </div>
            <div className="mt-1.5">
              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                sendCounts.today >= perDayCap ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-600'
              }`}>
                נשלחו {sendCounts.today}/{perDayCap} היום · {sendCounts.total} סה״כ
              </span>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={recompute}
              disabled={recomputing}
              className="inline-flex items-center gap-1.5 rounded-md border border-brand-primary px-3 py-1.5 text-sm text-brand-primary hover:bg-brand-primary/5 disabled:opacity-60"
            >
              {recomputing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              חשב התאמות מחדש
            </button>
            <button
              type="button"
              onClick={sendQuestionnaire}
              disabled={sendingInvite}
              className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500 px-3 py-1.5 text-sm text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
              title="מייצר קישור שאלון מעודכן ופותח וואטסאפ לשליחה"
            >
              {sendingInvite ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              שלח שאלון מעודכן
            </button>
            <MarkRented mode="renter" id={params.id} />
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <Stat icon={<CreditCard className="h-4 w-4" />} label="תקציב" value={renter.budget_max ? `₪${renter.budget_min || '?'}-${renter.budget_max.toLocaleString('he-IL')}` : '—'} />
          <Stat icon={<Home className="h-4 w-4" />} label="חדרים" value={renter.preferred_rooms !== null ? `${renter.preferred_rooms}${renter.rooms_flexible ? ' (גמיש)' : ''}` : '—'} />
          <Stat icon={<Calendar className="h-4 w-4" />} label="כניסה" value={fmtDate(renter.move_in_date) || '—'} />
          <Stat icon={<Users className="h-4 w-4" />} label="משק בית" value={renter.household_size ? `${renter.household_size}${renter.has_children ? ` (${renter.children_count || ''} ילדים)` : ''}` : '—'} />
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {cities.map((c: string) => (
            <span key={c} className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
              <MapPin className="h-3 w-3" />{c}
            </span>
          ))}
          {neighborhoods.map((n: string) => (
            <span key={`nbh:${n}`} className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700" title="שכונה מועדפת">
              <MapPin className="h-3 w-3" />{n}
            </span>
          ))}
          {renter.has_pets && <span className="rounded-full bg-purple-50 px-2 py-0.5 text-xs text-purple-700">חיות מחמד</span>}
          {renter.smokers && <span className="rounded-full bg-orange-50 px-2 py-0.5 text-xs text-orange-700">מעשן</span>}
          {vetting.length > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700"><FileCheck className="h-3 w-3" />{vetting.join(', ')}</span>}
        </div>

        {renter.notes && (
          <div className="mt-3 text-sm bg-amber-50 border border-amber-200 rounded p-3">
            <div className="text-xs text-amber-700 font-medium mb-1">הערות מהשאלון</div>
            <div className="text-amber-900 whitespace-pre-wrap">{renter.notes}</div>
          </div>
        )}
      </div>

      {/* Team notes / extra info about the renter — beyond the questionnaire. */}
      <NotesBanner entityType="renter" entityId={params.id} />

      {/* Full questionnaire details */}
      <QuestionnaireDetails renter={renter} lastSubmission={lastSubmission} />

      {/* Tabs: approved matches vs recruitment candidates */}
      <div className="mb-3 flex gap-1 border-b border-gray-200">
        <button type="button" onClick={() => setActiveTab('approved')}
          className={`px-3 py-2 text-sm font-medium -mb-px border-b-2 ${activeTab === 'approved' ? 'border-brand-primary text-brand-primary' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
          התאמות מאושרות
        </button>
        <button type="button" onClick={() => setActiveTab('recruit')}
          className={`px-3 py-2 text-sm font-medium -mb-px border-b-2 ${activeTab === 'recruit' ? 'border-brand-primary text-brand-primary' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
          נכסים לגיוס
        </button>
      </div>

      {activeTab === 'recruit' && <RecruitTab renterId={params.id} />}

      {activeTab === 'approved' && (<>
      {/* Matches */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-lg">התאמות מובילות ({strongMatches.length} ב-90%+{topEligible.length < strongMatches.length ? `, ${strongMatches.length - topEligible.length} כבר נשלחו` : ''})</h2>
        {topEligible.length > 0 && (
          <button
            onClick={sendTop5}
            disabled={sendingTop}
            title="שולח בלחיצה אחת את ההתאמות הכי טובות (90%+) שטרם נשלחו"
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {sendingTop ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            שלח {topEligible.length} התאמות מובילות (90%+)
          </button>
        )}
      </div>

      {matches.length === 0 && (
        <div className="text-center py-12 text-gray-500 rounded-lg border border-dashed border-gray-300 bg-white">
          <Home className="mx-auto h-10 w-10 mb-2 text-gray-300" />
          <p>אין עדיין התאמות. לחץ &quot;חשב התאמות מחדש&quot;.</p>
        </div>
      )}

      {matches.length > 0 && strongMatches.length === 0 && (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-4 text-center text-sm text-gray-500 mb-2">
          אין התאמות מעל 90%. אפשר לפתוח את ההתאמות הנמוכות יותר למטה.
        </div>
      )}

      <div className="grid grid-cols-1 gap-2">
        {strongMatches.map(m => <MatchRow key={m.id} match={m} renterId={params.id} onSent={load} />)}
      </div>

      {hiddenCount > 0 && (
        <div className="mt-3">
          <button
            onClick={() => setShowLowMatches(s => !s)}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-600 hover:bg-gray-50"
          >
            {showLowMatches ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            {showLowMatches
              ? 'הסתר התאמות נמוכות יותר'
              : `הצג ${hiddenCount} התאמות נוספות${lowMatches.length ? ` (מתחת ל-90%)` : ''}${dqMatches.length ? ` + ${dqMatches.length} פסולות` : ''}`}
          </button>
          {showLowMatches && (
            <div className="grid grid-cols-1 gap-2 mt-2">
              {[...lowMatches, ...dqMatches].map(m => <MatchRow key={m.id} match={m} renterId={params.id} onSent={load} />)}
            </div>
          )}
        </div>
      )}
      </>)}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <ScheduleMeetingButton renterId={params.id} label="קבע פגישה עם השוכר" />
        <AddTaskButton entityType="renter" entityId={params.id} />
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2 items-start">
        <RelatedItems entityType="renter" entityId={params.id} />
        <DocumentsPanel entityType="renter" entityId={params.id} />
        <ActivityTimeline entityType="renter" entityId={params.id} />
      </div>
    </div>
  )
}

// ---------- Recruitment tab: unapproved properties ≥90% not yet recruited ----------
function RecruitTab({ renterId }: { renterId: string }) {
  const [items, setItems] = useState<any[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [sent, setSent] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    fetch(`/api/v1/renters/${renterId}/recruit-matches`)
      .then(r => r.json())
      .then(d => { if (cancelled) return; if (d.error) setError(d.error.message || d.error.code); else setItems(d.matches || []) })
      .catch(e => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [renterId])

  async function send(propertyId: string) {
    if (busy) return
    if (!window.confirm('לשלוח הודעת גיוס לבעל הנכס? (ההודעה מזכירה שיש שוכר מתאים, בלי פרטים מזהים)')) return
    setBusy(propertyId)
    try {
      const res = await fetch(`/api/v1/renters/${renterId}/recruit-send`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ propertyId }),
      })
      const d = await res.json()
      if (d.ok) setSent(s => new Set(s).add(propertyId))
      else alert(d.error?.message || 'השליחה נכשלה')
    } catch { alert('השליחה נכשלה') } finally { setBusy(null) }
  }

  if (error) return <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
  if (items === null) return <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
  if (items.length === 0) return (
    <div className="text-center py-12 text-gray-500 rounded-lg border border-dashed border-gray-300 bg-white">
      <Home className="mx-auto h-10 w-10 mb-2 text-gray-300" />
      <p>אין נכסים לא-מאושרים בהתאמה 90%+ שטרם גויסו.</p>
    </div>
  )
  return (
    <div className="grid grid-cols-1 gap-2">
      <p className="text-xs text-gray-500 mb-1">נכסים שעדיין לא במערכת ומתאימים לשוכר (90%+). שלח הודעת גיוס לבעל הנכס ישירות מכאן.</p>
      {items.map(it => {
        const done = sent.has(it.property_id)
        return (
          <div key={it.property_id} className="rounded-lg border border-gray-200 bg-white p-3 flex items-center gap-3">
            {it.image && <img src={it.image} alt="" className="h-14 w-14 rounded object-cover shrink-0" />}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">{it.percentage}%</span>
                <span className="font-medium text-gray-900 truncate">{[it.neighborhood, it.city].filter(Boolean).join(' · ') || it.city || 'נכס'}</span>
              </div>
              <div className="text-sm text-gray-500 mt-0.5 truncate">
                {[it.rooms ? `${String(it.rooms).replace(/\.0$/, '')} חד׳` : null, it.sqm ? `${it.sqm} מ״ר` : null, it.price ? `₪${Number(it.price).toLocaleString('he-IL')}` : null].filter(Boolean).join(' · ')}
                {it.contact_name ? ` · ${it.contact_name}` : ''}
              </div>
            </div>
            {done ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-3 py-1.5 text-sm text-gray-500 shrink-0"><Check className="h-4 w-4" />נשלח</span>
            ) : (
              <button type="button" onClick={() => send(it.property_id)} disabled={busy === it.property_id}
                className="inline-flex items-center gap-1.5 rounded-md bg-brand-primary px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60 shrink-0">
                {busy === it.property_id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                שלח הודעת גיוס
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-md bg-gray-50 p-3">
      <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">{icon}{label}</div>
      <div className="font-medium text-gray-900">{value}</div>
    </div>
  )
}

function MatchRow({ match, renterId, onSent }: { match: Match; renterId: string; onSent?: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [vOpen, setVOpen] = useState(false)
  const [vWhen, setVWhen] = useState('')
  const [vBusy, setVBusy] = useState(false)
  const [vDone, setVDone] = useState(false)
  const p = match.property
  if (!p) return null

  // Schedule a VIEWING (property × renter) — a meeting with kind=viewing that shows on /meetings,
  // reminds the staff owner, and prompts post-viewing feedback.
  async function scheduleViewing() {
    if (vBusy || !vWhen) return
    setVBusy(true)
    try {
      const start = new Date(vWhen)
      const end = new Date(start.getTime() + 30 * 60000)
      const res = await fetch('/api/v1/meetings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: `צפייה — ${p!.title || p!.street || p!.address || 'נכס'}`, kind: 'viewing', property_id: p!.id, renter_id: renterId, starts_at: start.toISOString(), ends_at: end.toISOString() }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d?.error?.message || 'נכשל')
      setVDone(true); setVOpen(false)
    } catch (e) { window.alert(e instanceof Error ? e.message : 'תיאום הצפייה נכשל') } finally { setVBusy(false) }
  }

  // Send THIS apartment to the renter (manual, one-click). The server enforces opt-out,
  // dedup (renter_notified_at), template approval, and warns (409 CAP_WARNING) when the
  // renter is already at the per-day cap — we then confirm and re-send with confirmOverCap.
  async function sendApartment() {
    if (sending || sent) return
    if (!window.confirm('לשלוח לשוכר את הדירה הזו בוואטסאפ?')) return
    setSending(true)
    try {
      const post = (confirmOverCap: boolean) => fetch('/api/v1/outreach/notify-renter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matchId: match.id, ...(confirmOverCap ? { confirmOverCap: true } : {}) }),
      })
      let res = await post(false)
      let data = await res.json()
      if (res.status === 409 && data?.error?.code === 'CAP_WARNING') {
        const sentToday = data.error.sentToday ?? 0
        if (!window.confirm(`כבר נשלחו ${sentToday} התאמות לשוכר היום — לשלוח בכל זאת?`)) {
          setSending(false)
          return
        }
        res = await post(true)
        data = await res.json()
      }
      if (!res.ok) throw new Error(data?.error?.message || 'שליחה נכשלה')
      setSent(true)
      onSent?.()
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'שליחה נכשלה')
    } finally {
      setSending(false)
    }
  }

  const score = Math.round(match.score || 0)
  const alreadySent = sent || !!match.renter_notified_at
  const scoreTone =
    match.is_disqualified ? 'bg-red-100 text-red-700 border-red-200' :
    score >= 80 ? 'bg-emerald-100 text-emerald-700 border-emerald-200' :
    score >= 60 ? 'bg-yellow-100 text-yellow-800 border-yellow-200' :
    'bg-gray-100 text-gray-700 border-gray-200'

  return (
    <div className={`rounded-lg border bg-white ${match.is_disqualified ? 'opacity-70' : ''}`}>
      <div className="p-3 flex items-start gap-3">
        {p.images && p.images.length > 0 && (
          <img src={p.images[0]} alt="" className="h-16 w-16 rounded object-cover shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <Link href={`/properties/${p.id}`} className="font-semibold text-brand-primary hover:underline truncate">
              {p.title || p.street || p.address || 'נכס'}
            </Link>
            <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium ${scoreTone}`}>
              {match.is_disqualified ? <><AlertTriangle className="h-3 w-3" /> פסול</> : `${score}/100`}
            </span>
            {match.interested && (
              <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2 py-0.5 text-xs font-bold text-white animate-pulse">
                ✋ מעוניין/ת לראות!
              </span>
            )}
            {alreadySent && (
              <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                <Check className="h-3 w-3" /> נשלח לשוכר
              </span>
            )}
          </div>
          <div className="text-xs text-gray-500 mb-1">
            {[p.street || p.address, p.city].filter(Boolean).join(', ')}
          </div>
          <div className="flex flex-wrap gap-1 text-xs">
            {p.price && <span className="rounded bg-brand-primary/10 px-1.5 py-0.5 text-brand-primary">₪{p.price.toLocaleString('he-IL')}</span>}
            {p.rooms && <span className="rounded bg-gray-100 px-1.5 py-0.5">{p.rooms} חד׳</span>}
            {p.sqm && <span className="rounded bg-gray-100 px-1.5 py-0.5">{p.sqm} מ&quot;ר</span>}
            {p.floor !== null && <span className="rounded bg-gray-100 px-1.5 py-0.5">קומה {p.floor}</span>}
          </div>
        </div>
        {!match.is_disqualified && (
          <>
          <button
            type="button"
            onClick={sendApartment}
            disabled={sending || alreadySent}
            title="שלח לשוכר את הדירה הזו בוואטסאפ"
            className="shrink-0 inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : alreadySent ? <Check className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
            {alreadySent ? 'נשלח' : 'שלח לשוכר'}
          </button>
          {vDone ? (
            <span className="shrink-0 inline-flex items-center gap-1 text-xs text-blue-700"><Calendar className="h-3.5 w-3.5" /> צפייה נקבעה</span>
          ) : vOpen ? (
            <span className="shrink-0 inline-flex items-center gap-1">
              <input type="datetime-local" value={vWhen} onChange={e => setVWhen(e.target.value)} className="rounded-md border border-gray-300 px-1.5 py-1 text-xs" />
              <button onClick={scheduleViewing} disabled={!vWhen || vBusy} className="rounded-md bg-blue-600 px-2 py-1 text-xs text-white disabled:opacity-50">{vBusy ? '…' : 'קבע'}</button>
              <button onClick={() => setVOpen(false)} className="text-xs text-gray-400">ביטול</button>
            </span>
          ) : (
            <button type="button" onClick={() => setVOpen(true)} title="קבע צפייה לשוכר בנכס" className="shrink-0 inline-flex items-center gap-1 rounded-md border border-blue-200 px-2.5 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50">
              <Calendar className="h-3.5 w-3.5" /> קבע צפייה
            </button>
          )}
          </>
        )}
        <button onClick={() => setExpanded(s => !s)} className="shrink-0 text-gray-400 hover:text-gray-700">
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      {expanded && (
        <div className="px-3 pb-3 border-t border-gray-100">
          {match.is_disqualified && Array.isArray(match.disqualifying_reasons) && match.disqualifying_reasons.length > 0 && (
            <div className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">
              <div className="font-medium mb-1">סיבות לפסילה:</div>
              <ul className="list-disc pr-4 space-y-0.5">
                {match.disqualifying_reasons.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>
          )}
          {match.breakdown && (
            <div className="mt-2 space-y-1.5">
              <div className="text-xs font-medium text-gray-700 mb-1">פירוט ציון:</div>
              {Object.entries(match.breakdown)
                .sort(([a], [b]) => (DIM_ORDER.indexOf(a) === -1 ? 999 : DIM_ORDER.indexOf(a)) - (DIM_ORDER.indexOf(b) === -1 ? 999 : DIM_ORDER.indexOf(b)))
                .map(([dim, d]) => (
                  <BreakdownDimensionRow key={dim} dim={dim} d={d} />
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// One row in the breakdown. Status pill (קיים/חלקי/חסר/לא ביקש) + note.
// Amenity dimensions (must/nice/legacy) also render per-item rows beneath.
function BreakdownDimensionRow({ dim, d }: { dim: string; d: BreakdownEntry }) {
  const status = statusForDimension(d)
  const isAmenityDim = (dim === 'amenities_must' || dim === 'amenities_nice' || dim === 'amenities')
                       && Array.isArray(d.items) && d.items.length > 0
  const dimmed = d.applies === false

  return (
    <div className={`text-xs ${dimmed ? 'opacity-60' : ''}`}>
      <div className="flex items-center gap-2">
        <span className="w-24 text-gray-500">{DIM_LABEL[dim] || dim}</span>
        <StatusBadge tone={status.tone} label={status.label} />
        <span className="flex-1 text-gray-500 truncate">{d.note}</span>
      </div>
      {isAmenityDim && d.items && (
        <div className="mt-1.5 mr-[104px] space-y-1">
          {d.items.map(item => (
            <div key={item.key} className="flex items-center gap-2 text-[11px]">
              <span className="w-20 text-gray-600">{item.label}</span>
              <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${
                item.level === 'must' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-blue-50 text-blue-700 border border-blue-200'
              }`}>
                {item.level === 'must' ? 'חובה' : 'רצוי'}
              </span>
              <StatusBadge tone={item.has ? 'green' : (item.level === 'must' ? 'red' : 'amber')} label={item.has ? 'קיים' : 'חסר'} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function StatusBadge({ tone, label }: { tone: 'green' | 'amber' | 'red' | 'gray'; label: string }) {
  const cls = tone === 'green' ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
            : tone === 'amber' ? 'bg-amber-100 text-amber-700 border-amber-200'
            : tone === 'red'   ? 'bg-red-100 text-red-700 border-red-200'
                               : 'bg-gray-100 text-gray-600 border-gray-200'
  return (
    <span className={`shrink-0 inline-flex items-center justify-center w-16 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${cls}`}>
      {label}
    </span>
  )
}

// Decide קיים / חסר / חלקי / לא ביקש per dimension.
//   - applies=false (engine signals the renter didn't fill it in, or no
//     comparable data on the property) → "לא ביקש".
//   - Otherwise pivot on raw.
// We also keep the note-based neutral detection as a fallback for older
// breakdowns that pre-date the `applies` field.
function statusForDimension(d: BreakdownEntry): { label: string; tone: 'green' | 'amber' | 'red' | 'gray' } {
  if (d.applies === false) return { label: 'לא ביקש', tone: 'gray' }
  const note = d.note || ''
  const isNeutral =
    /^(אין |אין$|לא הוגדר|לא ביקש|לא ידוע)/.test(note) ||
    note.includes('לא חסום') ||
    note.includes('בעיה בקריאת') ||
    note.includes('חסר תאריך')
  if (isNeutral) return { label: 'לא ביקש', tone: 'gray' }
  if (d.raw >= 0.7) return { label: 'קיים', tone: 'green' }
  if (d.raw >= 0.4) return { label: 'חלקי', tone: 'amber' }
  return { label: 'חסר', tone: 'red' }
}

// ---------- Full questionnaire details -----------------------------------

function QuestionnaireDetails({ renter, lastSubmission }: { renter: Renter; lastSubmission: any | null }) {
  const [showRaw, setShowRaw] = useState(false)
  const prefs: Record<string, any> = (renter.preferences && typeof renter.preferences === 'object') ? renter.preferences : {}

  // Pull every ranked preference (must / nice / wanted)
  const ranked: Array<{ key: string; level: string; extra: string | undefined }> = []
  for (const k of Object.keys(PREF_LABEL)) {
    const p = prefs[k]
    if (!p || typeof p !== 'object') continue
    const level = p.level ?? (p.wanted === true ? 'nice' : 'any')
    if (level === 'any') continue
    let extra: string | undefined
    if (k === 'balcony' && p.min_sqm) extra = `מינ' ${p.min_sqm} מ״ר`
    if (k === 'parking' && p.type && p.type !== 'any') extra = p.type === 'private' ? 'פרטית' : p.type === 'shared' ? 'משותפת' : 'רחוב'
    if ((k === 'furnished' || k === 'aircon') && p.amount && p.amount !== 'any') {
      extra = p.amount === 'full' ? 'מלא' : p.amount === 'partial' ? 'חלקי' : 'ללא'
    }
    if (k === 'accessibility' && p.type && p.type !== 'any') {
      extra = p.type === 'no-stairs' ? 'ללא מדרגות' : p.type === 'ramp' ? 'רמפה' : 'דלת רחבה'
    }
    ranked.push({ key: k, level, extra })
  }

  const financeRaw: Array<[string, string | null]> = [
    ['ועד בית מקס׳', renter.vaad_bayit_max ? `₪${Number(renter.vaad_bayit_max).toLocaleString('he-IL')}` : null],
    ['ארנונה מקס׳', renter.arnona_max ? `₪${Number(renter.arnona_max).toLocaleString('he-IL')}` : null],
    ['חוזה', renter.contract_length ? (CONTRACT_LABEL[renter.contract_length] || renter.contract_length) : null],
    ['גמישות תקציב', renter.budget_flexibility ? `+${renter.budget_flexibility}%` : null],
  ]
  const finance = financeRaw.filter((kv): kv is [string, string] => kv[1] !== null)

  const housingRaw: Array<[string, string | null]> = [
    ['שטח מינ׳', renter.min_sqm ? `${renter.min_sqm} מ״ר` : null],
    ['קומה', (renter.floor_min != null || renter.floor_max != null) ? `${renter.floor_min ?? ''}–${renter.floor_max ?? ''}` : null],
    ['קומה עליונה', renter.top_floor_preference && renter.top_floor_preference !== 'any' ? (renter.top_floor_preference === 'yes' ? 'כן' : 'לא') : null],
    ['מצב הנכס', renter.condition_preference && renter.condition_preference !== 'any' ? (CONDITION_LABEL[renter.condition_preference] || renter.condition_preference) : null],
    ['גמישות בחדרים', renter.rooms_flexible ? 'כן' : null],
    ['גמישות בכניסה', renter.move_in_flexible ? 'כן' : null],
  ]
  const housing = housingRaw.filter((kv): kv is [string, string] => kv[1] !== null)

  const profileRaw: Array<[string, string | null]> = [
    ['סוג משק בית', renter.household_type ? (HOUSEHOLD_LABEL[renter.household_type] || renter.household_type) : null],
    ['ילדים', renter.has_children ? (renter.children_count ? `${renter.children_count}` : 'כן') : null],
    ['חיות מחמד', renter.has_pets ? 'כן' : null],
    ['מעשנים', renter.smokers ? 'כן' : null],
    ['תעסוקה', renter.employment_status ? (EMPLOYMENT_LABEL[renter.employment_status] || renter.employment_status) : null],
    ['מעסיק', renter.employer || null],
    ['תלושים', renter.has_payslips ? 'יש' : null],
    ['צ׳ק ביטחון', renter.has_security_checks ? 'יש' : null],
    ['ערבים', renter.has_guarantors ? 'יש' : null],
  ]
  const profile = profileRaw.filter((kv): kv is [string, string] => kv[1] !== null)

  const hasAny = ranked.length > 0 || finance.length > 0 || housing.length > 0 || profile.length > 0

  return (
    <div className="rounded-lg border border-brand-border bg-white p-5 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-lg">פרטי השאלון המלאים</h2>
        {lastSubmission?.submitted_at && (
          <span className="text-xs text-gray-500">הוגש {fmtDate(lastSubmission.submitted_at)}</span>
        )}
      </div>

      {!hasAny && (
        <div className="text-sm text-gray-500">אין פרטים נוספים בשאלון מעבר לחלק שמעלה.</div>
      )}

      {ranked.length > 0 && (
        <div className="mb-4">
          <div className="text-xs font-medium text-gray-700 mb-2">אמצעים שביקש/ה</div>
          <div className="flex flex-wrap gap-1.5">
            {ranked.map(r => (
              <span
                key={r.key}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
                  r.level === 'must'
                    ? 'bg-red-50 border border-red-200 text-red-800'
                    : 'bg-blue-50 border border-blue-200 text-blue-800'
                }`}
                title={LEVEL_LABEL[r.level]}
              >
                {r.level === 'must' && <AlertTriangle className="h-3 w-3" />}
                {PREF_LABEL[r.key] || r.key}
                <span className="text-[10px] opacity-70">· {LEVEL_LABEL[r.level]}</span>
                {r.extra && <span className="text-[10px] opacity-70">· {r.extra}</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="grid sm:grid-cols-3 gap-4">
        {housing.length > 0 && <DetailBlock title="דירה" items={housing} />}
        {finance.length > 0 && <DetailBlock title="כספים" items={finance} />}
        {profile.length > 0 && <DetailBlock title="פרופיל" items={profile} />}
      </div>

      {lastSubmission?.snapshot && (
        <div className="mt-4 pt-3 border-t border-gray-200">
          <button
            type="button"
            onClick={() => setShowRaw(s => !s)}
            className="text-xs text-gray-500 hover:text-gray-700 inline-flex items-center gap-1"
          >
            {showRaw ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            תשובה גולמית
          </button>
          {showRaw && (
            <pre className="mt-2 max-h-96 overflow-auto rounded bg-gray-50 p-3 text-[11px] leading-relaxed text-gray-700 whitespace-pre-wrap" dir="ltr">
              {JSON.stringify(lastSubmission.snapshot, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

function DetailBlock({ title, items }: { title: string; items: Array<[string, string]> }) {
  return (
    <div>
      <div className="text-xs font-medium text-gray-700 mb-2">{title}</div>
      <dl className="space-y-1.5">
        {items.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-3 text-sm">
            <dt className="text-gray-500">{k}</dt>
            <dd className="text-gray-900 font-medium text-end">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

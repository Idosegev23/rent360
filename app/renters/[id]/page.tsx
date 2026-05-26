'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  ArrowRight, Phone, Mail, User, Home, MapPin, Calendar, Users, Loader2, AlertCircle,
  CreditCard, FileCheck, RefreshCw, ExternalLink, ChevronDown, ChevronUp, AlertTriangle,
} from 'lucide-react'

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
type Match = {
  id: string
  property_id: string
  score: number | null
  is_disqualified: boolean
  disqualifying_reasons: string[] | null
  breakdown: Record<string, { weight: number; raw: number; weighted: number; note: string }> | null
  reasons: string[] | null
  status: string | null
  property: MatchProperty | null
}

const DIM_LABEL: Record<string, string> = {
  budget: 'תקציב',
  city: 'עיר',
  rooms: 'חדרים',
  sqm: 'שטח',
  floor: 'קומה',
  timing: 'תזמון',
  demographic: 'דמוגרפיה',
}

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  try { return new Date(iso).toLocaleDateString('he-IL') } catch { return iso }
}

export default function RenterDetailPage({ params }: { params: { id: string } }) {
  const [renter, setRenter] = useState<Renter | null>(null)
  const [matches, setMatches] = useState<Match[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [recomputing, setRecomputing] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch(`/api/v1/renters/${params.id}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error?.message || 'load failed')
      setRenter(data.renter)
      setMatches(data.matches || [])
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

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-brand-primary" /></div>
  if (error) return <div className="mx-auto max-w-3xl p-4"><div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"><AlertCircle className="inline h-4 w-4 ml-1" />{error}</div></div>
  if (!renter) return null

  const fullName = [renter.first_name, renter.last_name].filter(Boolean).join(' ')
  const cities = Array.isArray(renter.preferred_cities) ? renter.preferred_cities : []
  const vetting: string[] = []
  if (renter.has_payslips) vetting.push('תלושים')
  if (renter.has_security_checks) vetting.push('צ׳ק ביטחון')
  if (renter.has_guarantors) vetting.push('ערבים')

  const nonDqMatches = matches.filter(m => !m.is_disqualified)
  const dqMatches = matches.filter(m => m.is_disqualified)

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
          </div>
          <button
            type="button"
            onClick={recompute}
            disabled={recomputing}
            className="inline-flex items-center gap-1.5 rounded-md border border-brand-primary px-3 py-1.5 text-sm text-brand-primary hover:bg-brand-primary/5 disabled:opacity-60"
          >
            {recomputing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            חשב התאמות מחדש
          </button>
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
          {renter.has_pets && <span className="rounded-full bg-purple-50 px-2 py-0.5 text-xs text-purple-700">חיות מחמד</span>}
          {renter.smokers && <span className="rounded-full bg-orange-50 px-2 py-0.5 text-xs text-orange-700">מעשן</span>}
          {vetting.length > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700"><FileCheck className="h-3 w-3" />{vetting.join(', ')}</span>}
        </div>

        {renter.notes && (
          <div className="mt-3 text-sm bg-amber-50 border border-amber-200 rounded p-3">
            <div className="text-xs text-amber-700 font-medium mb-1">הערות</div>
            <div className="text-amber-900 whitespace-pre-wrap">{renter.notes}</div>
          </div>
        )}
      </div>

      {/* Matches */}
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold text-lg">התאמות לנכסים ({nonDqMatches.length} מתאימים{dqMatches.length ? ` + ${dqMatches.length} פסולים` : ''})</h2>
      </div>

      {matches.length === 0 && (
        <div className="text-center py-12 text-gray-500 rounded-lg border border-dashed border-gray-300 bg-white">
          <Home className="mx-auto h-10 w-10 mb-2 text-gray-300" />
          <p>אין עדיין התאמות. לחץ &quot;חשב התאמות מחדש&quot;.</p>
        </div>
      )}

      <div className="grid gap-2">
        {[...nonDqMatches, ...dqMatches].map(m => <MatchRow key={m.id} match={m} />)}
      </div>
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

function MatchRow({ match }: { match: Match }) {
  const [expanded, setExpanded] = useState(false)
  const p = match.property
  if (!p) return null
  const score = Math.round(match.score || 0)
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
            <div className="mt-2 space-y-1">
              <div className="text-xs font-medium text-gray-700">פירוט ציון:</div>
              {Object.entries(match.breakdown).map(([dim, d]) => (
                <div key={dim} className="text-xs flex items-center gap-2">
                  <span className="w-20 text-gray-500">{DIM_LABEL[dim] || dim}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-1.5 overflow-hidden">
                    <div className="h-full bg-brand-primary rounded-full" style={{ width: `${Math.round(d.raw * 100)}%` }} />
                  </div>
                  <span className="w-12 text-left text-gray-600">{Math.round(d.raw * 100)}%</span>
                  <span className="flex-1 text-gray-500 truncate">{d.note}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

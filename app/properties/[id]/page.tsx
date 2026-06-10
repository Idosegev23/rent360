'use client';

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { type ExtendedProperty } from '../../../types/property'
import Link from 'next/link'
import { Calendar, MapPin, Phone, Clock, Info, ChevronLeft, ArrowRight, Share2, Target, AlertTriangle, ChevronDown, ChevronUp, Loader2, RefreshCw, User } from 'lucide-react'
import PropertyImageGallery from '../../../components/PropertyImageGallery'
import SharePropertyDialog from '../../../components/properties/SharePropertyDialog'
import MarkRented from '../../../components/MarkRented'
import ApproveBrokerage from '../../../components/ApproveBrokerage'
import SentMatchBadge from '../../../components/SentMatchBadge'
import { amenityLabel } from '../../../lib/data/amenity-labels'

type MatchRenter = {
  id: string
  first_name: string
  last_name: string | null
  phone: string
  budget_min: number | null
  budget_max: number | null
  preferred_rooms: number | null
  move_in_date: string | null
  has_pets: boolean | null
  smokers: boolean | null
  household_size: number | null
  has_payslips: boolean | null
  has_security_checks: boolean | null
  has_guarantors: boolean | null
}
type Match = {
  id: string
  renter_id: string
  score: number | null
  is_disqualified: boolean
  disqualifying_reasons: string[] | null
  breakdown: Record<string, { weight: number; raw: number; weighted: number; note: string }> | null
  reasons: string[] | null
  renter: MatchRenter | null
}
const DIM_LABEL: Record<string, string> = {
  budget: 'תקציב', city: 'עיר', rooms: 'חדרים', sqm: 'שטח', floor: 'קומה', timing: 'תזמון', demographic: 'דמוגרפיה',
}

// Editable boolean amenity flag (divided / garden) — PATCHes /api/v1/properties/[id].
function FlagToggle({ propertyId, amenity, label, initial }: { propertyId: string; amenity: 'divided' | 'garden'; label: string; initial: boolean }) {
  const [on, setOn] = useState(initial)
  const [saving, setSaving] = useState(false)
  async function toggle() {
    if (saving) return
    const next = !on
    setSaving(true)
    setOn(next)
    try {
      const r = await fetch(`/api/v1/properties/${propertyId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amenity, value: next }),
      })
      if (!r.ok) throw new Error()
    } catch {
      setOn(!next)
    } finally {
      setSaving(false)
    }
  }
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={saving}
      className={`px-4 py-2 rounded-lg border-2 text-sm font-medium transition-all disabled:opacity-60 ${
        on ? 'border-blue-500 bg-blue-50 text-blue-800' : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
      }`}
    >
      {on ? '✓ ' : ''}{label}
    </button>
  )
}

async function fetchProperty(id: string): Promise<ExtendedProperty | null> {
  try {
    const response = await fetch(`/api/v1/properties/${id}`)
    if (!response.ok) return null
    const data = await response.json()
  return data
  } catch (error) {
    console.error('Error fetching property:', error)
    return null
  }
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return 'מיידי';
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('he-IL');
  } catch {
    return dateStr;
  }
}

// Kept thin — defers to the shared amenity-labels module so we never have
// two different Hebrew dictionaries to keep in sync.
function getAmenitiesDisplay(amenities: any) {
  if (!amenities) return '—';
  const labels = Object.keys(amenities)
    .filter(k => amenities[k] && amenities[k] !== 'none')
    .map(amenityLabel);
  return labels.length > 0 ? labels.join(' · ') : '—';
}

export default function PropertyPage({ params }: { params: { id: string } }) {
  const [item, setItem] = useState<ExtendedProperty | null>(null)
  const [loading, setLoading] = useState(true)
  const [shareDialogOpen, setShareDialogOpen] = useState(false)
  const router = useRouter()

  useEffect(() => {
    const loadProperty = async () => {
      try {
        const property = await fetchProperty(params.id)
        setItem(property)
      } catch (error) {
        console.error('Error loading property:', error)
      } finally {
        setLoading(false)
      }
    }

    loadProperty()
  }, [params.id])

  if (loading) {
    return (
      <main className="pb-20 max-w-4xl mx-auto px-4">
        <div className="space-y-8 animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-3/4"></div>
          <div className="aspect-[16/10] bg-gray-200 rounded-xl"></div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-6">
              <div className="h-32 bg-gray-200 rounded-xl"></div>
              <div className="h-24 bg-gray-200 rounded-xl"></div>
            </div>
            <div className="space-y-6">
              <div className="h-24 bg-gray-200 rounded-xl"></div>
              <div className="h-16 bg-gray-200 rounded-xl"></div>
            </div>
          </div>
        </div>
      </main>
    )
  }
  
  if (!item) {
    return (
      <main className="pb-20 max-w-4xl mx-auto px-4">
        <h1 className="mb-4 text-2xl font-bold">נכס</h1>
        <div className="text-brand-inkMuted">נכס לא נמצא</div>
      </main>
    )
  }

  return (
    <main className="pb-20 space-y-8 max-w-4xl mx-auto px-4">
      {/* Back Button */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <ArrowRight className="h-5 w-5" />
          <span>חזרה לרשימת נכסים</span>
        </button>
      </div>

      {/* Header Section */}
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-3xl font-bold leading-tight text-gray-900">{item.title}</h1>
          <div className="flex items-start gap-2">
            <ApproveBrokerage propertyId={item.id} />
            <button
              onClick={() => setShareDialogOpen(true)}
              className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white font-medium rounded-lg transition-colors shadow-sm"
            >
              <Share2 className="h-4 w-4" />
              <span>שתף נכס</span>
            </button>
            {item.status && (
              <div className="inline-block rounded-lg bg-green-100 px-4 py-2 text-sm font-medium text-green-800 shadow-sm">
                {item.status}
              </div>
            )}
          </div>
        </div>
        
        {/* Quick Info Bar */}
        <div className="flex flex-wrap items-center gap-6 text-lg">
          <div className="flex items-center gap-2">
            <span className="text-3xl font-bold text-brand-primary">₪{Number(item.price || 0).toLocaleString()}</span>
            <span className="text-gray-500">לחודש</span>
          </div>
          {item.rooms && (
            <div className="flex items-center gap-1 text-gray-700">
              <span className="font-semibold">{item.rooms}</span>
              <span>חדרים</span>
            </div>
          )}
          {item.sqm && (
            <div className="flex items-center gap-1 text-gray-700">
              <span className="font-semibold">{item.sqm}</span>
              <span>מ״ר</span>
            </div>
          )}
          {(item.city || item.neighborhood) && (
            <div className="flex items-center gap-2 text-gray-600">
              <MapPin className="h-5 w-5" />
              <span>{item.city}{item.neighborhood && ` · ${item.neighborhood}`}</span>
            </div>
          )}
        </div>

        <SentMatchBadge propertyId={item.id} />
      </div>

      {/* Image Gallery */}
      {Array.isArray(item.images) && item.images.length > 0 && (
        <PropertyImageGallery images={item.images} title={item.title} />
      )}

      {/* Property Details Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Details */}
        <div className="lg:col-span-2 space-y-8">
          {/* Location & Basic Info */}
          <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
            <h3 className="text-xl font-semibold mb-6 text-gray-900">פרטי הנכס</h3>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div className="space-y-2">
                <div className="text-sm font-medium text-gray-500 flex items-center gap-2">
                  <MapPin className="h-4 w-4" />
                  מיקום
                </div>
                <div className="text-lg font-medium text-gray-900">
                  {item.city}
                  {item.neighborhood && ` · ${item.neighborhood}`}
                </div>
                {item.address && (
                  <div className="text-sm text-gray-600">{item.address}</div>
                )}
              </div>

              {item.evacuation_date && (
                <div className="space-y-2">
                  <div className="text-sm font-medium text-gray-500 flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    תאריך כניסה
                  </div>
                  <div className="text-lg font-medium text-gray-900">{formatDate(item.evacuation_date)}</div>
                </div>
              )}
            </div>

            {/* Amenities */}
            {item.amenities && Object.entries(item.amenities).filter(([_, v]) => v).length > 0 && (
              <div className="mt-8 space-y-4">
                <h4 className="text-lg font-medium text-gray-900">מאפיינים</h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {Object.entries(item.amenities).filter(([_, v]) => v).map(([key]) => (
                    <div key={key} className="flex items-center gap-2 p-3 rounded-lg bg-blue-50 text-blue-800">
                      <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                      <span className="text-sm font-medium">{amenityLabel(key)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Quick flags — editable, affect renter matching */}
            <div className="mt-8 space-y-3 border-t border-gray-100 pt-6">
              <h4 className="text-lg font-medium text-gray-900">סימון מהיר</h4>
              <div className="flex flex-wrap gap-2">
                <FlagToggle propertyId={item.id} amenity="divided" label="דירה מחולקת" initial={!!(item.amenities as any)?.divided} />
                <FlagToggle propertyId={item.id} amenity="garden" label="חצר / גינה" initial={!!(item.amenities as any)?.garden} />
              </div>
              <p className="text-xs text-gray-500">משפיע על התאמות: «מחולקת» פוסל שוכרים שביקשו דירה שלמה; «חצר» מתאים למי שביקש/ה חצר.</p>
              <div className="pt-2"><MarkRented mode="property" id={item.id} /></div>
            </div>
          </div>

          {/* Description */}
          {(item.description || item.full_text) && (
            <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
              <h3 className="text-xl font-semibold mb-6 text-gray-900">תיאור הנכס</h3>
              <div className="prose prose-lg max-w-none text-gray-700 leading-relaxed">
                {item.description || item.full_text}
              </div>
            </div>
          )}

          {/* Matching Renters */}
          <MatchingRentersSection propertyId={params.id} />

          {/* Timeline */}
          {item.timeline && item.timeline.length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
              <h3 className="text-xl font-semibold mb-6 text-gray-900">היסטורית עדכונים</h3>
              <div className="space-y-4">
                {item.timeline.map((event, index) => (
                  <div key={index} className="flex gap-4 p-4 rounded-lg bg-gray-50">
                    <div className="flex-shrink-0 w-3 h-3 rounded-full bg-brand-primary mt-2"></div>
                    <div className="flex-1 space-y-1">
                      <div className="text-sm font-semibold text-brand-primary">{event.type}</div>
                      <div className="text-gray-700">{event.content}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Contact Info */}
          {(item.contact_name || item.contact_phone) && (
            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <h3 className="text-lg font-semibold mb-4 text-gray-900 flex items-center gap-2">
                <Phone className="h-5 w-5 text-brand-primary" />
                פרטי קשר
              </h3>
              <div className="space-y-4">
                {item.contact_name && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-500">שם:</span>
                    <span className="text-gray-900 font-medium">{item.contact_name}</span>
                  </div>
                )}
                {item.contact_phone && (
                  <a 
                    href={`tel:${item.contact_phone}`} 
                    className="flex items-center justify-center gap-2 w-full bg-brand-primary text-white px-4 py-3 rounded-lg font-medium hover:bg-brand-primary/90 transition-colors"
                  >
                    <Phone className="h-4 w-4" />
                    {item.contact_phone}
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Meta Information */}
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h3 className="text-lg font-semibold mb-4 text-gray-900">מידע נוסף</h3>
            <div className="space-y-3">
              {item.source && (
                <div className="flex items-center gap-2 text-sm">
                  <Info className="h-4 w-4 text-gray-400" />
                  <span className="text-gray-500">מקור:</span>
                  <span className="text-gray-900 font-medium">{item.source}</span>
                </div>
              )}
              
              {item.last_updated_external && (
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="h-4 w-4 text-gray-400" />
                  <span className="text-gray-500">עודכן:</span>
                  <span className="text-gray-900">{item.last_updated_external}</span>
                </div>
              )}
              
              {item.scraped_metadata?.scrapedAt && (
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="h-4 w-4 text-gray-400" />
                  <span className="text-gray-500">נסרק:</span>
                  <span className="text-gray-900">{new Date(item.scraped_metadata.scrapedAt).toLocaleDateString('he-IL')}</span>
                </div>
              )}
              
              {item.link && (
                <div className="pt-2">
                  <a 
                    className="text-brand-primary hover:text-brand-primary/80 flex items-center gap-1 text-sm font-medium" 
                    href={item.link} 
                    target="_blank" 
                    rel="noopener noreferrer"
                  >
                    צפה במודעה המקורית
                    <ChevronLeft className="h-4 w-4" />
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Share Dialog */}
      <SharePropertyDialog
        propertyId={params.id}
        propertyTitle={item.title}
        isOpen={shareDialogOpen}
        onClose={() => setShareDialogOpen(false)}
      />
    </main>
  )
}

function MatchingRentersSection({ propertyId }: { propertyId: string }) {
  const [matches, setMatches] = useState<Match[]>([])
  const [loading, setLoading] = useState(true)
  const [recomputing, setRecomputing] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch(`/api/v1/matches?property_id=${propertyId}&include_dq=true&limit=50`)
      const data = await res.json()
      if (res.ok) setMatches(data.matches || [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [propertyId]) // eslint-disable-line

  async function recompute() {
    if (recomputing) return
    setRecomputing(true)
    try {
      await fetch('/api/v1/matches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ property_id: propertyId }),
      })
      setTimeout(() => load(), 2500)
    } finally {
      setTimeout(() => setRecomputing(false), 2500)
    }
  }

  const nonDq = matches.filter(m => !m.is_disqualified)
  const dq = matches.filter(m => m.is_disqualified)

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
          <Target className="h-5 w-5 text-emerald-600" />
          שוכרים מתאימים ({nonDq.length}{dq.length ? ` + ${dq.length} פסולים` : ''})
        </h3>
        <button
          onClick={recompute}
          disabled={recomputing}
          className="inline-flex items-center gap-1.5 rounded-md border border-brand-primary px-3 py-1.5 text-sm text-brand-primary hover:bg-brand-primary/5 disabled:opacity-60"
        >
          {recomputing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          חשב מחדש
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-brand-primary" /></div>
      ) : matches.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <User className="mx-auto h-10 w-10 mb-2 text-gray-300" />
          <p>אין עדיין שוכרים מתאימים במאגר.</p>
          <p className="text-xs mt-1">המתאמות יחושבו אוטומטית כשיתווספו שוכרים חדשים.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {[...nonDq, ...dq].slice(0, 10).map(m => <MatchRenterRow key={m.id} match={m} />)}
        </div>
      )}
    </div>
  )
}

function MatchRenterRow({ match }: { match: Match }) {
  const [expanded, setExpanded] = useState(false)
  const r = match.renter
  if (!r) return null
  const score = Math.round(match.score || 0)
  const scoreTone =
    match.is_disqualified ? 'bg-red-100 text-red-700 border-red-200' :
    score >= 80 ? 'bg-emerald-100 text-emerald-700 border-emerald-200' :
    score >= 60 ? 'bg-yellow-100 text-yellow-800 border-yellow-200' :
    'bg-gray-100 text-gray-700 border-gray-200'
  const name = [r.first_name, r.last_name].filter(Boolean).join(' ')
  const vetting: string[] = []
  if (r.has_payslips) vetting.push('תלושים')
  if (r.has_security_checks) vetting.push('צ׳ק ביטחון')
  if (r.has_guarantors) vetting.push('ערבים')

  return (
    <div className={`rounded-lg border bg-white ${match.is_disqualified ? 'opacity-70' : ''}`}>
      <div className="p-3 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <Link href={`/renters/${r.id}`} className="font-medium text-brand-primary hover:underline truncate">{name || 'ללא שם'}</Link>
            <span className="text-xs text-gray-500">{r.phone}</span>
            <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium ${scoreTone}`}>
              {match.is_disqualified ? <><AlertTriangle className="h-3 w-3" /> פסול</> : `${score}/100`}
            </span>
          </div>
          <div className="flex flex-wrap gap-1 text-xs">
            {r.budget_max && <span className="rounded bg-brand-primary/10 px-1.5 py-0.5 text-brand-primary">₪{r.budget_min || '?'}-{r.budget_max.toLocaleString('he-IL')}</span>}
            {r.preferred_rooms !== null && <span className="rounded bg-gray-100 px-1.5 py-0.5">{r.preferred_rooms} חד׳</span>}
            {r.move_in_date && <span className="rounded bg-gray-100 px-1.5 py-0.5">כניסה {new Date(r.move_in_date).toLocaleDateString('he-IL')}</span>}
            {r.has_pets && <span className="rounded bg-purple-50 px-1.5 py-0.5 text-purple-700">חיות</span>}
            {vetting.length > 0 && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">סינון: {vetting.join(', ')}</span>}
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

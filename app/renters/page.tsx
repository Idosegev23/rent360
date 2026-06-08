'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Users, Phone, Plus, Search, Loader2, AlertCircle, ChevronDown, ChevronUp,
  Send, Copy, ExternalLink, CheckCircle2, Clock, MailOpen, Inbox as InboxIcon,
} from 'lucide-react'
import Topbar from '../../components/shell/Topbar'

type Renter = {
  id: string
  phone: string
  first_name: string
  last_name: string | null
  email: string | null
  created_at: string
  updated_at: string
  submissions_count: number
  budget_min: number | null
  budget_max: number | null
  preferred_cities: string[] | null
  preferred_rooms: number | null
  rooms_flexible: boolean | null
  move_in_date: string | null
  household_size: number | null
  has_children: boolean | null
  has_pets: boolean | null
  smokers: boolean | null
  employment_status: string | null
  has_payslips: boolean | null
  has_security_checks: boolean | null
  has_guarantors: boolean | null
  matches: { total: number; topScore: number | null }
}

type Invite = {
  token: string
  first_name: string
  last_name: string | null
  phone: string
  status: 'pending' | 'opened' | 'submitted' | 'expired' | string
  created_at: string
  opened_at: string | null
  submitted_at: string | null
  created_by: string | null
}

const STATUS_META: Record<string, { label: string; tone: string; icon: any }> = {
  pending: { label: 'נשלח', tone: 'bg-amber-100 text-amber-800', icon: Clock },
  opened: { label: 'נפתח', tone: 'bg-blue-100 text-blue-800', icon: MailOpen },
  submitted: { label: 'מולא', tone: 'bg-emerald-100 text-emerald-800', icon: CheckCircle2 },
}

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' })
}

function fmtTimeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return 'עכשיו'
  const mins = Math.floor(ms / 60_000)
  if (mins < 60) return `${mins} ד׳`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} שעות`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} ימים`
  return new Date(iso).toLocaleDateString('he-IL')
}

export default function RentersPage() {
  const [tab, setTab] = useState<'pool' | 'invites'>('pool')
  const [showCreateFromPool, setShowCreateFromPool] = useState(false)
  const [poolRefreshKey, setPoolRefreshKey] = useState(0)

  return (
    <>
      <Topbar
        crumb="בית · שוכרים"
        title="שוכרים"
        action={
          <button
            type="button"
            onClick={() => {
              if (tab !== 'invites') { setShowCreateFromPool(true); setTab('invites') }
              else { setShowCreateFromPool(s => !s) }
            }}
            className="btn btn-brand"
          >
            <Send size={14} /> שלח שאלון לשוכר
          </button>
        }
      />
      <div className="page-wrap">
      <div className="flex gap-2 mb-4 border-b" style={{ borderColor: 'var(--line)' }}>
        {[
          { id: 'pool' as const, label: 'מאגר שוכרים', icon: Users },
          { id: 'invites' as const, label: 'שאלונים שנשלחו', icon: Send },
        ].map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 -mb-px text-sm font-medium border-b-2 transition ${
              tab === t.id
                ? 'border-brand-primary text-brand-primary'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <span className="inline-flex items-center gap-1.5">
              <t.icon className="h-4 w-4" />
              {t.label}
            </span>
          </button>
        ))}
      </div>

      {tab === 'pool' ? (
        <RenterPool refreshKey={poolRefreshKey} />
      ) : (
        <InvitesPanel
          initialShowCreate={showCreateFromPool}
          onCreateClosed={() => setShowCreateFromPool(false)}
          onCreated={() => { setPoolRefreshKey(k => k + 1) }}
        />
      )}
      </div>
    </>
  )
}

// ---------- Pool ----------------------------------------------------------

function RenterPool({ refreshKey = 0 }: { refreshKey?: number }) {
  const [renters, setRenters] = useState<Renter[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<'matches' | 'created_at' | 'budget_max' | 'updated_at'>('matches')
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')
  const [vetted, setVetted] = useState<'' | 'true' | 'false'>('')

  useEffect(() => {
    let cancel = false
    setLoading(true)
    setError(null)
    const apiSort = sort === 'matches' ? 'updated_at' : sort
    fetch(`/api/v1/renters?sort=${apiSort}&dir=${dir}&search=${encodeURIComponent(search)}${vetted ? `&vetted=${vetted}` : ''}&limit=200`)
      .then(r => r.json())
      .then(data => {
        if (cancel) return
        if (data.error) setError(data.error.message || data.error.code)
        else {
          let rows: Renter[] = data.renters || []
          if (sort === 'matches') {
            rows = [...rows].sort((a, b) => {
              const av = a.matches?.topScore ?? -1, bv = b.matches?.topScore ?? -1
              return dir === 'desc' ? bv - av : av - bv
            })
          }
          setRenters(rows)
        }
      })
      .catch(err => { if (!cancel) setError(err.message) })
      .finally(() => { if (!cancel) setLoading(false) })
    return () => { cancel = true }
  }, [search, sort, dir, refreshKey, vetted])

  function toggleSort(col: typeof sort) {
    if (sort === col) setDir(d => (d === 'desc' ? 'asc' : 'desc'))
    else { setSort(col); setDir('desc') }
  }

  return (
    <>
      <div className="flex items-center gap-2 mb-3">
        <div className="relative flex-1">
          <Search className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="search"
            placeholder="חיפוש לפי שם / טלפון..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full rounded-md border border-brand-border bg-white py-2 pr-8 pl-3 text-sm"
          />
        </div>
        <div className="flex gap-1 text-xs">
          {([
            { id: 'matches', label: 'התאמות' },
            { id: 'created_at', label: 'תאריך הצטרפות' },
            { id: 'updated_at', label: 'עודכן' },
            { id: 'budget_max', label: 'תקציב' },
          ] as const).map(s => (
            <button
              key={s.id}
              type="button"
              onClick={() => toggleSort(s.id)}
              className={`px-2 py-1 rounded ${
                sort === s.id
                  ? 'bg-brand-primary text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {s.label} {sort === s.id && (dir === 'desc' ? <ChevronDown className="inline h-3 w-3" /> : <ChevronUp className="inline h-3 w-3" />)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-1.5 mb-3 text-xs">
        {([{ id: '' as const, label: 'הכל' }, { id: 'false' as const, label: 'לא מטוייבים (יובאו)' }, { id: 'true' as const, label: 'מטוייבים (מילאו שאלון)' }]).map(v => (
          <button
            key={v.id || 'all'}
            type="button"
            onClick={() => setVetted(v.id)}
            className={`px-3 py-1 rounded-full border transition ${
              vetted === v.id ? 'bg-brand-primary text-white border-brand-primary' : 'bg-white text-gray-600 border-brand-border hover:bg-gray-50'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {loading && <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-brand-primary" /></div>}
      {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"><AlertCircle className="inline h-4 w-4 ml-1" />{error}</div>}

      {!loading && !error && renters.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <Users className="mx-auto h-10 w-10 mb-2 text-gray-300" />
          <p>אין שוכרים במאגר עדיין.</p>
          <p className="text-xs mt-1">צור שאלון חדש בלשונית &quot;שאלונים שנשלחו&quot;.</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-2">
        {renters.map(r => <RenterCard key={r.id} renter={r} />)}
      </div>
    </>
  )
}

function RenterCard({ renter }: { renter: Renter }) {
  const fullName = [renter.first_name, renter.last_name].filter(Boolean).join(' ')
  const cities = Array.isArray(renter.preferred_cities) ? renter.preferred_cities : []
  const vetting: string[] = []
  if (renter.has_payslips) vetting.push('תלושים')
  if (renter.has_security_checks) vetting.push('צ׳ק ביטחון')
  if (renter.has_guarantors) vetting.push('ערבים')
  const matches = renter.matches?.total ?? 0
  const topScore = renter.matches?.topScore ?? null

  return (
    <Link
      href={`/renters/${renter.id}`}
      className="block rounded-lg border border-brand-border bg-white p-4 shadow-sm hover:shadow transition"
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-semibold text-gray-900 truncate">{fullName || 'ללא שם'}</span>
            <span className="text-xs text-gray-500 inline-flex items-center gap-1"><Phone className="h-3 w-3" />{renter.phone}</span>
          </div>
          <div className="text-xs text-gray-500">
            הצטרף {fmtTimeAgo(renter.created_at)} · {renter.submissions_count} שאלונים
          </div>
        </div>
        <div className="text-left">
          {matches > 0 ? (
            <div className="rounded-md bg-emerald-50 px-3 py-1.5">
              <div className="text-emerald-700 font-semibold text-sm">{matches} התאמות</div>
              {topScore !== null && (
                <div className="text-xs text-emerald-600">ציון מקסימלי: {Math.round(topScore)}</div>
              )}
            </div>
          ) : (
            <div className="text-xs text-gray-400">אין התאמות עדיין</div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        {renter.budget_max && (
          <Stat label="תקציב" value={`₪${renter.budget_min || '?'}-${renter.budget_max.toLocaleString('he-IL')}`} />
        )}
        {renter.preferred_rooms !== null && (
          <Stat label="חדרים" value={`${renter.preferred_rooms}${renter.rooms_flexible ? ' (גמיש)' : ''}`} />
        )}
        {renter.move_in_date && (
          <Stat label="כניסה" value={new Date(renter.move_in_date).toLocaleDateString('he-IL')} />
        )}
        {renter.household_size && (
          <Stat label="משק בית" value={`${renter.household_size}${renter.has_children ? ' (עם ילדים)' : ''}`} />
        )}
      </div>

      <div className="flex flex-wrap gap-1 mt-2">
        {cities.slice(0, 4).map(c => (
          <span key={c} className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">{c}</span>
        ))}
        {renter.has_pets && <span className="rounded-full bg-purple-50 px-2 py-0.5 text-xs text-purple-700">חיות מחמד</span>}
        {renter.smokers && <span className="rounded-full bg-orange-50 px-2 py-0.5 text-xs text-orange-700">מעשן</span>}
        {vetting.length > 0 && (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">סינון: {vetting.join(', ')}</span>
        )}
      </div>
    </Link>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-gray-50 px-2 py-1">
      <div className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</div>
      <div className="text-gray-800 font-medium">{value}</div>
    </div>
  )
}

// ---------- Invites panel ---------------------------------------------------

function InvitesPanel({
  initialShowCreate = false,
  onCreateClosed,
  onCreated: onCreatedExt,
}: {
  initialShowCreate?: boolean
  onCreateClosed?: () => void
  onCreated?: () => void
}) {
  const [invites, setInvites] = useState<Invite[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(initialShowCreate)

  useEffect(() => {
    if (initialShowCreate) setShowCreate(true)
  }, [initialShowCreate])

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/v1/renters/invite')
      const data = await res.json()
      if (data.error) throw new Error(data.error.message || data.error.code)
      setInvites(data.invites || [])
      setCounts(data.counts || {})
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'load failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <div className="flex gap-2 text-xs">
          {Object.entries(STATUS_META).map(([k, m]) => (
            <span key={k} className={`px-2 py-1 rounded-full ${m.tone}`}>
              {m.label}: {counts[k] || 0}
            </span>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(s => !s)}
          className="inline-flex items-center gap-1.5 rounded-md bg-brand-primary px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> שאלון חדש
        </button>
      </div>

      {showCreate && (
        <CreateInviteForm
          onCreated={() => { load(); setShowCreate(false); onCreateClosed?.(); onCreatedExt?.() }}
          onCancel={() => { setShowCreate(false); onCreateClosed?.() }}
        />
      )}

      {loading && <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-brand-primary" /></div>}
      {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"><AlertCircle className="inline h-4 w-4 ml-1" />{error}</div>}

      {!loading && !error && invites.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <InboxIcon className="mx-auto h-10 w-10 mb-2 text-gray-300" />
          <p>אין שאלונים פעילים. לחץ &quot;שאלון חדש&quot; כדי ליצור לינק.</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-2">
        {invites.map(inv => <InviteRow key={inv.token} invite={inv} />)}
      </div>
    </>
  )
}

function InviteRow({ invite }: { invite: Invite }) {
  const meta = STATUS_META[invite.status] || { label: invite.status, tone: 'bg-gray-100 text-gray-700', icon: Clock }
  const Icon = meta.icon
  const link = typeof window !== 'undefined' ? `${window.location.origin}/r/${invite.token}` : `/r/${invite.token}`
  const fullName = [invite.first_name, invite.last_name].filter(Boolean).join(' ')

  async function copy() {
    try { await navigator.clipboard.writeText(link); alert('הקישור הועתק') } catch {/* */}
  }

  function waLink() {
    const phone = invite.phone.startsWith('0') ? '972' + invite.phone.slice(1) : invite.phone
    const text = `היי ${invite.first_name}, ${link}`
    return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
  }

  return (
    <div className="rounded-lg border border-brand-border bg-white p-3 flex flex-wrap items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-medium text-gray-900">{fullName || 'ללא שם'}</span>
          <span className="text-xs text-gray-500">{invite.phone}</span>
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${meta.tone}`}>
            <Icon className="h-3 w-3" />
            {meta.label}
          </span>
        </div>
        <div className="text-xs text-gray-500">
          נוצר {fmtTimeAgo(invite.created_at)}
          {invite.opened_at && ` · נפתח ${fmtTimeAgo(invite.opened_at)}`}
          {invite.submitted_at && ` · מולא ${fmtTimeAgo(invite.submitted_at)}`}
        </div>
      </div>
      <div className="flex gap-1">
        <button onClick={copy} className="rounded-md border border-brand-border bg-white px-2 py-1 text-xs hover:bg-gray-50 inline-flex items-center gap-1">
          <Copy className="h-3 w-3" /> העתק
        </button>
        <a href={waLink()} target="_blank" rel="noopener noreferrer" className="rounded-md bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-700 inline-flex items-center gap-1">
          <Send className="h-3 w-3" /> וואטסאפ
        </a>
        <a href={link} target="_blank" rel="noopener noreferrer" className="rounded-md border border-brand-border bg-white px-2 py-1 text-xs hover:bg-gray-50 inline-flex items-center gap-1">
          <ExternalLink className="h-3 w-3" /> פתח
        </a>
      </div>
    </div>
  )
}

function CreateInviteForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (creating) return
    setCreating(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/renters/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ first_name: firstName, last_name: lastName, phone }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error?.message || 'יצירה נכשלה')
      setFirstName(''); setLastName(''); setPhone('')
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'יצירה נכשלה')
    } finally {
      setCreating(false)
    }
  }

  return (
    <form onSubmit={submit} className="rounded-lg border border-brand-border bg-brand-bg p-4 mb-4 space-y-2">
      <div className="grid gap-2 sm:grid-cols-3">
        <input type="text" required placeholder="שם פרטי *" value={firstName} onChange={e => setFirstName(e.target.value)} className="rounded border border-brand-border bg-white px-2 py-1.5 text-sm" />
        <input type="text" placeholder="שם משפחה" value={lastName} onChange={e => setLastName(e.target.value)} className="rounded border border-brand-border bg-white px-2 py-1.5 text-sm" />
        <input type="tel" required placeholder="טלפון *" value={phone} onChange={e => setPhone(e.target.value)} className="rounded border border-brand-border bg-white px-2 py-1.5 text-sm" />
      </div>
      {error && <div className="text-xs text-red-700">{error}</div>}
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} disabled={creating} className="rounded-md border border-brand-border bg-white px-3 py-1.5 text-xs text-gray-700">ביטול</button>
        <button type="submit" disabled={creating} className="inline-flex items-center gap-1 rounded-md bg-brand-primary px-3 py-1.5 text-xs text-white">
          {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
          צור והעתק לינק
        </button>
      </div>
    </form>
  )
}

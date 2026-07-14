'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { MessageCircle, Clock, AlertCircle, Loader2, RefreshCw } from 'lucide-react'

// Auto-refresh cadence for the conversations list (ms).
const POLL_MS = 15_000

// Deterministic colored avatar from a name/phone.
function initials(s: string | null | undefined): string {
  const p = (s || '?').trim().split(/\s+/)
  return ((p[0]?.[0] || '?') + (p[1]?.[0] || '')).toUpperCase()
}
function hueFor(s: string | null | undefined): string {
  let h = 0
  for (const c of String(s || '')) h = (h * 31 + c.charCodeAt(0)) % 360
  return `hsl(${h} 52% 46%)`
}
import Topbar from '../../components/shell/Topbar'

type ThreadRow = {
  id: string
  phone: string | null
  status: string
  last_message_at: string | null
  last_inbound_at: string | null
  last_outbound_at: string | null
  opted_out_at: string | null
  intent: string | null
  audience?: 'renter' | 'landlord'
  landlord_name: string | null
  property_title: string | null
  property_city: string | null
  preview: { body: string | null; direction: string; created_at: string } | null
}

const TABS: Array<{ id: string; label: string }> = [
  { id: 'all', label: 'הכל' },
  { id: 'awaiting_reply', label: 'ממתינות לתגובה' },
  { id: 'dead', label: 'שיחות מתות' },
  { id: 'interested', label: 'מתעניינים' },
  { id: 'price_objection', label: 'מו״מ מחיר' },
  { id: 'callback_later', label: 'לחזור אליהם' },
  { id: 'human_takeover', label: 'בטיפול אדם' },
  { id: 'not_relevant', label: 'לא רלוונטי' },
  { id: 'closed', label: 'סגורות' },
]

const INTENT_LABELS: Record<string, string> = {
  interested: 'מתעניין',
  price_objection: 'מו״מ מחיר',
  callback_later: 'לחזור אליו',
  not_interested: 'לא מעוניין',
  already_rented: 'כבר הושכר',
}

const STATUS_LABELS: Record<string, { label: string; tone: 'gray' | 'amber' | 'green' | 'red' | 'blue' | 'outline' }> = {
  active: { label: 'פעיל', tone: 'green' },
  awaiting_reply: { label: 'ממתין לתגובה', tone: 'amber' },
  human_takeover: { label: 'בטיפול אדם', tone: 'red' },
  closed_won: { label: 'נסגרה — כן', tone: 'green' },
  closed_lost: { label: 'נסגרה — לא', tone: 'outline' },
  opted_out: { label: 'הסר', tone: 'outline' },
  cooldown: { label: 'בהמתנה', tone: 'outline' },
}

function timeAgo(iso: string | null): string {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return 'עכשיו'
  const mins = Math.floor(ms / 60_000)
  if (mins < 60) return `${mins} ד'`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} שעות`
  const days = Math.floor(hours / 24)
  return `${days} ימים`
}

export default function InboxPage() {
  const [filter, setFilter] = useState('all')
  const [audience, setAudience] = useState<'all' | 'renter' | 'landlord'>('all')
  const [threads, setThreads] = useState<ThreadRow[]>([])
  const [loading, setLoading] = useState(true)        // full-page spinner (initial / filter change only)
  const [refreshing, setRefreshing] = useState(false) // silent background poll / manual refresh
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  const [newIds, setNewIds] = useState<Set<string>>(new Set())

  // Baselines for detecting freshly-arrived incoming messages between polls.
  const prevMapRef = useRef<Map<string, string | null>>(new Map())
  const isFirstLoadRef = useRef(true)

  const loadThreads = useCallback(async (silent: boolean) => {
    if (silent) setRefreshing(true); else setLoading(true)
    try {
      const res = await fetch(`/api/v1/inbox/threads?filter=${filter}${audience !== 'all' ? `&audience=${audience}` : ''}`)
      const data = await res.json()
      if (data.error) {
        if (!silent) setError(data.error.message || data.error.code)
        return
      }
      const next: ThreadRow[] = data.threads || []
      // Flag genuinely-new incoming activity (skip the very first load so nothing flashes on entry):
      // a brand-new thread, or an existing one whose last message changed and is INBOUND.
      if (!isFirstLoadRef.current) {
        const fresh = new Set<string>()
        for (const t of next) {
          const prev = prevMapRef.current.get(t.id)
          const isNewThread = prev === undefined
          const changed = prev !== t.last_message_at
          if (isNewThread || (changed && t.preview?.direction === 'in')) fresh.add(t.id)
        }
        if (fresh.size) setNewIds(cur => new Set([...cur, ...fresh]))
      }
      prevMapRef.current = new Map(next.map(t => [t.id, t.last_message_at]))
      isFirstLoadRef.current = false
      setThreads(next)
      setError(null)
      setLastUpdated(Date.now())
    } catch (err) {
      if (!silent) setError(err instanceof Error ? err.message : 'load failed')
    } finally {
      if (silent) setRefreshing(false); else setLoading(false)
    }
  }, [filter, audience])

  // Initial load + reset baselines whenever the filter (tab) changes.
  useEffect(() => {
    isFirstLoadRef.current = true
    prevMapRef.current = new Map()
    setNewIds(new Set())
    loadThreads(false)
  }, [loadThreads])

  // Auto-refresh on an interval — but skip while the tab is hidden (saves work, avoids drift).
  useEffect(() => {
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      loadThreads(true)
    }, POLL_MS)
    return () => clearInterval(id)
  }, [loadThreads])

  // Refresh immediately when the user returns to the tab.
  useEffect(() => {
    const onVis = () => { if (!document.hidden) loadThreads(true) }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [loadThreads])

  const lastUpdatedLabel = lastUpdated
    ? (() => { const a = timeAgo(new Date(lastUpdated).toISOString()); return a === 'עכשיו' ? 'עודכן עכשיו' : `עודכן לפני ${a}` })()
    : ''

  return (
    <>
      <Topbar crumb="בית · שיחות" title="תיבת השיחות" />
      <div className="page-wrap">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => loadThreads(true)}
              disabled={refreshing}
              className="chip"
              title="רענון"
            >
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} style={{ marginInlineEnd: 6 }} />
              רענון
            </button>
            <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>{lastUpdatedLabel}</span>
            <span className="flex items-center gap-1" style={{ fontSize: 11, color: 'var(--ink-5)' }}>
              <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--brand)', display: 'inline-block' }} />
              מתעדכן אוטומטית
            </span>
          </div>
          {newIds.size > 0 && (
            <button
              type="button"
              onClick={() => { setNewIds(new Set()); if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' }) }}
              className="pill pill-pink"
              style={{ cursor: 'pointer' }}
              title="הצג חדשות"
            >
              {newIds.size} חדש
            </button>
          )}
        </div>
        {/* Renter vs landlord split */}
        <div className="flex w-fit gap-1 mb-3 rounded-lg bg-gray-100 p-1">
          {([['all', 'הכל'], ['landlord', 'בעלי דירות'], ['renter', 'שוכרים']] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setAudience(id)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                audience === id ? 'bg-white text-brand-primary shadow-sm' : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex gap-2 mb-5 overflow-x-auto pb-1">
          {TABS.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setFilter(t.id)}
              className={`chip ${filter === t.id ? 'active' : ''}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin" style={{ color: 'var(--brand)' }} />
          </div>
        )}

        {error && (
          <div className="surface-card mb-4" style={{ borderColor: 'var(--red-soft)', background: 'var(--red-soft)', color: 'var(--red)', fontSize: 13 }}>
            <AlertCircle className="inline h-4 w-4 ml-1" />
            {error}
          </div>
        )}

        {!loading && !error && threads.length === 0 && (
          <div className="text-center py-12" style={{ color: 'var(--ink-4)' }}>
            <MessageCircle className="mx-auto h-10 w-10 mb-2" style={{ color: 'var(--ink-5)' }} />
            <p>אין שיחות בקטגוריה זו עדיין.</p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-2">
          {threads.map(t => {
            const statusInfo = STATUS_LABELS[t.status] || { label: t.status, tone: 'outline' as const }
            const isNew = newIds.has(t.id)
            return (
              <Link
                key={t.id}
                href={`/inbox/${t.id}`}
                onClick={() => { if (isNew) setNewIds(cur => { const n = new Set(cur); n.delete(t.id); return n }) }}
                className="surface-card surface-card-interactive block no-underline"
                style={{ padding: '14px 18px', ...(isNew ? { boxShadow: '0 0 0 1.5px var(--brand)', background: 'var(--brand-soft, var(--bg-2))' } : {}) }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="avatar-hue" style={{ width: 28, height: 28, fontSize: 11, background: hueFor(t.landlord_name || t.phone || '?') }}>{initials(t.landlord_name || t.phone)}</span>
                      <span className="truncate" style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 14 }}>
                        {t.landlord_name || t.phone || 'ללא שם'}
                      </span>
                      {isNew && <span className="pill pill-pink">חדש</span>}
                      {t.audience === 'renter'
                        ? <span className="pill pill-pink">שוכר</span>
                        : <span className="pill pill-gray">בעל דירה</span>}
                      {t.intent && <span className="pill pill-blue">{INTENT_LABELS[t.intent] || t.intent}</span>}
                    </div>
                    {t.property_title && (
                      <div className="text-xs truncate mb-1" style={{ color: 'var(--ink-3)' }}>🏠 {t.property_title}</div>
                    )}
                    {t.preview && (
                      <div className="text-sm truncate" style={{ color: t.preview.direction === 'in' ? 'var(--ink-2)' : 'var(--ink-4)' }}>
                        {t.preview.direction === 'out' ? '↪ ' : ''}{t.preview.body || '[ללא טקסט]'}
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 text-left">
                    <span className={`pill pill-${statusInfo.tone}`}>{statusInfo.label}</span>
                    <div className="mt-1 flex items-center justify-end gap-1" style={{ fontSize: 11, color: 'var(--ink-4)' }}>
                      <Clock size={11} />
                      {timeAgo(t.last_message_at)}
                    </div>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      </div>
    </>
  )
}

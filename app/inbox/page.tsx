'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { MessageCircle, User, Clock, AlertCircle, Loader2 } from 'lucide-react'
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
  { id: 'human_takeover', label: 'בטיפול אדם' },
  { id: 'active', label: 'פעילות' },
  { id: 'closed', label: 'סגורות' },
]

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
  const [threads, setThreads] = useState<ThreadRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/v1/inbox/threads?filter=${filter}`)
      .then(res => res.json())
      .then(data => {
        if (cancelled) return
        if (data.error) setError(data.error.message || data.error.code)
        else setThreads(data.threads || [])
      })
      .catch(err => { if (!cancelled) setError(err.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [filter])

  return (
    <>
      <Topbar crumb="בית · שיחות" title="תיבת השיחות" />
      <div className="page-wrap">
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

        <div className="grid gap-2">
          {threads.map(t => {
            const statusInfo = STATUS_LABELS[t.status] || { label: t.status, tone: 'outline' as const }
            return (
              <Link
                key={t.id}
                href={`/inbox/${t.id}`}
                className="surface-card surface-card-interactive block no-underline"
                style={{ padding: '14px 18px' }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <User size={14} style={{ color: 'var(--ink-4)', flexShrink: 0 }} />
                      <span className="truncate" style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 14 }}>
                        {t.landlord_name || t.phone || 'ללא שם'}
                      </span>
                      {t.audience === 'renter' && <span className="pill pill-blue">שוכר</span>}
                      {t.intent && <span className="pill pill-blue">{t.intent}</span>}
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

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Inbox, MessageCircle, User, Clock, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'

type ThreadRow = {
  id: string
  phone: string | null
  status: string
  last_message_at: string | null
  last_inbound_at: string | null
  last_outbound_at: string | null
  opted_out_at: string | null
  intent: string | null
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

const STATUS_LABELS: Record<string, { label: string; tone: 'gray' | 'amber' | 'green' | 'red' | 'blue' }> = {
  active: { label: 'פעיל', tone: 'green' },
  awaiting_reply: { label: 'ממתין לתגובה', tone: 'amber' },
  human_takeover: { label: 'בטיפול אדם', tone: 'red' },
  closed_won: { label: 'נסגרה — כן', tone: 'green' },
  closed_lost: { label: 'נסגרה — לא', tone: 'gray' },
  opted_out: { label: 'הסר', tone: 'gray' },
  cooldown: { label: 'בהמתנה', tone: 'gray' },
}

const TONE_CLASSES: Record<string, string> = {
  gray: 'bg-gray-100 text-gray-700',
  amber: 'bg-amber-100 text-amber-800',
  green: 'bg-emerald-100 text-emerald-800',
  red: 'bg-red-100 text-red-800',
  blue: 'bg-blue-100 text-blue-800',
}

function tone(t: string): string {
  return TONE_CLASSES[t] ?? TONE_CLASSES.gray ?? ''
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
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="flex items-center gap-3 mb-4">
        <Inbox className="h-6 w-6 text-brand-primary" />
        <h1 className="text-2xl font-bold">תיבת השיחות</h1>
      </div>

      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setFilter(t.id)}
            className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition ${
              filter === t.id ? 'bg-brand-primary text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-brand-primary" />
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 mb-4">
          <AlertCircle className="inline h-4 w-4 ml-1" />
          {error}
        </div>
      )}

      {!loading && !error && threads.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <MessageCircle className="mx-auto h-10 w-10 mb-2 text-gray-300" />
          <p>אין שיחות בקטגוריה זו עדיין.</p>
        </div>
      )}

      <div className="grid gap-2">
        {threads.map(t => {
          const statusInfo = STATUS_LABELS[t.status] || { label: t.status, tone: 'gray' as const }
          return (
            <Link
              key={t.id}
              href={`/inbox/${t.id}`}
              className="block rounded-lg border border-brand-border bg-white p-4 shadow-sm hover:shadow transition"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <User className="h-4 w-4 text-gray-400 shrink-0" />
                    <span className="font-semibold text-gray-900 truncate">
                      {t.landlord_name || t.phone || 'ללא שם'}
                    </span>
                    {t.intent && (
                      <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
                        {t.intent}
                      </span>
                    )}
                  </div>
                  {t.property_title && (
                    <div className="text-xs text-gray-500 truncate mb-1">🏠 {t.property_title}</div>
                  )}
                  {t.preview && (
                    <div className={`text-sm truncate ${t.preview.direction === 'in' ? 'text-gray-700' : 'text-gray-500'}`}>
                      {t.preview.direction === 'out' ? '↪ ' : ''}{t.preview.body || '[ללא טקסט]'}
                    </div>
                  )}
                </div>
                <div className="shrink-0 text-left">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs ${tone(statusInfo.tone)}`}>
                    {statusInfo.label}
                  </span>
                  <div className="mt-1 flex items-center justify-end gap-1 text-xs text-gray-400">
                    <Clock className="h-3 w-3" />
                    {timeAgo(t.last_message_at)}
                  </div>
                </div>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

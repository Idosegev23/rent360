'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Send, Loader2, AlertCircle, User, Bot, ChevronDown, Image as ImageIcon } from 'lucide-react'

type Message = {
  id: string
  direction: 'in' | 'out'
  body: string | null
  status: string
  created_at: string
  processed_at: string | null
  meta_message_type: string | null
  template_name: string | null
  rendered_body: string | null
  media_url: string | null
  ai_metadata: Record<string, unknown> | null
  external_id: string | null
}

type Thread = {
  id: string
  phone: string | null
  status: string
  last_inbound_at: string | null
  last_outbound_at: string | null
  tags: Record<string, unknown> | null
  opted_out_at: string | null
}

type Property = {
  id: string
  title: string
  city: string | null
  street: string | null
  address: string | null
  price: number | null
  rooms: number | null
  sqm: number | null
  images: string[] | null
  contact_name: string | null
  contact_phone: string | null
  outreach_blocked: boolean
}

const WINDOW_MS = 24 * 60 * 60 * 1000

function inWindow(lastInboundAt: string | null | undefined): boolean {
  if (!lastInboundAt) return false
  return Date.now() - new Date(lastInboundAt).getTime() < WINDOW_MS
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function ThreadDetailPage({ params }: { params: { id: string } }) {
  const [thread, setThread] = useState<Thread | null>(null)
  const [property, setProperty] = useState<Property | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [statusUpdating, setStatusUpdating] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  async function load(opts?: { silent?: boolean }) {
    // Background polls must NOT toggle the full-page loading state — otherwise the whole
    // conversation flashes to a spinner every 15s ("jumping"). Only the first load shows it.
    if (!opts?.silent) setLoading(true)
    try {
      const res = await fetch(`/api/v1/inbox/threads/${params.id}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error?.message || data?.error?.code || 'load failed')
      setThread(data.thread)
      setProperty(data.property)
      setMessages(prev => {
        const next = data.messages || []
        // Avoid a needless re-render when nothing changed (same count + same last id).
        if (prev.length === next.length && prev[prev.length - 1]?.id === next[next.length - 1]?.id) return prev
        return next
      })
      setError(null)
    } catch (err) {
      if (!opts?.silent) setError(err instanceof Error ? err.message : 'load failed')
    } finally {
      if (!opts?.silent) setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // Light polling every 15s to pick up new inbound messages — silent (no loading flash).
    const t = setInterval(() => load({ silent: true }), 15_000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  const windowOpen = inWindow(thread?.last_inbound_at)
  const inHumanMode = thread?.status === 'human_takeover'

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    if (sending || !draft.trim()) return
    setSending(true)
    setSendError(null)
    try {
      const res = await fetch(`/api/v1/threads/${params.id}/send-text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: draft.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error?.message || 'שליחה נכשלה')
      setDraft('')
      await load()
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'שליחה נכשלה')
    } finally {
      setSending(false)
    }
  }

  async function handleStatusChange(newStatus: 'human_takeover' | 'active') {
    if (statusUpdating) return
    setStatusUpdating(true)
    try {
      await fetch(`/api/v1/inbox/threads/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      await load()
    } finally {
      setStatusUpdating(false)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-brand-primary" /></div>
  }
  if (error) {
    return <div className="mx-auto max-w-3xl p-4">
      <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
        <AlertCircle className="inline h-4 w-4 ml-1" /> {error}
      </div>
    </div>
  }
  if (!thread) return null

  const intent = (thread.tags && typeof thread.tags === 'object' ? (thread.tags as any).intent : null) as string | null

  return (
    <div className="mx-auto max-w-5xl px-4 py-4">
      <Link href="/inbox" className="inline-flex items-center gap-1 text-sm text-brand-primary hover:underline mb-3">
        <ArrowRight className="h-4 w-4" /> חזרה לתיבה
      </Link>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_280px]">
        {/* Chat column */}
        <div className="flex flex-col rounded-lg border border-brand-border bg-white min-h-[70vh]">
          <div className="border-b border-brand-border p-3 flex items-center justify-between">
            <div>
              <div className="font-semibold">{property?.contact_name || thread.phone || 'ללא שם'}</div>
              <div className="text-xs text-gray-500">{thread.phone}</div>
            </div>
            <div className="flex items-center gap-2">
              {inHumanMode ? (
                <button
                  type="button"
                  onClick={() => handleStatusChange('active')}
                  disabled={statusUpdating}
                  className="rounded-md border border-brand-primary px-3 py-1 text-xs font-medium text-brand-primary hover:bg-brand-primary/5 disabled:opacity-60"
                >
                  חזור לבוט
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleStatusChange('human_takeover')}
                  disabled={statusUpdating}
                  className="rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60"
                >
                  השתלט על השיחה
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-gray-50">
            {messages.map(m => (
              <MessageBubble key={m.id} message={m} />
            ))}
            <div ref={bottomRef} />
          </div>

          <form onSubmit={handleSend} className="border-t border-brand-border p-3">
            {!windowOpen && (
              <div className="mb-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                ⏰ חלון 24 שעות נסגר. רק תבנית מאושרת אפשרית כרגע.
              </div>
            )}
            {thread.status === 'opted_out' && (
              <div className="mb-2 rounded-md border border-gray-200 bg-gray-50 p-2 text-xs text-gray-700">
                בעל הנכס ביקש שלא לקבל הודעות. שליחה חסומה.
              </div>
            )}
            <div className="flex gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={inHumanMode ? 'כתוב הודעה...' : 'בוט במצב פעיל. השתלט כדי להגיב ידנית.'}
                disabled={!windowOpen || thread.status === 'opted_out' || !inHumanMode || sending}
                rows={2}
                className="flex-1 resize-none rounded-md border border-brand-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/30 disabled:bg-gray-100 disabled:cursor-not-allowed"
              />
              <button
                type="submit"
                disabled={!draft.trim() || sending || !windowOpen || thread.status === 'opted_out' || !inHumanMode}
                className="shrink-0 self-end rounded-md bg-brand-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </div>
            {sendError && <p className="mt-1 text-xs text-red-600">{sendError}</p>}
          </form>
        </div>

        {/* Sidebar */}
        <div className="space-y-3">
          {property ? (
            <div className="rounded-lg border border-brand-border bg-white p-3">
              <div className="text-xs text-gray-500 mb-1">נכס מקושר</div>
              <Link href={`/properties/${property.id}`} className="font-semibold text-sm text-brand-primary hover:underline">
                {property.title}
              </Link>
              <div className="mt-1 text-xs text-gray-600">
                {[property.street || property.address, property.city].filter(Boolean).join(', ')}
              </div>
              <div className="mt-2 flex flex-wrap gap-1 text-xs">
                {property.price && <span className="rounded bg-brand-primary/10 px-2 py-0.5 text-brand-primary">₪{property.price.toLocaleString('he-IL')}</span>}
                {property.rooms && <span className="rounded bg-gray-100 px-2 py-0.5">{property.rooms} חד&apos;</span>}
                {property.sqm && <span className="rounded bg-gray-100 px-2 py-0.5">{property.sqm} מ&quot;ר</span>}
              </div>
              {Array.isArray(property.images) && property.images.length > 0 && (
                <img src={property.images[0]} alt="" className="mt-3 w-full rounded object-cover aspect-[4/3]" />
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-gray-300 bg-white p-3 text-xs text-gray-500 text-center">
              לא משויך נכס לשיחה זו עדיין.
            </div>
          )}

          <div className="rounded-lg border border-brand-border bg-white p-3 text-xs space-y-2">
            <div className="flex justify-between"><span className="text-gray-500">סטטוס</span><span>{thread.status}</span></div>
            {intent && <div className="flex justify-between"><span className="text-gray-500">כוונה</span><span>{intent}</span></div>}
            {thread.last_inbound_at && (
              <div className="flex justify-between">
                <span className="text-gray-500">הודעה אחרונה מהלקוח</span>
                <span>{fmtTime(thread.last_inbound_at)}</span>
              </div>
            )}
            {thread.last_outbound_at && (
              <div className="flex justify-between">
                <span className="text-gray-500">הודעה אחרונה אלינו</span>
                <span>{fmtTime(thread.last_outbound_at)}</span>
              </div>
            )}
            {thread.opted_out_at && (
              <div className="flex justify-between text-red-700"><span>הוסר ב</span><span>{fmtTime(thread.opted_out_at)}</span></div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function MessageBubble({ message }: { message: Message }) {
  const isOut = message.direction === 'out'
  const isTemplate = message.meta_message_type === 'template'
  const [showMeta, setShowMeta] = useState(false)
  return (
    <div className={`flex ${isOut ? 'justify-start' : 'justify-end'}`}>
      <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
        isOut ? 'bg-brand-primary text-white' : 'bg-white border border-gray-200 text-gray-900'
      }`}>
        <div className="flex items-center gap-1 mb-1 opacity-80">
          {isOut ? <Bot className="h-3 w-3" /> : <User className="h-3 w-3" />}
          <span className="text-[10px]">{isOut ? 'אנחנו' : 'לקוח'}</span>
          {isTemplate && <span className="text-[10px] uppercase tracking-wide">· תבנית</span>}
        </div>
        {message.media_url && (
          <img src={message.media_url} alt="" className="rounded mb-2 max-h-64 object-cover" />
        )}
        {(message.body || message.rendered_body) && <div className="whitespace-pre-wrap leading-relaxed">{message.body || message.rendered_body}</div>}
        {isTemplate && !message.body && !message.rendered_body && <div className="italic opacity-80 text-xs">[תבנית: {message.template_name}]</div>}
        <div className="mt-1 text-[10px] opacity-70 flex items-center gap-1">
          <span>{fmtTime(message.created_at)}</span>
          {message.status && <span>· {message.status}</span>}
        </div>
        {message.ai_metadata && Object.keys(message.ai_metadata).length > 0 && (
          <button
            type="button"
            onClick={() => setShowMeta(s => !s)}
            className="mt-1 text-[10px] opacity-80 hover:opacity-100 inline-flex items-center gap-0.5"
          >
            <ChevronDown className={`h-3 w-3 transition-transform ${showMeta ? 'rotate-180' : ''}`} />
            פרטי AI
          </button>
        )}
        {showMeta && message.ai_metadata && (
          <pre className="mt-1 max-h-48 overflow-auto rounded bg-black/10 p-2 text-[10px] whitespace-pre-wrap">
            {JSON.stringify(message.ai_metadata, null, 2)}
          </pre>
        )}
      </div>
    </div>
  )
}

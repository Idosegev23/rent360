'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Send, Loader2, AlertCircle, ChevronDown, Check, Info, StickyNote, ListChecks, Bot, UserRound } from 'lucide-react'
import { ThreadGoogleActions } from '@/components/google/ThreadGoogleActions'
import { RelatedItems } from '@/components/RelatedItems'
import { AddTaskButton } from '@/components/tasks/AddTaskButton'
import { ActivityTimeline } from '@/components/activity/ActivityTimeline'
import NotesBanner from '@/components/NotesBanner'

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
  assigned_to: string | null
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

type Tone = 'gray' | 'amber' | 'green' | 'red' | 'blue' | 'outline'
const STATUS_LABELS: Record<string, { label: string; tone: Tone }> = {
  active: { label: 'פעיל', tone: 'green' },
  awaiting_reply: { label: 'ממתין לתגובה', tone: 'amber' },
  human_takeover: { label: 'בטיפול אדם', tone: 'red' },
  closed_won: { label: 'נסגרה — כן', tone: 'green' },
  closed_lost: { label: 'נסגרה — לא', tone: 'outline' },
  opted_out: { label: 'הוסר', tone: 'outline' },
  cooldown: { label: 'בהמתנה', tone: 'outline' },
}
const INTENT_LABELS: Record<string, string> = {
  interested: 'מתעניין',
  price_objection: 'מו״מ מחיר',
  callback_later: 'לחזור אליו',
  not_interested: 'לא מעוניין',
  already_rented: 'כבר הושכר',
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
  const [sideTab, setSideTab] = useState<'info' | 'activity' | 'tasks'>('info')
  const [team, setTeam] = useState<Array<{ id: string; name: string | null }>>([])
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

  useEffect(() => {
    fetch('/api/v1/team')
      .then((r) => (r.ok ? r.json() : { members: [] }))
      .then((d) => setTeam((d.members || []).map((m: { id: string; name: string | null }) => ({ id: m.id, name: m.name }))))
      .catch(() => {})
  }, [])

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
  const statusInfo = STATUS_LABELS[thread.status] || { label: thread.status, tone: 'gray' as Tone }
  const contactName = property?.contact_name || thread.phone || 'ללא שם'
  const composerDisabled = !windowOpen || thread.status === 'opted_out' || !inHumanMode || sending

  return (
    <div className="mx-auto max-w-6xl px-4 py-4">
      <Link href="/inbox" className="inline-flex items-center gap-1 text-sm text-brand-primary hover:underline mb-3">
        <ArrowRight className="h-4 w-4" /> חזרה לתיבה
      </Link>

      {/* Notes surface at the top of the conversation, not hidden behind a tab. */}
      <NotesBanner entityType="thread" entityId={thread.id} className="mb-3" />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px] items-start">
        {/* ===== Chat column ===== */}
        <div className="surface-card flex flex-col overflow-hidden" style={{ padding: 0, height: 'calc(100vh - 130px)', minHeight: 460 }}>
          {/* header */}
          <div className="flex items-center gap-3 border-b p-3" style={{ borderColor: 'var(--line)' }}>
            <span className="avatar-hue" style={{ width: 40, height: 40, fontSize: 14, background: hueFor(contactName) }}>{initials(contactName)}</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="truncate font-semibold" style={{ color: 'var(--ink)' }}>{contactName}</span>
                <span className={`pill pill-${statusInfo.tone}`} style={{ fontSize: 10 }}>{statusInfo.label}</span>
                {intent && <span className="pill pill-blue" style={{ fontSize: 10 }}>{INTENT_LABELS[intent] || intent}</span>}
              </div>
              {thread.phone && <div className="num text-xs" dir="ltr" style={{ color: 'var(--ink-4)' }}>{thread.phone}</div>}
            </div>
            {inHumanMode ? (
              <button type="button" onClick={() => handleStatusChange('active')} disabled={statusUpdating}
                className="shrink-0 inline-flex items-center gap-1 rounded-md border border-brand-primary px-3 py-1.5 text-xs font-medium text-brand-primary hover:bg-brand-primary/5 disabled:opacity-60">
                <Bot className="h-3.5 w-3.5" /> חזרה לבוט
              </button>
            ) : (
              <button type="button" onClick={() => handleStatusChange('human_takeover')} disabled={statusUpdating}
                className="shrink-0 inline-flex items-center gap-1 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60">
                <UserRound className="h-3.5 w-3.5" /> השתלטות
              </button>
            )}
          </div>

          {/* mode banner */}
          {!inHumanMode && thread.status !== 'opted_out' && (
            <div className="flex items-center gap-1.5 border-b bg-emerald-50 px-3 py-1.5 text-[11px] text-emerald-700" style={{ borderColor: 'var(--line)' }}>
              <Bot className="h-3.5 w-3.5 shrink-0" /> הבוט מנהל את השיחה — לחצו “השתלטות” כדי להגיב ידנית.
            </div>
          )}

          {/* messages */}
          <div className="wa-thread scroll-y flex-1 overflow-y-auto p-4 flex flex-col gap-3">
            {messages.length === 0 && <div className="py-8 text-center text-sm" style={{ color: 'var(--ink-4)' }}>אין הודעות עדיין.</div>}
            {messages.map(m => <MessageBubble key={m.id} message={m} />)}
            <div ref={bottomRef} />
          </div>

          {/* composer */}
          <div className="border-t p-3" style={{ borderColor: 'var(--line)' }}>
            {thread.status === 'opted_out' ? (
              <div className="rounded-md p-2 text-center text-xs" style={{ background: 'var(--surface-2)', color: 'var(--ink-3)' }}>
                בעל הנכס ביקש שלא לקבל הודעות — שליחה חסומה.
              </div>
            ) : (
              <>
                {!windowOpen && (
                  <div className="mb-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-800">
                    ⏰ חלון 24 השעות נסגר — אפשר לשלוח רק תבנית מאושרת.
                  </div>
                )}
                <TemplateSender threadId={params.id} onSent={() => load({ silent: true })} />
                <form onSubmit={handleSend} className="flex gap-2">
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={inHumanMode ? 'כתבו הודעה…' : 'במצב בוט — לחצו “השתלטות” כדי להגיב ידנית'}
                    disabled={composerDisabled}
                    rows={2}
                    className="flex-1 resize-none rounded-md border border-brand-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/30 disabled:bg-gray-100 disabled:cursor-not-allowed"
                  />
                  <button
                    type="submit"
                    disabled={!draft.trim() || composerDisabled}
                    className="shrink-0 self-end rounded-md bg-brand-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </button>
                </form>
                {sendError && <p className="mt-1 text-xs text-red-600">{sendError}</p>}
              </>
            )}
          </div>
        </div>

        {/* ===== Sidebar (tabbed) ===== */}
        <div className="space-y-3 lg:sticky lg:top-2">
          <div className="seg-tabs" style={{ display: 'flex', width: '100%' }}>
            {([['info', 'פרטים', Info], ['activity', 'הערות', StickyNote], ['tasks', 'משימות', ListChecks]] as const).map(([k, label, Icon]) => (
              <button key={k} type="button" onClick={() => setSideTab(k)} className={sideTab === k ? 'active' : ''}
                style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                <Icon size={14} /> {label}
              </button>
            ))}
          </div>

          {sideTab === 'info' && (
            <>
              {property ? (
                <div className="surface-card p-3">
                  <div className="mb-1 text-xs" style={{ color: 'var(--ink-4)' }}>נכס מקושר</div>
                  <Link href={`/properties/${property.id}`} className="text-sm font-semibold text-brand-primary hover:underline">
                    {property.title}
                  </Link>
                  <div className="mt-1 text-xs" style={{ color: 'var(--ink-3)' }}>
                    {[property.street || property.address, property.city].filter(Boolean).join(', ')}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {property.price && <span className="pill pill-brand" style={{ fontSize: 10 }}>₪{property.price.toLocaleString('he-IL')}</span>}
                    {property.rooms && <span className="pill pill-gray" style={{ fontSize: 10 }}>{property.rooms} חד&apos;</span>}
                    {property.sqm && <span className="pill pill-gray" style={{ fontSize: 10 }}>{property.sqm} מ&quot;ר</span>}
                  </div>
                  {Array.isArray(property.images) && property.images.length > 0 && (
                    <img src={property.images[0]} alt="" className="mt-3 w-full rounded-lg object-cover aspect-[4/3]" />
                  )}
                </div>
              ) : (
                <div className="surface-card p-3 text-center text-xs" style={{ borderStyle: 'dashed', color: 'var(--ink-4)' }}>
                  לא משויך נכס לשיחה זו עדיין.
                </div>
              )}

              <div className="surface-card p-3">
                <div className="mb-2 text-xs" style={{ color: 'var(--ink-4)' }}>שיוך ופעולות Google</div>
                <ThreadGoogleActions threadId={thread.id} assignedUserId={thread.assigned_to} team={team} contactEmail={null} />
              </div>

              <div className="surface-card p-3 text-xs space-y-2">
                <div className="flex items-center justify-between"><span style={{ color: 'var(--ink-4)' }}>סטטוס</span><span className={`pill pill-${statusInfo.tone}`} style={{ fontSize: 10 }}>{statusInfo.label}</span></div>
                {intent && <div className="flex items-center justify-between"><span style={{ color: 'var(--ink-4)' }}>כוונה</span><span>{INTENT_LABELS[intent] || intent}</span></div>}
                {thread.last_inbound_at && <div className="flex justify-between"><span style={{ color: 'var(--ink-4)' }}>הודעה אחרונה מהלקוח</span><span className="num">{fmtTime(thread.last_inbound_at)}</span></div>}
                {thread.last_outbound_at && <div className="flex justify-between"><span style={{ color: 'var(--ink-4)' }}>הודעה אחרונה אלינו</span><span className="num">{fmtTime(thread.last_outbound_at)}</span></div>}
                {thread.opted_out_at && <div className="flex justify-between text-red-700"><span>הוסר ב</span><span className="num">{fmtTime(thread.opted_out_at)}</span></div>}
              </div>
            </>
          )}

          {sideTab === 'activity' && <ActivityTimeline entityType="thread" entityId={thread.id} />}

          {sideTab === 'tasks' && (
            <>
              <div className="surface-card p-3">
                <AddTaskButton entityType="thread" entityId={thread.id} label="הוסף משימה מהשיחה" />
              </div>
              <RelatedItems entityType="thread" entityId={thread.id} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function TemplateSender({ threadId, onSent }: { threadId: string; onSent: () => void }) {
  const [open, setOpen] = useState(false)
  const [tpls, setTpls] = useState<Array<{ name: string; body_template: string | null; param_names: string[] | null }>>([])
  const [picked, setPicked] = useState('')
  const [vals, setVals] = useState<string[]>([])
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  async function loadTpls() {
    setOpen(true); setErr(null)
    try {
      const r = await fetch(`/api/v1/threads/${threadId}/send-template`)
      const d = await r.json()
      setTpls(d.templates || [])
    } catch { setErr('טעינת התבניות נכשלה') }
  }
  const tpl = tpls.find(t => t.name === picked)
  const order: string[] = Array.isArray(tpl?.param_names) ? (tpl!.param_names as string[]) : []
  const preview = tpl?.body_template ? String(tpl.body_template).replace(/\{\{(\d+)\}\}/g, (_m, n: string) => vals[Number(n) - 1] || `{{${n}}}`) : ''

  async function send() {
    if (!picked || sending) return
    setSending(true); setErr(null)
    try {
      const r = await fetch(`/api/v1/threads/${threadId}/send-template`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template_name: picked, params: order.map((_, i) => vals[i] || '') }),
      })
      const d = await r.json()
      if (!r.ok || d.error) throw new Error(d?.error?.message || d?.error?.code || 'failed')
      setOk(true); onSent(); setTimeout(() => { setOk(false); setOpen(false); setPicked(''); setVals([]) }, 1500)
    } catch (e) { setErr(e instanceof Error ? e.message : 'השליחה נכשלה') } finally { setSending(false) }
  }

  if (!open) {
    return <button type="button" onClick={loadTpls} className="mb-2 text-xs text-brand-primary hover:underline">+ שלח תבנית (אפשרי גם אחרי 24ש׳)</button>
  }
  return (
    <div className="mb-2 rounded-md border border-brand-border bg-gray-50 p-2 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-700">שליחת תבנית מאושרת</span>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-gray-400 hover:text-gray-600">סגור</button>
      </div>
      <select value={picked} onChange={e => { setPicked(e.target.value); setVals([]) }} className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs">
        <option value="">בחר תבנית…</option>
        {tpls.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
      </select>
      {order.map((p, i) => (
        <input key={p} value={vals[i] || ''} onChange={e => setVals(v => { const n = [...v]; n[i] = e.target.value; return n })}
          placeholder={p} className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs" dir="rtl" />
      ))}
      {preview && <div className="rounded bg-white border border-gray-200 p-2 text-xs whitespace-pre-wrap text-gray-700">{preview}</div>}
      {err && <div className="text-xs text-red-600">{err}</div>}
      <button type="button" onClick={send} disabled={!picked || sending} className="w-full rounded bg-brand-primary px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
        {ok ? 'נשלח ✓' : sending ? 'שולח…' : 'שלח תבנית'}
      </button>
    </div>
  )
}

function MessageBubble({ message }: { message: Message }) {
  const isOut = message.direction === 'out'
  const isTemplate = message.meta_message_type === 'template'
  const [showMeta, setShowMeta] = useState(false)
  const md = (message as any).metadata
  const sentByName = (md && typeof md === 'object' ? md.sent_by_name : null) as string | null
  const outLabel = sentByName || (isTemplate ? 'תבנית' : 'בוט')
  return (
    <div className={`wa-bubble ${isOut ? 'wa-out' : 'wa-in'}`}>
      {message.media_url && (
        <img src={message.media_url} alt="" className="rounded-lg mb-2 max-h-64 object-cover" />
      )}
      {(message.body || message.rendered_body) && <div className="whitespace-pre-wrap leading-relaxed">{message.body || message.rendered_body}</div>}
      {isTemplate && !message.body && !message.rendered_body && <div className="italic text-xs faint">[תבנית: {message.template_name}]</div>}
      <div className="wa-meta" style={{ justifyContent: isOut ? 'flex-end' : 'flex-start' }}>
        {isOut && <span style={{ fontWeight: 600 }}>{outLabel}</span>}
        {isTemplate && <span className="pill pill-blue" style={{ fontSize: 10, padding: '0 6px' }}>תבנית</span>}
        <span className="num">{fmtTime(message.created_at)}</span>
        {isOut && <Check className="h-3 w-3" style={{ color: 'var(--blue)' }} />}
      </div>
      {message.ai_metadata && Object.keys(message.ai_metadata).length > 0 && (
        <button
          type="button"
          onClick={() => setShowMeta(s => !s)}
          className="mt-1 text-[10px] faint hover:opacity-100 inline-flex items-center gap-0.5"
        >
          <ChevronDown className={`h-3 w-3 transition-transform ${showMeta ? 'rotate-180' : ''}`} />
          פרטי AI
        </button>
      )}
      {showMeta && message.ai_metadata && (
        <pre className="mt-1 max-h-48 overflow-auto rounded bg-black/5 p-2 text-[10px] whitespace-pre-wrap">
          {JSON.stringify(message.ai_metadata, null, 2)}
        </pre>
      )}
    </div>
  )
}

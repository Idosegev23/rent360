'use client'

import { useEffect, useState, useCallback, type ReactNode } from 'react'
import {
  Send, Building2, Users, ShieldOff, Loader2, AlertCircle, RefreshCw,
  CheckCircle2, Trash2, Upload, Gauge,
} from 'lucide-react'
import Topbar from '../../components/shell/Topbar'

type Mode = 'landlord' | 'renter'

type Counters = { sentToday: number; dailyCap: number; remaining: number; minScore?: number }
type Received = { today: number; week: number }

type QueueRow = {
  id: string                 // propertyId (landlord) | matchId (renter) — selection + manual-send key
  title: string
  subtitle: string
  phone: string
  score?: number
  coverImage: string | null
  received: Received
}

type SendResult = { id: string; status: 'sent' | 'skipped'; reason?: string }

export default function OutreachPage() {
  const [tab, setTab] = useState<'landlord' | 'renter' | 'suppression'>('landlord')
  const [refreshKey, setRefreshKey] = useState(0)

  return (
    <>
      <Topbar
        crumb="בית · שליחה"
        title="מרכז שליחה"
        action={
          <button type="button" className="btn btn-brand" onClick={() => setRefreshKey(k => k + 1)}>
            <RefreshCw size={14} /> רענן
          </button>
        }
      />
      <div className="page-wrap">
        <div className="flex gap-2 mb-4 border-b" style={{ borderColor: 'var(--line)' }}>
          {([
            { id: 'landlord' as const, label: 'גיוס בעלי דירות', icon: Building2 },
            { id: 'renter' as const, label: 'המלצות לשוכרים', icon: Users },
            { id: 'suppression' as const, label: 'חסומים ומגבלות', icon: ShieldOff },
          ]).map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 -mb-px text-sm font-medium border-b-2 transition ${
                tab === t.id ? 'border-brand-primary text-brand-primary' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <span className="inline-flex items-center gap-1.5"><t.icon className="h-4 w-4" />{t.label}</span>
            </button>
          ))}
        </div>

        {tab === 'landlord' && <OutreachQueue mode="landlord" refreshKey={refreshKey} />}
        {tab === 'renter' && <OutreachQueue mode="renter" refreshKey={refreshKey} />}
        {tab === 'suppression' && <SuppressionManager refreshKey={refreshKey} />}
      </div>
    </>
  )
}

// ---------- shared queue (landlord + renter) -------------------------------

const ENDPOINTS = {
  landlord: { queue: '/api/v1/outreach/landlord-queue', batch: '/api/v1/outreach/landlord-send-batch', single: '/api/v1/outreach/send-initial', key: 'propertyId' as const, idsKey: 'propertyIds' as const },
  renter: { queue: '/api/v1/outreach/renter-queue', batch: '/api/v1/outreach/renter-send-batch', single: '/api/v1/outreach/notify-renter', key: 'matchId' as const, idsKey: 'matchIds' as const },
}

function OutreachQueue({ mode, refreshKey }: { mode: Mode; refreshKey: number }) {
  const ep = ENDPOINTS[mode]
  const [rows, setRows] = useState<QueueRow[]>([])
  const [counters, setCounters] = useState<Counters | null>(null)
  const [templateApproved, setTemplateApproved] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [sending, setSending] = useState(false)
  const [results, setResults] = useState<{ sent: number; skipped: number; details: SendResult[] } | null>(null)
  const [busyRow, setBusyRow] = useState<string | null>(null)
  const [genProgress, setGenProgress] = useState<string | null>(null)
  // landlord filters
  const [city, setCity] = useState('')
  // landlord: which row's template preview is open + batch template preference
  const [previewRow, setPreviewRow] = useState<string | null>(null)
  const [prefer, setPrefer] = useState<'personalized' | 'basic'>('personalized')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setResults(null)
    try {
      const params = new URLSearchParams()
      if (mode === 'landlord' && city.trim()) params.set('city', city.trim())
      const res = await fetch(`${ep.queue}?${params.toString()}`)
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data?.error?.message || data?.error?.code || 'load failed')
      const mapped: QueueRow[] = (data.rows || []).map((r: any) => mode === 'landlord'
        ? {
            id: r.propertyId,
            title: r.contactName || 'ללא שם',
            subtitle: [r.location, r.rooms != null ? `${r.rooms} חד׳` : null, r.price != null ? `₪${Number(r.price).toLocaleString('he-IL')}` : null].filter(Boolean).join(' · '),
            phone: r.phone,
            coverImage: r.coverImage,
            received: r.received || { today: 0, week: 0 },
          }
        : {
            id: r.matchId,
            title: r.renterName || 'ללא שם',
            subtitle: [r.location, r.rooms != null ? `${r.rooms} חד׳` : null, r.price != null ? `₪${Number(r.price).toLocaleString('he-IL')}` : null].filter(Boolean).join(' · '),
            phone: r.phone,
            score: typeof r.score === 'number' ? r.score : undefined,
            coverImage: r.coverImage,
            received: r.received || { today: 0, week: 0 },
          })
      setRows(mapped)
      setCounters(data.counters || null)
      setTemplateApproved(mode === 'renter' ? data.templateApproved !== false : true)
      setSelected(new Set(mapped.map(m => m.id)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'load failed')
    } finally {
      setLoading(false)
    }
  }, [ep.queue, mode, city])

  useEffect(() => { load() }, [load, refreshKey])

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  const allSelected = rows.length > 0 && selected.size === rows.length
  // Select the next N currently-unselected rows (so you can send in waves of 50, not 250 at once).
  function selectNextN(n: number) {
    setSelected(prev => {
      const next = new Set(prev)
      let added = 0
      for (const r of rows) { if (added >= n) break; if (!next.has(r.id)) { next.add(r.id); added++ } }
      return next
    })
  }
  function selectWhere(pred: (r: QueueRow) => boolean) {
    setSelected(new Set(rows.filter(pred).map(r => r.id)))
  }

  async function sendBatch() {
    if (sending || selected.size === 0) return
    const ids = rows.filter(r => selected.has(r.id)).map(r => r.id)
    if (!window.confirm(`לשלוח ל-${ids.length} נמענים? (אצווה — כפופה לתקרה היומית)`)) return
    setSending(true)
    setResults(null)
    setError(null)
    try {
      // Phase 1 — landlord personalized: generate the personal sentence for ALL selected
      // properties first (in chunks, to avoid the function timeout), then send. The send
      // then uses the rich template wherever the generated hook is strong enough.
      if (mode === 'landlord' && prefer === 'personalized') {
        let remaining = [...ids]
        const total = ids.length
        while (remaining.length) {
          setGenProgress(`מייצר משפטים פרסונליים… ${total - remaining.length}/${total}`)
          const gr = await fetch('/api/v1/outreach/landlord-generate-batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ propertyIds: remaining }),
          })
          const gd = await gr.json()
          if (!gr.ok || gd.error) throw new Error(gd?.error?.message || gd?.error?.code || 'generation failed')
          remaining = Array.isArray(gd.remaining) ? gd.remaining : []
        }
        setGenProgress(`שולח ${total} הודעות…`)
      }

      const res = await fetch(ep.batch, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [ep.idsKey]: ids, ...(mode === 'landlord' ? { prefer } : {}) }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data?.error?.message || data?.error?.code || 'send failed')
      setResults({ sent: data.sent || 0, skipped: data.skipped || 0, details: data.results || [] })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'send failed')
    } finally {
      setSending(false)
      setGenProgress(null)
    }
  }

  // Manual single send — bypasses rate caps (opt-out still enforced server-side), shows an advisory confirm.
  async function sendOne(row: QueueRow, template?: 'basic' | 'rich') {
    if (busyRow) return
    const warn: string[] = []
    if (row.received.today > 0) warn.push(`הנמען כבר קיבל ${row.received.today} הודעות היום`)
    if (counters && counters.remaining <= 0) warn.push('התקרה היומית נוצלה (ידני עוקף)')
    const msg = warn.length ? `${warn.join(' · ')}.\nלשלוח בכל זאת?` : 'לשלוח לנמען זה?'
    if (!window.confirm(msg)) return
    setBusyRow(row.id)
    try {
      const res = await fetch(ep.single, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [ep.key]: row.id, ...(template ? { template } : {}) }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data?.error?.message || data?.error?.code || 'send failed')
      setRows(prev => prev.filter(r => r.id !== row.id))
      setSelected(prev => { const n = new Set(prev); n.delete(row.id); return n })
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'שליחה נכשלה')
    } finally {
      setBusyRow(null)
    }
  }

  return (
    <>
      {mode === 'renter' && !templateApproved && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 mb-3 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>התבנית <code className="font-mono">renter_match_alert_v1</code> עדיין ממתינה לאישור Meta — שליחה לשוכרים תיחסם עד שתאושר. אפשר לסקור את התור בינתיים.</span>
        </div>
      )}

      <CountersBar counters={counters} />

      <div className="flex flex-wrap items-center gap-2 my-3">
        {mode === 'landlord' && (
          <input
            type="text"
            placeholder="סינון לפי עיר…"
            value={city}
            onChange={e => setCity(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') load() }}
            className="rounded-md border border-brand-border bg-white px-3 py-1.5 text-sm w-48"
          />
        )}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <button type="button" onClick={() => setSelected(new Set(rows.map(r => r.id)))} className="px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-700">בחר הכל</button>
          <button type="button" onClick={() => setSelected(new Set())} className="px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-700">נקה</button>
          <button type="button" onClick={() => selectNextN(50)} className="px-2 py-1 rounded bg-brand-primary/10 text-brand-primary font-medium hover:bg-brand-primary/20" title="בחר 50 נוספים שטרם נבחרו">+50 הבאים</button>
          <button type="button" onClick={() => selectWhere(r => (r.received?.week || 0) === 0)} className="px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-700" title="מי שלא נשלחה אליו הודעה בשבוע האחרון">שלא נוצר קשר</button>
          <button type="button" onClick={() => selectWhere(r => (r.received?.week || 0) > 0)} className="px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-700" title="מי שכבר נשלחה אליו הודעה">נשלח בעבר</button>
          <span className="text-gray-500" title={`${selected.size} מתוך ${rows.length} מסומנים`}>· נבחרו: <strong>{selected.size}</strong> / {rows.length}</span>
        </div>
        <div className="flex-1" />
        {mode === 'landlord' && (
          <select
            value={prefer}
            onChange={e => setPrefer(e.target.value === 'basic' ? 'basic' : 'personalized')}
            className="rounded-md border border-brand-border bg-white px-2 py-1.5 text-sm"
            title="איזו תבנית לשלוח באצווה"
          >
            <option value="personalized">פרסונלי (נפילה לבסיסי)</option>
            <option value="basic">בסיסי בלבד</option>
          </select>
        )}
        <button
          type="button"
          onClick={sendBatch}
          disabled={sending || selected.size === 0 || (mode === 'renter' && !templateApproved)}
          className="btn btn-brand disabled:opacity-50"
        >
          {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          {sending ? (genProgress || 'שולח…') : `שלח אצווה (${selected.size})`}
        </button>
      </div>

      {results && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 mb-3">
          <div className="font-medium mb-1"><CheckCircle2 className="inline h-4 w-4 ml-1" />נשלחו {results.sent} · דולגו {results.skipped}</div>
          {results.details.filter(d => d.status === 'skipped').slice(0, 8).map((d, i) => (
            <div key={i} className="text-xs text-emerald-800/80">• {d.reason}</div>
          ))}
        </div>
      )}

      {loading && <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-brand-primary" /></div>}
      {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"><AlertCircle className="inline h-4 w-4 ml-1" />{error}</div>}

      {!loading && !error && rows.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <CheckCircle2 className="mx-auto h-10 w-10 mb-2 text-gray-300" />
          <p>אין כרגע נמענים כשירים בתור.</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-2">
        {rows.map(r => (
          <div key={r.id} className="rounded-lg border border-brand-border bg-white">
            <div className="p-3 flex flex-wrap items-center gap-3">
              <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} className="h-4 w-4 shrink-0" />
              {r.coverImage
                ? <img src={r.coverImage} alt="" className="h-12 w-12 rounded-md object-cover shrink-0" />
                : <div className="h-12 w-12 rounded-md bg-gray-100 shrink-0" />}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-900 truncate">{r.title}</span>
                  {r.score != null && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-700">{Math.round(r.score)}% התאמה</span>}
                </div>
                <div className="text-xs text-gray-500 truncate">{r.subtitle || r.phone}</div>
              </div>
              <ReceivedBadge received={r.received} />
              {mode === 'landlord' && (
                <button
                  type="button"
                  onClick={() => setPreviewRow(previewRow === r.id ? null : r.id)}
                  className="rounded-md border border-brand-border bg-white px-2.5 py-1.5 text-xs hover:bg-gray-50 shrink-0"
                >
                  {previewRow === r.id ? 'סגור' : 'תצוגה'}
                </button>
              )}
              <button
                type="button"
                onClick={() => sendOne(r)}
                disabled={busyRow === r.id || (mode === 'renter' && !templateApproved)}
                title="שליחה ידנית (עוקפת תקרה, לא opt-out)"
                className="rounded-md border border-brand-border bg-white px-2.5 py-1.5 text-xs hover:bg-gray-50 inline-flex items-center gap-1 disabled:opacity-50 shrink-0"
              >
                {busyRow === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                שלח
              </button>
            </div>
            {mode === 'landlord' && previewRow === r.id && (
              <LandlordPreview propertyId={r.id} busy={busyRow === r.id} onSend={(tpl) => sendOne(r, tpl)} />
            )}
          </div>
        ))}
      </div>
    </>
  )
}

type PropertyDetails = {
  type: string | null
  condition: string | null
  sqm: number | null
  floor: number | null
  price: number | null
  rooms: number | null
  neighborhood: string | null
  city: string | null
  source: string | null
  link: string | null
  description: string | null
  createdAt: string | null
}

type PreviewData = {
  eligible: boolean
  reason?: string
  hook?: string | null
  hookConfidence?: string | null
  footer?: string
  buttons?: string[]
  basic?: { header: string; body: string } | null
  rich?: { header: string; body: string } | null
  details?: PropertyDetails | null
}

const SOURCE_LABELS: Record<string, string> = {
  manual_employee: 'הוזן ידנית', manual: 'הוזן ידנית', yad2: 'יד2', whatsapp: 'וואטסאפ', sheet_import: 'ייבוא גיליון',
}
const CONDITION_LABELS: Record<string, string> = {
  renovated: 'משופץ', good: 'טוב', 'needs-work': 'דורש שיפוץ', new: 'חדש',
}
function addedAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return 'היום'
  if (days === 1) return 'אתמול'
  if (days < 30) return `לפני ${days} ימים`
  const months = Math.floor(days / 30)
  return months < 12 ? `לפני ${months} חודשים` : `לפני ${Math.floor(months / 12)} שנים`
}

function PropertyDetailsBlock({ d }: { d: PropertyDetails }) {
  const chips: Array<[string, string]> = []
  if (d.type) chips.push(['סוג', d.type])
  if (d.rooms != null) chips.push(['חדרים', String(d.rooms)])
  if (d.sqm != null) chips.push(['מ״ר', String(d.sqm)])
  if (d.floor != null) chips.push(['קומה', String(d.floor)])
  if (d.price != null) chips.push(['מחיר', '₪' + Number(d.price).toLocaleString('he-IL')])
  if (d.condition) chips.push(['מצב', CONDITION_LABELS[d.condition] || d.condition])
  if (d.neighborhood) chips.push(['שכונה', d.neighborhood])
  return (
    <div className="rounded-lg border border-brand-border bg-gray-50 p-3 mb-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-sm font-semibold text-gray-800">פרטי הנכס</span>
        <span className="text-xs text-gray-500">
          {d.source ? (SOURCE_LABELS[d.source] || d.source) : ''}{d.createdAt ? ` · נוסף ${addedAgo(d.createdAt)}` : ''}
        </span>
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {chips.map(([k, v]) => (
            <span key={k} className="rounded-md border border-gray-200 bg-white px-2 py-0.5 text-xs text-gray-700"><span className="text-gray-400">{k}:</span> {v}</span>
          ))}
        </div>
      )}
      {d.description && <p className="text-xs text-gray-600 whitespace-pre-wrap">{d.description.slice(0, 240)}{d.description.length > 240 ? '…' : ''}</p>}
      {d.link && <a href={d.link} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-xs text-brand-primary hover:underline">למודעה המקורית ↗</a>}
    </div>
  )
}

function LandlordPreview({ propertyId, busy, onSend }: { propertyId: string; busy: boolean; onSend: (tpl: 'basic' | 'rich') => void }) {
  const [data, setData] = useState<PreviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [regenerating, setRegenerating] = useState(false)

  const load = useCallback((regen: boolean) => {
    if (regen) setRegenerating(true); else setLoading(true)
    return fetch(`/api/v1/outreach/landlord-preview?propertyId=${propertyId}${regen ? '&regenerate=1' : ''}`)
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => setData({ eligible: false, reason: 'load_failed' }))
      .finally(() => { setLoading(false); setRegenerating(false) })
  }, [propertyId])

  useEffect(() => { load(false) }, [load])

  if (loading) return <div className="border-t border-brand-border p-3 text-sm text-gray-500"><Loader2 className="inline h-4 w-4 animate-spin ml-1" /> טוען תצוגה…</div>
  if (!data) return null
  if (!data.eligible) return <div className="border-t border-brand-border p-3 text-sm text-amber-700">לא ניתן לשלוח לנכס זה: {data.reason}</div>

  const confTone = data.hookConfidence === 'high' ? 'bg-emerald-100 text-emerald-700'
    : data.hookConfidence === 'medium' ? 'bg-amber-100 text-amber-700'
    : 'bg-gray-100 text-gray-600'

  return (
    <div className="border-t border-brand-border p-3">
      {data.details && <PropertyDetailsBlock d={data.details} />}
      <div className="flex items-center justify-between gap-2 mb-2 text-xs text-gray-500">
        <span>המשפט האישי נוצר ע״י AI מהתמונות/התיאור</span>
        <button
          type="button"
          onClick={() => load(true)}
          disabled={regenerating}
          className="inline-flex items-center gap-1 rounded-md border border-brand-border bg-white px-2 py-1 hover:bg-gray-50 disabled:opacity-50"
        >
          {regenerating ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} צור משפט מחדש
        </button>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <TemplateCard
          title="בסיסית"
          header={data.basic?.header || ''}
          body={data.basic?.body || ''}
          footer={data.footer}
          buttons={data.buttons}
          action={<button type="button" disabled={busy} onClick={() => onSend('basic')} className="btn btn-brand disabled:opacity-50" style={{ fontSize: 12 }}>שלח בסיסית</button>}
        />
        {data.rich ? (
          <TemplateCard
            title={<span className="inline-flex items-center gap-1.5">פרסונלית {data.hookConfidence && <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${confTone}`}>ביטחון: {data.hookConfidence}</span>}</span>}
            header={data.rich.header}
            body={data.rich.body}
            footer={data.footer}
            buttons={data.buttons}
            action={<button type="button" disabled={busy} onClick={() => onSend('rich')} className="btn btn-brand disabled:opacity-50" style={{ fontSize: 12 }}>שלח פרסונלית</button>}
          />
        ) : (
          <div className="rounded-lg border border-dashed border-gray-300 p-3 text-sm text-gray-400 flex items-center justify-center text-center">אין משפט אישי לנכס זה — רק בסיסית זמינה</div>
        )}
      </div>
    </div>
  )
}

function TemplateCard({ title, header, body, footer, buttons, action }: { title: ReactNode; header: string; body: string; footer?: string | undefined; buttons?: string[] | undefined; action: ReactNode }) {
  return (
    <div className="rounded-lg border border-brand-border bg-gray-50 p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-sm font-semibold text-gray-800">{title}</div>
        {action}
      </div>
      <div className="rounded-lg bg-white border border-gray-200 p-3 text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
        <div className="font-bold mb-1">{header}</div>
        {body}
        {footer && <div className="text-xs text-gray-400 mt-2">{footer}</div>}
        {buttons && buttons.length > 0 && (
          <div className="flex gap-1.5 mt-2 flex-wrap">
            {buttons.map((b, i) => <span key={i} className="rounded-md border border-brand-primary/40 text-brand-primary px-2 py-0.5 text-xs">{b}</span>)}
          </div>
        )}
      </div>
    </div>
  )
}

function CountersBar({ counters }: { counters: Counters | null }) {
  if (!counters) return null
  const pct = counters.dailyCap > 0 ? Math.min(100, Math.round((counters.sentToday / counters.dailyCap) * 100)) : 0
  return (
    <div className="rounded-lg border border-brand-border bg-white p-3 flex flex-wrap items-center gap-4 text-sm">
      <span className="inline-flex items-center gap-1.5 font-medium text-gray-700"><Gauge className="h-4 w-4" />מגבלות היום</span>
      <span className="text-gray-600">נשלחו <b>{counters.sentToday}</b> / {counters.dailyCap}</span>
      <span className="text-gray-600">נותרו <b>{counters.remaining}</b></span>
      {counters.minScore != null && <span className="text-gray-500 text-xs">סף ציון: {counters.minScore}</span>}
      <div className="flex-1 min-w-[120px] h-2 rounded-full bg-gray-100 overflow-hidden">
        <div className="h-full bg-brand-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function ReceivedBadge({ received }: { received: Received }) {
  const tone = received.today > 0 ? 'bg-orange-50 text-orange-700' : received.week > 0 ? 'bg-amber-50 text-amber-700' : 'bg-gray-50 text-gray-500'
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] shrink-0 ${tone}`} title="הודעות שיצאו לנמען">
      📩 {received.week} (7י׳) · {received.today} היום
    </span>
  )
}

// ---------- suppression / blocklist ----------------------------------------

type SuppressionRow = { id: string; phone: string; reason: string | null; source: string; created_at: string }

const SOURCE_LABEL: Record<string, string> = {
  manual: 'ידני', button: 'כפתור הסרה', stopword: 'מילת עצירה', ai_tool: 'סוכן AI',
}

function SuppressionManager({ refreshKey }: { refreshKey: number }) {
  const [rows, setRows] = useState<SuppressionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [paste, setPaste] = useState('')
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/outreach/suppression?q=${encodeURIComponent(q)}`)
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data?.error?.message || 'load failed')
      setRows(data.rows || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'load failed')
    } finally {
      setLoading(false)
    }
  }, [q])

  useEffect(() => { load() }, [load, refreshKey])

  async function doImport() {
    if (importing || !paste.trim()) return
    setImporting(true)
    setImportMsg(null)
    try {
      const res = await fetch('/api/v1/outreach/suppression', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phones: paste, reason: 'ייבוא רשימת חסומים' }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data?.error?.message || 'import failed')
      setImportMsg(`נוספו ${data.added} · כפולים ${data.duplicates} · לא תקינים ${data.invalid}`)
      setPaste('')
      await load()
    } catch (err) {
      setImportMsg(err instanceof Error ? err.message : 'ייבוא נכשל')
    } finally {
      setImporting(false)
    }
  }

  async function remove(id: string) {
    if (!window.confirm('להסיר מהרשימה השחורה? (הנמען יוכל לקבל הודעות שוב)')) return
    try {
      const res = await fetch('/api/v1/outreach/suppression', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data?.error?.message || 'delete failed')
      setRows(prev => prev.filter(r => r.id !== id))
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'הסרה נכשלה')
    }
  }

  return (
    <>
      <div className="rounded-lg border border-brand-border bg-white p-4 mb-4">
        <div className="font-medium text-gray-800 mb-2 inline-flex items-center gap-1.5"><Upload className="h-4 w-4" />ייבוא רשימת חסומים</div>
        <p className="text-xs text-gray-500 mb-2">הדבק מספרי טלפון (שורה לכל מספר, או מופרדים בפסיק). מנורמלים ומסוננים מכפילויות אוטומטית.</p>
        <textarea
          value={paste}
          onChange={e => setPaste(e.target.value)}
          rows={4}
          placeholder={'050-1234567\n0529876543\n+972541112233'}
          className="w-full rounded-md border border-brand-border bg-white px-3 py-2 text-sm font-mono"
        />
        <div className="flex items-center gap-3 mt-2">
          <button type="button" onClick={doImport} disabled={importing || !paste.trim()} className="btn btn-brand disabled:opacity-50">
            {importing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} ייבא
          </button>
          {importMsg && <span className="text-sm text-gray-600">{importMsg}</span>}
        </div>
      </div>

      <div className="flex items-center gap-2 mb-3">
        <input
          type="search"
          placeholder="חיפוש לפי טלפון…"
          value={q}
          onChange={e => setQ(e.target.value)}
          className="flex-1 rounded-md border border-brand-border bg-white px-3 py-1.5 text-sm"
        />
        <span className="text-xs text-gray-500">{rows.length} חסומים</span>
      </div>

      {loading && <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-brand-primary" /></div>}
      {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"><AlertCircle className="inline h-4 w-4 ml-1" />{error}</div>}
      {!loading && !error && rows.length === 0 && (
        <div className="text-center py-10 text-gray-500"><ShieldOff className="mx-auto h-10 w-10 mb-2 text-gray-300" /><p>הרשימה ריקה.</p></div>
      )}

      <div className="grid grid-cols-1 gap-1.5">
        {rows.map(r => (
          <div key={r.id} className="rounded-md border border-brand-border bg-white px-3 py-2 flex items-center gap-3 text-sm">
            <span className="font-mono text-gray-800">{r.phone}</span>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">{SOURCE_LABEL[r.source] || r.source}</span>
            {r.reason && <span className="text-xs text-gray-500 truncate">{r.reason}</span>}
            <div className="flex-1" />
            <button type="button" onClick={() => remove(r.id)} className="text-red-500 hover:text-red-700" title="הסר מהרשימה">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </>
  )
}

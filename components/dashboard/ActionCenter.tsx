'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Flame, Coins, Clock, CheckCircle2, Heart, ChevronLeft, RefreshCw, Check, CheckSquare, CalendarDays } from 'lucide-react'

type Item = {
  thread_id?: string
  property_id?: string
  label: string
  sublabel?: string
  note?: string
  since?: string | null
  badge?: string
  href: string
}
type Lane = { count: number; items: Item[] }
type LaneKey = 'my_tasks' | 'viewings_to_log' | 'hot_leads' | 'price_objections' | 'callbacks_due' | 'approved_to_send' | 'renter_interests'
type Data = { generated_at: string; total: number; lanes: Record<LaneKey, Lane> }

const LANES: { key: LaneKey; title: string; short: string; sub: string; icon: any; color: string; bg: string }[] = [
  { key: 'my_tasks', title: 'המשימות שלי', short: 'משימות', sub: 'משימות פתוחות שלך', icon: CheckSquare, color: '#7c3aed', bg: 'rgba(124,58,237,0.08)' },
  { key: 'viewings_to_log', title: 'צפיות לתיעוד', short: 'צפיות', sub: 'צפיות שעברו — לתעד פידבק', icon: CalendarDays, color: '#0891b2', bg: 'rgba(8,145,178,0.08)' },
  { key: 'callbacks_due', title: 'לחזור היום', short: 'לחזור', sub: 'ביקשו שנחזור', icon: Clock, color: '#1d4ed8', bg: 'rgba(37,99,235,0.08)' },
  { key: 'hot_leads', title: 'לסגירה', short: 'לסגירה', sub: 'התעניינו ולא אישרו', icon: Flame, color: '#c2410c', bg: 'rgba(234,88,12,0.08)' },
  { key: 'price_objections', title: 'מו״מ עמלה', short: 'מו״מ', sub: 'מתלבטים על המחיר', icon: Coins, color: '#a16207', bg: 'rgba(202,138,4,0.08)' },
  { key: 'renter_interests', title: 'שוכרים שהביעו עניין', short: 'עניין', sub: 'ממתינים לטיפול', icon: Heart, color: '#be185d', bg: 'rgba(219,39,119,0.08)' },
  { key: 'approved_to_send', title: 'אושרו — לשלוח לשוכרים', short: 'לשלוח', sub: 'יש שוכרים מתאימים', icon: CheckCircle2, color: '#15803d', bg: 'rgba(22,163,74,0.08)' },
]
const LANE_BY_KEY = Object.fromEntries(LANES.map(l => [l.key, l])) as Record<LaneKey, typeof LANES[number]>
// Priority order for the compact "top actions" merge (most time-sensitive first).
const PRIORITY: LaneKey[] = ['my_tasks', 'viewings_to_log', 'callbacks_due', 'hot_leads', 'price_objections', 'renter_interests', 'approved_to_send']

function ago(iso?: string | null): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const mins = Math.round((Date.now() - then) / 60000)
  if (mins < 1) return 'עכשיו'
  if (mins < 60) return `לפני ${mins} ד׳`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `לפני ${hrs} ש׳`
  return `לפני ${Math.round(hrs / 24)} ימים`
}

function useActionData() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  async function load() {
    setLoading(true); setError(false)
    try {
      const r = await fetch('/api/v1/action-center', { cache: 'no-store' })
      if (!r.ok) throw new Error()
      setData(await r.json())
    } catch { setError(true) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])
  return { data, loading, error, load }
}

export default function ActionCenter({ variant = 'compact' }: { variant?: 'compact' | 'full' }) {
  const { data, loading, error, load } = useActionData()
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  async function dismiss(threadId?: string) {
    if (!threadId) return
    setDismissed(s => { const n = new Set(s); n.add(threadId); return n })
    try { await fetch('/api/v1/action-center/dismiss', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ thread_id: threadId }) }) } catch {/* optimistic */}
  }
  return variant === 'full'
    ? <FullView data={data} loading={loading} error={error} reload={load} dismissed={dismissed} onDismiss={dismiss} />
    : <CompactView data={data} loading={loading} error={error} reload={load} dismissed={dismissed} onDismiss={dismiss} />
}

type ViewProps = { data: Data | null; loading: boolean; error: boolean; reload: () => void; dismissed: Set<string>; onDismiss: (threadId?: string) => void }

function DoneButton({ threadId, onDismiss }: { threadId?: string | undefined; onDismiss: (t?: string) => void }) {
  if (!threadId) return null
  return (
    <button
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDismiss(threadId) }}
      title="בוצע — הסר מהרשימה"
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: 6, border: '1px solid var(--line)', background: 'var(--paper)', color: 'var(--ink-4)', cursor: 'pointer', flexShrink: 0 }}
    >
      <Check size={13} />
    </button>
  )
}

/* ---------------- Compact (dashboard hero) ---------------- */
function CompactView({ data, loading, error, reload, dismissed, onDismiss }: ViewProps) {
  const top: (Item & { lane: LaneKey })[] = []
  if (data) for (const key of PRIORITY) for (const it of data.lanes[key].items) if (!it.thread_id || !dismissed.has(it.thread_id)) top.push({ ...it, lane: key })
  const top3 = top.slice(0, 3)
  const activeChips = data ? LANES.filter(l => data.lanes[l.key].count > 0) : []

  return (
    <section dir="rtl" className="surface-card" style={{ marginBottom: 24, padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: data && data.total > 0 ? '1px solid var(--line)' : 'none' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <h2 style={{ fontSize: 17, fontWeight: 800, color: 'var(--ink)', margin: 0 }}>מה לעשות עכשיו</h2>
          {data && data.total > 0 && <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{data.total} ממתינות</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {data && data.total > 0 && <Link href="/action" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--brand)', textDecoration: 'none' }}>כל הפעולות →</Link>}
          <button onClick={reload} disabled={loading} title="רענון" style={{ display: 'inline-flex', color: 'var(--ink-4)', background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}>
            <RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          </button>
        </div>
      </div>

      {error && <div style={{ padding: '12px 16px', fontSize: 13, color: 'var(--ink-3)' }}>לא נטען. <button onClick={reload} style={{ color: 'var(--brand)', background: 'none', border: 'none', cursor: 'pointer' }}>נסה שוב</button></div>}
      {loading && !data && <div style={{ padding: 16, color: 'var(--ink-4)', fontSize: 13 }}>טוען…</div>}

      {data && data.total === 0 && !loading && (
        <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--ink-3)', fontSize: 13 }}>
          <CheckCircle2 size={16} style={{ color: 'var(--brand)' }} /> הכל מטופל — אין פעולות פתוחות כרגע.
        </div>
      )}

      {data && data.total > 0 && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '12px 16px' }}>
            {activeChips.map(l => {
              const Icon = l.icon
              return (
                <Link key={l.key} href="/action" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 999, background: l.bg, color: l.color, fontSize: 12.5, fontWeight: 700, textDecoration: 'none', border: `1px solid ${l.color}22` }}>
                  <Icon size={13} /> {l.short}
                  <span style={{ background: '#fff', borderRadius: 999, minWidth: 18, height: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, padding: '0 5px' }}>{data.lanes[l.key].count}</span>
                </Link>
              )
            })}
          </div>
          <div style={{ borderTop: '1px solid var(--line)' }}>
            {top3.map((it, i) => {
              const lane = LANE_BY_KEY[it.lane]; const Icon = lane.icon
              return (
                <Link key={i} href={it.href} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: i < top3.length - 1 ? '1px solid var(--line)' : 'none', textDecoration: 'none', color: 'inherit' }}>
                  <span style={{ display: 'inline-flex', width: 26, height: 26, borderRadius: 7, background: lane.bg, color: lane.color, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon size={14} /></span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.label}</div>
                    {(it.sublabel || it.badge) && <div style={{ fontSize: 11.5, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.badge || it.sublabel}</div>}
                  </div>
                  {it.since && <span style={{ fontSize: 11, color: 'var(--ink-4)', flexShrink: 0 }}>{ago(it.since)}</span>}
                  <DoneButton threadId={it.thread_id} onDismiss={onDismiss} />
                  <ChevronLeft size={15} style={{ color: 'var(--ink-4)', flexShrink: 0 }} />
                </Link>
              )
            })}
          </div>
        </>
      )}
      <style>{`@keyframes spin { from { transform: rotate(0) } to { transform: rotate(360deg) } }`}</style>
    </section>
  )
}

/* ---------------- Full (dedicated /action page) ---------------- */
function FullView({ data, loading, error, reload, dismissed, onDismiss }: ViewProps) {
  return (
    <section style={{ marginBottom: 24 }} dir="rtl">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{data && data.total > 0 ? `${data.total} פעולות ממתינות` : 'הפעולות החשובות שלך, במקום אחד'}</div>
        <button onClick={reload} disabled={loading} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-3)', background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer' }}>
          <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} /> רענון
        </button>
      </div>

      {error && <div style={{ padding: 16, borderRadius: 12, border: '1px solid var(--line)', color: 'var(--ink-3)', fontSize: 13 }}>לא הצלחנו לטעון. <button onClick={reload} style={{ color: 'var(--brand)', background: 'none', border: 'none', cursor: 'pointer' }}>לנסות שוב</button></div>}
      {loading && !data && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>{[0, 1, 2].map(i => <div key={i} style={{ height: 140, borderRadius: 12, background: 'var(--paper-2, #f4f4f2)', border: '1px solid var(--line)' }} />)}</div>}

      {data && data.total === 0 && !loading && (
        <div style={{ padding: 24, borderRadius: 12, border: '1px dashed var(--line)', textAlign: 'center', color: 'var(--ink-3)' }}>
          <CheckCircle2 size={28} style={{ color: 'var(--brand)', marginBottom: 6 }} />
          <div style={{ fontWeight: 700, color: 'var(--ink-2)' }}>הכל מטופל ✦</div>
          <div style={{ fontSize: 12.5, marginTop: 2 }}>אין פעולות פתוחות כרגע.</div>
        </div>
      )}

      {data && data.total > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {LANES.map(lane => {
            const l = data.lanes[lane.key]
            if (!l || l.count === 0) return null
            const Icon = lane.icon
            return (
              <div key={lane.key} style={{ borderRadius: 16, border: '1px solid var(--line)', background: 'var(--paper)', overflow: 'hidden', borderInlineStart: `3px solid ${lane.color}` }}>
                {/* Wide, clearly-labelled header per category */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', background: lane.bg, borderBottom: '1px solid var(--line)' }}>
                  <span style={{ display: 'inline-flex', width: 38, height: 38, borderRadius: 10, background: '#fff', alignItems: 'center', justifyContent: 'center', color: lane.color, flexShrink: 0 }}><Icon size={19} /></span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: 16.5, color: 'var(--ink)' }}>{lane.title}</div>
                    <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{lane.sub}</div>
                  </div>
                  <span style={{ fontWeight: 800, fontSize: 15, color: lane.color, background: '#fff', borderRadius: 999, minWidth: 32, height: 32, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 11px', flexShrink: 0 }}>{l.count}</span>
                </div>
                {/* Items fill the wide container in responsive columns (thin separators via gap) */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))', gap: 1, background: 'var(--line)' }}>
                  {l.items.filter(it => !it.thread_id || !dismissed.has(it.thread_id)).map((it, i) => (
                    <Link key={i} href={it.href} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 16px', background: 'var(--paper)', textDecoration: 'none', color: 'inherit' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.label}</div>
                        {it.sublabel && <div style={{ fontSize: 12, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.sublabel}</div>}
                        {it.note && <div style={{ fontSize: 11.5, color: 'var(--ink-4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>“{it.note}”</div>}
                        <div style={{ display: 'flex', gap: 8, marginTop: 3 }}>
                          {it.badge && <span style={{ fontSize: 11, color: lane.color, fontWeight: 700 }}>{it.badge}</span>}
                          {it.since && <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>{ago(it.since)}</span>}
                        </div>
                      </div>
                      <DoneButton threadId={it.thread_id} onDismiss={onDismiss} />
                      <ChevronLeft size={16} style={{ color: 'var(--ink-4)', flexShrink: 0 }} />
                    </Link>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
      <style>{`@keyframes spin { from { transform: rotate(0) } to { transform: rotate(360deg) } }`}</style>
    </section>
  )
}

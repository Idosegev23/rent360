'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Flame, Coins, Clock, CheckCircle2, Heart, ChevronLeft, RefreshCw } from 'lucide-react'

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
type Data = {
  generated_at: string
  total: number
  lanes: {
    hot_leads: Lane
    price_objections: Lane
    callbacks_due: Lane
    approved_to_send: Lane
    renter_interests: Lane
  }
}

const LANES: { key: keyof Data['lanes']; title: string; sub: string; icon: any; color: string; bg: string }[] = [
  { key: 'hot_leads', title: 'לסגירה', sub: 'התעניינו ולא אישרו', icon: Flame, color: '#c2410c', bg: 'rgba(234,88,12,0.08)' },
  { key: 'price_objections', title: 'מו״מ עמלה', sub: 'מתלבטים על המחיר', icon: Coins, color: '#a16207', bg: 'rgba(202,138,4,0.08)' },
  { key: 'callbacks_due', title: 'לחזור היום', sub: 'ביקשו שנחזור', icon: Clock, color: '#1d4ed8', bg: 'rgba(37,99,235,0.08)' },
  { key: 'approved_to_send', title: 'אושרו — לשלוח לשוכרים', sub: 'יש שוכרים מתאימים', icon: CheckCircle2, color: '#15803d', bg: 'rgba(22,163,74,0.08)' },
  { key: 'renter_interests', title: 'שוכרים שהביעו עניין', sub: 'ממתינים לטיפול', icon: Heart, color: '#be185d', bg: 'rgba(219,39,119,0.08)' },
]

function ago(iso?: string | null): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const mins = Math.round((Date.now() - then) / 60000)
  if (mins < 1) return 'עכשיו'
  if (mins < 60) return `לפני ${mins} ד׳`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `לפני ${hrs} ש׳`
  const days = Math.round(hrs / 24)
  return `לפני ${days} ימים`
}

export default function ActionCenter() {
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

  return (
    <section style={{ marginBottom: 24 }} dir="rtl">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <h2 style={{ fontSize: 19, fontWeight: 800, color: 'var(--ink)', margin: 0 }}>מה לעשות עכשיו</h2>
          <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 2 }}>
            {data && data.total > 0 ? `${data.total} פעולות ממתינות` : 'הפעולות החשובות שלך, במקום אחד'}
          </div>
        </div>
        <button onClick={load} disabled={loading}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-3)', background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer' }}>
          <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} /> רענון
        </button>
      </div>

      {error && (
        <div style={{ padding: 16, borderRadius: 12, border: '1px solid var(--line)', color: 'var(--ink-3)', fontSize: 13 }}>
          לא הצלחנו לטעון כרגע. <button onClick={load} style={{ color: 'var(--brand)', background: 'none', border: 'none', cursor: 'pointer' }}>לנסות שוב</button>
        </div>
      )}

      {loading && !data && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {[0, 1, 2].map(i => <div key={i} style={{ height: 140, borderRadius: 12, background: 'var(--paper-2, #f4f4f2)', border: '1px solid var(--line)' }} />)}
        </div>
      )}

      {data && data.total === 0 && !loading && (
        <div style={{ padding: 24, borderRadius: 12, border: '1px dashed var(--line)', textAlign: 'center', color: 'var(--ink-3)' }}>
          <CheckCircle2 size={28} style={{ color: 'var(--brand)', marginBottom: 6 }} />
          <div style={{ fontWeight: 700, color: 'var(--ink-2)' }}>הכל מטופל ✦</div>
          <div style={{ fontSize: 12.5, marginTop: 2 }}>אין פעולות פתוחות כרגע. כשמשהו יזוז — זה יופיע כאן.</div>
        </div>
      )}

      {data && data.total > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12, alignItems: 'start' }}>
          {LANES.map(lane => {
            const l = data.lanes[lane.key]
            if (!l || l.count === 0) return null
            const Icon = lane.icon
            return (
              <div key={lane.key} style={{ borderRadius: 14, border: '1px solid var(--line)', background: 'var(--paper)', overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: lane.bg, borderBottom: '1px solid var(--line)' }}>
                  <span style={{ display: 'inline-flex', width: 30, height: 30, borderRadius: 8, background: '#fff', alignItems: 'center', justifyContent: 'center', color: lane.color, boxShadow: 'var(--sh-1, 0 1px 2px rgba(0,0,0,0.06))' }}>
                    <Icon size={16} />
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--ink)' }}>{lane.title}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{lane.sub}</div>
                  </div>
                  <span style={{ fontWeight: 800, fontSize: 14, color: lane.color, background: '#fff', borderRadius: 999, minWidth: 26, height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 8px' }}>{l.count}</span>
                </div>
                <div>
                  {l.items.map((it, i) => (
                    <Link key={i} href={it.href}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: i < l.items.length - 1 ? '1px solid var(--line)' : 'none', textDecoration: 'none', color: 'inherit' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.label}</div>
                        {it.sublabel && <div style={{ fontSize: 11.5, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.sublabel}</div>}
                        {it.note && <div style={{ fontSize: 11, color: 'var(--ink-4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>“{it.note}”</div>}
                        <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
                          {it.badge && <span style={{ fontSize: 10.5, color: lane.color, fontWeight: 700 }}>{it.badge}</span>}
                          {it.since && <span style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>{ago(it.since)}</span>}
                        </div>
                      </div>
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

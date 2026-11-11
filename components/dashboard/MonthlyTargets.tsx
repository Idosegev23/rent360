'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronRight, ChevronLeft, Loader2 } from 'lucide-react'

type Split = { deals: number; commission: number }
type Totals = { targetDeals: number; targetCommission: number; actualDeals: number; actualCommission: number; rent: Split; sale: Split }
type Row = Totals & { id: string; name: string }
type Data = { month: string; me: Row | null; company: Totals | null; agents: Row[]; salesTracked: boolean }

const ils = (n: number) => `₪${Math.round(n).toLocaleString('he-IL')}`
const pctOf = (actual: number, target: number) => (target > 0 ? Math.round((actual / target) * 100) : null)

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
}

function Bar({ pct }: { pct: number | null }) {
  const w = Math.min(100, pct ?? 0)
  return (
    <div style={{ height: 10, borderRadius: 999, background: 'var(--line, #e5e7eb)', overflow: 'hidden' }}>
      <div style={{ width: `${w}%`, height: '100%', background: (pct ?? 0) >= 100 ? 'var(--green, #16a34a)' : 'var(--brand, #2563eb)', transition: 'width .3s' }} />
    </div>
  )
}

/** One target block: deals + commission, each with actual / target / % / remaining, then the rent/sale split. */
function TargetBlock({ title, t, big }: { title: string; t: Totals; big?: boolean }) {
  const dealsPct = pctOf(t.actualDeals, t.targetDeals)
  const commPct = pctOf(t.actualCommission, t.targetCommission)
  const noTarget = t.targetDeals === 0 && t.targetCommission === 0
  return (
    <div>
      <div className="font-semibold mb-2" style={{ fontSize: big ? 17 : 15 }}>{title}</div>
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        <Metric label="עסקאות" actual={String(t.actualDeals)} target={t.targetDeals > 0 ? String(t.targetDeals) : null} pct={dealsPct} remaining={t.targetDeals > 0 ? `נשארו ${Math.max(0, t.targetDeals - t.actualDeals)}` : null} big={!!big} />
        <Metric label="דמי תיווך" actual={ils(t.actualCommission)} target={t.targetCommission > 0 ? ils(t.targetCommission) : null} pct={commPct} remaining={t.targetCommission > 0 ? `נשארו ${ils(Math.max(0, t.targetCommission - t.actualCommission))}` : null} big={!!big} />
      </div>
      {noTarget && <p className="text-xs faint mt-2">עוד לא הוגדר יעד לחודש הזה.</p>}
      <div className="flex flex-wrap gap-2 mt-3 text-xs">
        <span className="pill pill-green">השכרות: {t.rent.deals} עסקאות · {ils(t.rent.commission)}</span>
        <span className="pill pill-gray">מכירות: {t.sale.deals} עסקאות · {ils(t.sale.commission)}</span>
      </div>
    </div>
  )
}

function Metric({ label, actual, target, pct, remaining, big }: { label: string; actual: string; target: string | null; pct: number | null; remaining: string | null; big: boolean }) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="faint text-sm">{label}</span>
        {pct != null && <span className="num font-semibold" style={{ color: pct >= 100 ? 'var(--green, #16a34a)' : undefined }}>{pct}%</span>}
      </div>
      <div className="num" style={{ fontSize: big ? 30 : 24, fontWeight: 700, lineHeight: 1.1 }}>
        {actual}{target && <span className="faint" style={{ fontSize: big ? 18 : 15, fontWeight: 500 }}> / {target}</span>}
      </div>
      <div className="mt-2"><Bar pct={pct} /></div>
      {remaining && <div className="text-xs faint mt-1">{remaining}</div>}
    </div>
  )
}

export default function MonthlyTargets() {
  const [month, setMonth] = useState<string | null>(null)
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let on = true
    setLoading(true)
    fetch(`/api/v1/targets/overview${month ? `?month=${month}` : ''}`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then((d: Data) => { if (on) { setData(d); setFailed(false) } })
      .catch(() => { if (on) setFailed(true) })
      .finally(() => { if (on) setLoading(false) })
    return () => { on = false }
  }, [month])

  if (failed) return null // a header widget must never break the dashboard
  if (!data) return loading ? <div className="surface-card mb-5 flex justify-center" style={{ padding: 24 }}><Loader2 className="h-5 w-5 animate-spin text-brand-primary" /></div> : null
  if (!data.me && !data.company) return null

  const label = new Date(`${data.month}T12:00:00`).toLocaleDateString('he-IL', { month: 'long', year: 'numeric' })

  return (
    <section className="surface-card mb-5" style={{ padding: 20 }} dir="rtl">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display" style={{ fontSize: 20 }}>יעדים חודשיים · {label}</h2>
        <div className="flex items-center gap-1">
          {loading && <Loader2 className="h-4 w-4 animate-spin text-brand-primary" />}
          <button type="button" aria-label="חודש קודם" className="btn btn-ghost btn-sm" onClick={() => setMonth(shiftMonth(data.month, -1))}><ChevronRight size={16} /></button>
          <button type="button" aria-label="חודש הבא" className="btn btn-ghost btn-sm" onClick={() => setMonth(shiftMonth(data.month, 1))}><ChevronLeft size={16} /></button>
        </div>
      </div>

      {data.me && <TargetBlock title="היעד שלי" t={data.me} big />}

      {data.company && (
        <div className={data.me ? 'mt-6 pt-5' : ''} style={data.me ? { borderTop: '1px solid var(--line, #e5e7eb)' } : undefined}>
          <TargetBlock title="יעדי החברה" t={data.company} big={!data.me} />
          {data.agents.length > 0 && (
            <div className="mt-4 grid gap-2">
              {data.agents.map(a => {
                const p = pctOf(a.actualDeals, a.targetDeals)
                return (
                  <div key={a.id} className="flex flex-wrap items-center gap-3 text-sm">
                    <span className="font-medium" style={{ width: 90 }}>{a.name}</span>
                    <div style={{ flex: 1, minWidth: 140 }}><Bar pct={p} /></div>
                    <span className="num faint" style={{ minWidth: 150 }}>{a.actualDeals}{a.targetDeals > 0 ? ` / ${a.targetDeals}` : ''} עסקאות · {ils(a.actualCommission)}</span>
                    <span className="num font-semibold" style={{ width: 44, textAlign: 'end' }}>{p != null ? `${p}%` : '—'}</span>
                  </div>
                )
              })}
            </div>
          )}
          {!data.salesTracked && <p className="text-xs faint mt-3">מכירות עדיין לא מנוהלות במערכת, ולכן הפילוח שלהן מוצג כאפס.</p>}
        </div>
      )}
      <div className="mt-3 text-xs"><Link href="/board" className="text-brand-primary hover:underline">לוח בקרה ויעדים לכל יועץ</Link></div>
    </section>
  )
}

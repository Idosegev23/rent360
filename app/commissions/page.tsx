'use client'
import { useEffect, useState } from 'react'
import { Loader2, Check } from 'lucide-react'
import { useCan } from '../../lib/hooks/useMe'
import ExportButton from '../../components/ui/ExportButton'

type Item = { id: string; renter: string; property: string; amount: number | null; monthly_rent: number | null; status: string; tenancy_status: string }
type Totals = { expected: number; collected: number; pending: number }

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'ממתין', cls: 'pill-amber' },
  collected: { label: 'נגבה', cls: 'pill-green' },
  waived: { label: 'ויתור', cls: 'pill-gray' },
}
const ils = (n: number) => `₪${Math.round(n).toLocaleString('he-IL')}`

export default function CommissionsPage() {
  const [items, setItems] = useState<Item[]>([])
  const [totals, setTotals] = useState<Totals>({ expected: 0, collected: 0, pending: 0 })
  const [loading, setLoading] = useState(true)
  const [scope, setScope] = useState<'all' | 'mine'>('all')
  const canManage = useCan('commissions.manage') === true

  async function load() {
    setLoading(true)
    try {
      const r = await fetch('/api/v1/commissions')
      const d = await r.json()
      setScope(d.scope === 'mine' ? 'mine' : 'all')
      setItems(d.items || []); setTotals(d.totals || { expected: 0, collected: 0, pending: 0 })
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  async function setStatus(id: string, status: string) {
    setItems(its => its.map(i => i.id === id ? { ...i, status } : i))
    await fetch(`/api/v1/tenancies/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commission_status: status }) }).catch(() => load())
    load()
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 pb-24" dir="rtl">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="font-display" style={{ fontSize: 24 }}>עמלות</h1>
        <ExportButton
          disabled={items.length === 0}
          getSpec={() => ({
            filename: 'עמלות',
            rows: items,
            columns: [
              { header: 'נכס', value: (i: Item) => i.property, width: 32 },
              { header: 'שוכר', value: (i: Item) => i.renter, width: 20 },
              { header: 'שכירות חודשית', value: (i: Item) => i.monthly_rent, numFmt: '₪#,##0', width: 14 },
              { header: 'עמלה', value: (i: Item) => i.amount, numFmt: '₪#,##0', width: 12 },
              { header: 'סטטוס גבייה', value: (i: Item) => STATUS[i.status]?.label ?? i.status, width: 12 },
              { header: 'שכירות', value: (i: Item) => (i.tenancy_status === 'ended' ? 'הסתיימה' : 'פעילה'), width: 10 },
            ],
          })}
        />
      </div>
      <p className="text-sm faint mb-4">דמי תיווך לפי עסקאות שנסגרו — צפוי, נגבה, ופתוח. המודל: חודש שכירות.{scope === 'mine' && ' מוצגות העסקאות שרשמתם.'}</p>

      <div className="grid gap-3 mb-5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <div className="surface-card" style={{ padding: 16 }}><div className="faint text-xs mb-1">צפוי</div><div className="num" style={{ fontSize: 26, fontWeight: 600 }}>{ils(totals.expected)}</div></div>
        <div className="surface-card" style={{ padding: 16 }}><div className="faint text-xs mb-1">נגבה</div><div className="num" style={{ fontSize: 26, fontWeight: 600, color: 'var(--green)' }}>{ils(totals.collected)}</div></div>
        <div className="surface-card" style={{ padding: 16 }}><div className="faint text-xs mb-1">פתוח לגבייה</div><div className="num" style={{ fontSize: 26, fontWeight: 600, color: 'var(--amber)' }}>{ils(totals.pending)}</div></div>
      </div>

      {loading ? <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-brand-primary" /></div> : items.length === 0 ? (
        <div className="surface-card p-8 text-center text-sm faint">אין עדיין עסקאות שנסגרו.</div>
      ) : (
        <div className="grid grid-cols-1 gap-2">
          {items.map(i => (
            <div key={i.id} className="surface-card flex flex-wrap items-center gap-3" style={{ padding: '12px 16px' }}>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-sm truncate">{i.property}</div>
                <div className="text-xs faint truncate">{i.renter}{i.tenancy_status === 'ended' ? ' · הסתיימה' : ''}</div>
              </div>
              <div className="num text-sm">{i.amount != null ? ils(i.amount) : '—'}</div>
              <span className={`pill ${STATUS[i.status]?.cls || 'pill-gray'}`}>{STATUS[i.status]?.label || i.status}</span>
              {canManage && i.status !== 'collected' && (
                <button onClick={() => setStatus(i.id, 'collected')} className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white"><Check className="h-3.5 w-3.5" /> סמן כנגבה</button>
              )}
              {canManage && i.status === 'collected' && (
                <button onClick={() => setStatus(i.id, 'pending')} className="text-xs faint hover:underline">בטל גבייה</button>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  )
}

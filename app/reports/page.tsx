'use client'
import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'

type Data = {
  inventory: { properties: number; active: number; approved: number }
  renters: { total: number; vetted: number }
  deals: { total: number; active: number; ended: number; closedThisMonth: number }
  commissions: { expected: number; collected: number; pending: number }
  viewings: Record<string, number>
  sources: Array<{ name: string; n: number }>
  byStaff: Array<{ id: string; name: string; meetings: number; viewings: number; tasks: number; tasksDone: number; conversations: number; deals: number }>
}
const ils = (n: number) => `₪${Math.round(n).toLocaleString('he-IL')}`
const VIEW_LABEL: Record<string, string> = { interested: 'התעניינו', not_interested: 'לא התאים', maybe: 'אולי', no_show: 'לא הגיעו', pending: 'לתיעוד' }

function Kpi({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="surface-card" style={{ padding: 16 }}>
      <div className="faint text-xs mb-1">{label}</div>
      <div className="num" style={{ fontSize: 26, fontWeight: 600, color: tone }}>{value}</div>
    </div>
  )
}

export default function ReportsPage() {
  const [d, setD] = useState<Data | null>(null)
  useEffect(() => { fetch('/api/v1/reports').then(r => r.json()).then(setD).catch(() => {}) }, [])
  if (!d) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-brand-primary" /></div>

  const grid = { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' } as const
  return (
    <main className="mx-auto max-w-5xl px-4 py-6 pb-24" dir="rtl">
      <h1 className="font-display mb-4" style={{ fontSize: 24 }}>דוחות</h1>

      <h2 className="font-display mb-2" style={{ fontSize: 16 }}>מלאי ושוכרים</h2>
      <div style={grid} className="mb-5">
        <Kpi label="נכסים" value={d.inventory.properties.toLocaleString('he-IL')} />
        <Kpi label="פעילים" value={d.inventory.active.toLocaleString('he-IL')} />
        <Kpi label="מאושרים לתיווך" value={d.inventory.approved.toLocaleString('he-IL')} />
        <Kpi label="שוכרים מטוייבים" value={`${d.renters.vetted} / ${d.renters.total}`} />
      </div>

      <h2 className="font-display mb-2" style={{ fontSize: 16 }}>עסקאות ועמלות</h2>
      <div style={grid} className="mb-5">
        <Kpi label="עסקאות שנסגרו" value={d.deals.total} />
        <Kpi label="פעילות עכשיו" value={d.deals.active} />
        <Kpi label="נסגרו החודש" value={d.deals.closedThisMonth} tone="var(--brand)" />
        <Kpi label="עמלות — צפוי" value={ils(d.commissions.expected)} />
        <Kpi label="עמלות — נגבה" value={ils(d.commissions.collected)} tone="var(--green)" />
        <Kpi label="עמלות — פתוח" value={ils(d.commissions.pending)} tone="var(--amber)" />
      </div>

      <h2 className="font-display mb-2" style={{ fontSize: 16 }}>צפיות</h2>
      <div style={grid} className="mb-5">
        {Object.keys(d.viewings).length === 0 ? <div className="text-sm faint">אין צפיות עדיין.</div> :
          Object.entries(d.viewings).map(([k, n]) => <Kpi key={k} label={VIEW_LABEL[k] || k} value={n} />)}
      </div>

      <h2 className="font-display mb-2" style={{ fontSize: 16 }}>ביצועי צוות</h2>
      <div className="surface-card mb-5" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="w-full text-sm" style={{ borderCollapse: 'collapse', minWidth: 520 }}>
          <thead>
            <tr style={{ textAlign: 'right', color: 'var(--ink-3)', fontSize: 12 }}>
              <th style={{ padding: '10px 14px' }}>עובד</th>
              <th style={{ padding: '10px 8px' }}>פגישות</th>
              <th style={{ padding: '10px 8px' }}>צפיות</th>
              <th style={{ padding: '10px 8px' }}>משימות</th>
              <th style={{ padding: '10px 8px' }}>בוצעו</th>
              <th style={{ padding: '10px 8px' }}>שיחות</th>
              <th style={{ padding: '10px 8px' }}>עסקאות</th>
            </tr>
          </thead>
          <tbody>
            {(d.byStaff || []).map(s => (
              <tr key={s.id} style={{ borderTop: '1px solid var(--line)' }}>
                <td style={{ padding: '10px 14px', fontWeight: 600 }}>{s.name}</td>
                <td className="num" style={{ padding: '10px 8px' }}>{s.meetings}</td>
                <td className="num" style={{ padding: '10px 8px' }}>{s.viewings}</td>
                <td className="num" style={{ padding: '10px 8px' }}>{s.tasks}</td>
                <td className="num" style={{ padding: '10px 8px', color: 'var(--green)' }}>{s.tasksDone}</td>
                <td className="num" style={{ padding: '10px 8px' }}>{s.conversations}</td>
                <td className="num" style={{ padding: '10px 8px', color: 'var(--brand)' }}>{s.deals}</td>
              </tr>
            ))}
            {(!d.byStaff || d.byStaff.length === 0) && <tr><td colSpan={7} style={{ padding: 16, color: 'var(--ink-4)' }}>אין נתוני צוות.</td></tr>}
          </tbody>
        </table>
      </div>

      <h2 className="font-display mb-2" style={{ fontSize: 16 }}>מקורות לידים</h2>
      <div className="surface-card" style={{ padding: 16 }}>
        {d.sources.length === 0 ? <div className="text-sm faint">אין נתוני מקור.</div> :
          d.sources.map(s => (
            <div key={s.name} className="flex items-center gap-2 py-1.5" style={{ borderTop: '1px solid var(--line)' }}>
              <span className="flex-1 text-sm">{s.name}</span>
              <span className="num faint text-sm">{s.n.toLocaleString('he-IL')}</span>
            </div>
          ))}
      </div>
    </main>
  )
}

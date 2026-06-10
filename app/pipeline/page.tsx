'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'

type Item = { id: string; label: string; contact: string | null; price: number | null; rooms: number | null; intent: string | null; threadId: string | null }
type Col = { key: string; label: string; count: number; items: Item[] }

const INTENT_LABEL: Record<string, string> = { interested: 'מתעניין', price_objection: 'מו״מ מחיר', callback_later: 'לחזור' }
const COL_TONE: Record<string, string> = { contacted: 'pill-gray', in_convo: 'pill-amber', approved: 'pill-green', rented: 'pill-blue' }

export default function PipelinePage() {
  const [cols, setCols] = useState<Col[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    fetch('/api/v1/pipeline').then(r => r.json()).then(d => setCols(d.columns || [])).catch(() => {}).finally(() => setLoading(false))
  }, [])

  return (
    <main className="px-4 py-6" dir="rtl">
      <h1 className="font-display mb-1" style={{ fontSize: 24 }}>צינור עסקאות</h1>
      <p className="text-sm faint mb-4">המשפך של הנכסים שאנחנו עובדים עליהם — ממתין למענה · בשיחה · מאושר · הושכר. לחיצה קופצת לשיחה/לנכס.</p>
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-brand-primary" /></div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4" style={{ alignItems: 'flex-start' }}>
          {cols.map(c => (
            <div key={c.key} className="shrink-0" style={{ width: 280 }}>
              <div className="flex items-center justify-between mb-2 px-1">
                <span className="font-semibold">{c.label}</span>
                <span className={`pill ${COL_TONE[c.key] || 'pill-gray'}`}>{c.count}</span>
              </div>
              <div className="flex flex-col gap-2">
                {c.items.map(it => (
                  <Link
                    key={it.id}
                    href={it.threadId ? `/inbox/${it.threadId}` : `/properties/${it.id}`}
                    className="surface-card surface-card-interactive block no-underline"
                    style={{ padding: 12 }}
                  >
                    <div className="font-semibold text-sm truncate" style={{ color: 'var(--ink)' }}>{it.label}</div>
                    {it.contact && <div className="text-xs faint truncate">{it.contact}</div>}
                    <div className="flex items-center gap-2 mt-1 text-xs">
                      {it.price != null && <span className="num">₪{Number(it.price).toLocaleString('he-IL')}</span>}
                      {it.rooms != null && <span className="faint">{it.rooms} חד׳</span>}
                      {it.intent && INTENT_LABEL[it.intent] && <span className="pill pill-amber" style={{ fontSize: 10 }}>{INTENT_LABEL[it.intent]}</span>}
                    </div>
                  </Link>
                ))}
                {c.items.length === 0 && <div className="text-xs faint text-center py-4">ריק</div>}
                {c.count > c.items.length && <div className="text-xs faint text-center">+{c.count - c.items.length} נוספים</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  )
}

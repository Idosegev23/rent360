'use client'
import { useState } from 'react'
import Link from 'next/link'
import type { BoardItem } from './types'
import { fmtDays } from './types'

export default function OrphansStrip({ orphans, onChanged }: { orphans: BoardItem[]; onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  if (orphans.length === 0) return null

  async function claim(propertyId: string) {
    setBusyId(propertyId); setMsg(null)
    // Board-specific claim: succeeds only while the property is still unassigned, and is logged.
    const r = await fetch('/api/v1/board/claim', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ propertyId }),
    }).catch(() => null)
    setBusyId(null)
    if (!r) { setMsg('השיוך נכשל — אין חיבור. אפשר לנסות שוב.'); return }
    if (r.status === 409) setMsg('הנכס כבר שויך לסוכן אחר — הרשימה עודכנה.')
    else if (!r.ok) { setMsg('השיוך נכשל. אפשר לנסות שוב.'); return }
    onChanged()
  }

  return (
    <div className="surface-card mb-4" style={{ padding: 12, borderInlineStart: '4px solid var(--amber, #d97706)' }}>
      <button type="button" onClick={() => setOpen(o => !o)} className="flex items-center gap-2 w-full" aria-expanded={open}>
        <span className="pill pill-amber num">{orphans.length}</span>
        <span className="font-semibold text-sm">נכסים מאושרים ללא סוכן</span>
        <span className="faint text-xs">{open ? 'הסתרה' : 'הצגה'}</span>
      </button>
      {msg && <div className="text-xs mt-2" style={{ color: 'var(--amber, #d97706)' }}>{msg}</div>}
      {open && (
        <div className="flex flex-col gap-1 mt-2">
          {orphans.map(o => (
            <div key={o.propertyId} className="flex items-center justify-between gap-2 text-sm py-1">
              <div style={{ minWidth: 0 }}>
                <Link href={`/properties/${o.propertyId}`} className="no-underline" style={{ color: 'var(--ink)' }}>{o.label}</Link>
                <span className="faint text-xs"> · {o.ownerName || 'ללא שם'} · {fmtDays(o.daysInStage)}</span>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" disabled={busyId === o.propertyId} onClick={() => void claim(o.propertyId)}>שיוך אליי</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

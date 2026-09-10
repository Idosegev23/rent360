'use client'
import { useState } from 'react'
import Link from 'next/link'
import type { BoardItem } from './types'

export default function OrphansStrip({ orphans, meId, onChanged }: { orphans: BoardItem[]; meId: string; onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  if (orphans.length === 0) return null

  async function claim(propertyId: string) {
    setBusyId(propertyId)
    // Reuses the existing assign endpoint — it already rejects inactive agents.
    await fetch(`/api/v1/properties/${propertyId}/assign`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agentUserId: meId }),
    }).catch(() => null)
    setBusyId(null)
    onChanged()
  }

  return (
    <div className="surface-card mb-4" style={{ padding: 12, borderInlineStart: '4px solid var(--amber, #d97706)' }}>
      <button type="button" onClick={() => setOpen(o => !o)} className="flex items-center gap-2 w-full" aria-expanded={open}>
        <span className="pill pill-amber num">{orphans.length}</span>
        <span className="font-semibold text-sm">נכסים מאושרים ללא סוכן</span>
        <span className="faint text-xs">{open ? 'הסתרה' : 'הצגה'}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-1 mt-2">
          {orphans.map(o => (
            <div key={o.propertyId} className="flex items-center justify-between gap-2 text-sm py-1">
              <div style={{ minWidth: 0 }}>
                <Link href={`/properties/${o.propertyId}`} className="no-underline" style={{ color: 'var(--ink)' }}>{o.label}</Link>
                <span className="faint text-xs"> · {o.ownerName || 'ללא שם'} · <span className="num">{o.daysInStage}</span> ימים</span>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" disabled={busyId === o.propertyId} onClick={() => void claim(o.propertyId)}>שיוך אליי</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

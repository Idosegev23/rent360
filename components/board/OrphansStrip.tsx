'use client'
import { useState } from 'react'
import Link from 'next/link'
import type { BoardItem } from './types'
import { fmtDays } from './types'

type Agent = { id: string; name: string }

export default function OrphansStrip({ orphans, agents, meId, onChanged }: {
  orphans: BoardItem[]; agents: Agent[]; meId: string; onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  // Default assignee: the viewer when they handle properties, else the first agent.
  const [assignee, setAssignee] = useState(agents.some(a => a.id === meId) ? meId : (agents[0]?.id ?? ''))
  if (orphans.length === 0) return null

  async function assign(propertyId: string) {
    if (!assignee) return
    setBusyId(propertyId); setMsg(null)
    // Board-specific route: succeeds only while the property is still unassigned, only to an agent,
    // and is logged.
    const r = await fetch('/api/v1/board/claim', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ propertyId, agentUserId: assignee }),
    }).catch(() => null)
    setBusyId(null)
    if (!r) { setMsg('השיוך נכשל — אין חיבור. אפשר לנסות שוב.'); return }
    if (r.status === 409) setMsg('הנכס כבר שויך לסוכן אחר — הרשימה עודכנה.')
    else if (!r.ok) { setMsg('השיוך נכשל. אפשר לנסות שוב.'); return }
    onChanged()
  }

  return (
    <div className="surface-card mb-4" style={{ padding: 12, borderInlineStart: '4px solid var(--amber, #d97706)' }}>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setOpen(o => !o)} className="flex items-center gap-2" aria-expanded={open}>
          <span className="pill pill-amber num">{orphans.length}</span>
          <span className="font-semibold text-sm">נכסים מאושרים ללא סוכן</span>
          <span className="faint text-xs">{open ? 'הסתרה' : 'הצגה'}</span>
        </button>
        {open && agents.length > 0 && (
          <label className="text-xs flex items-center gap-1" style={{ marginInlineStart: 'auto' }}>
            <span className="faint">שיוך ל:</span>
            <select value={assignee} onChange={e => setAssignee(e.target.value)} className="border rounded px-1 py-0.5 text-xs">
              {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
        )}
      </div>
      {msg && <div className="text-xs mt-2" style={{ color: 'var(--amber, #d97706)' }}>{msg}</div>}
      {open && (
        <div className="flex flex-col gap-1 mt-2">
          {orphans.map(o => (
            <div key={o.propertyId} className="flex items-center justify-between gap-2 text-sm py-1">
              <div style={{ minWidth: 0 }}>
                <Link href={`/properties/${o.propertyId}`} className="no-underline" style={{ color: 'var(--ink)' }}>{o.label}</Link>
                <span className="faint text-xs"> · {o.ownerName || 'ללא שם'} · {fmtDays(o.daysInStage)}</span>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" disabled={busyId === o.propertyId || !assignee} onClick={() => void assign(o.propertyId)}>שיוך</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

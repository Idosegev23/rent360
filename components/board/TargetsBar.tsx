'use client'
import { useState } from 'react'
import type { BoardTargets } from './types'
import { fmtShekel } from './types'

function Meter({ label, actual, target, format }: { label: string; actual: number; target: number; format: (n: number) => string }) {
  const pct = target > 0 ? Math.min(100, Math.round((actual / target) * 100)) : 0
  return (
    <div className="flex-1" style={{ minWidth: 180 }}>
      <div className="flex items-baseline justify-between text-sm mb-1">
        <span className="faint">{label}</span>
        <span className="num font-semibold">{format(actual)}{target > 0 && <span className="faint"> / {format(target)}</span>}</span>
      </div>
      <div style={{ height: 8, borderRadius: 999, background: 'var(--line, #e5e7eb)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: pct >= 100 ? 'var(--green, #16a34a)' : 'var(--brand, #2563eb)' }} />
      </div>
    </div>
  )
}

export default function TargetsBar({ targets, userId, onSaved }: { targets: BoardTargets; userId: string; onSaved: () => void }) {
  const [editing, setEditing] = useState(false)
  const [deals, setDeals] = useState(String(targets.targetDeals))
  const [commission, setCommission] = useState(String(targets.targetCommission))
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const monthLabel = new Date(`${targets.month}T12:00:00`).toLocaleDateString('he-IL', { month: 'long', year: 'numeric' })

  async function save() {
    setSaving(true); setErr(null)
    const r = await fetch('/api/v1/board/targets', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, month: targets.month, targetDeals: Number(deals), targetCommission: Number(commission) }),
    }).catch(() => null)
    setSaving(false)
    if (!r || !r.ok) { setErr('השמירה נכשלה — צריך מספרים שלמים, 0 ומעלה.'); return }
    setEditing(false); onSaved()
  }

  return (
    <div className="surface-card mb-4" style={{ padding: 16 }}>
      <div className="flex items-center justify-between mb-3">
        <span className="font-semibold">יעד {monthLabel}</span>
        {!editing && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>עריכת יעד</button>}
      </div>
      {editing ? (
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">עסקאות
            <input type="number" min={0} step={1} value={deals} onChange={e => setDeals(e.target.value)} className="block border rounded px-2 py-1 mt-1 num" style={{ width: 110 }} />
          </label>
          <label className="text-sm">עמלות (₪)
            <input type="number" min={0} step={100} value={commission} onChange={e => setCommission(e.target.value)} className="block border rounded px-2 py-1 mt-1 num" style={{ width: 140 }} />
          </label>
          <button type="button" className="btn btn-primary btn-sm" disabled={saving} onClick={save}>שמירה</button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              // Discard what was typed so reopening the form shows the saved target, not the draft.
              setDeals(String(targets.targetDeals)); setCommission(String(targets.targetCommission)); setErr(null); setEditing(false)
            }}
          >ביטול</button>
          {err && <span className="text-sm" style={{ color: 'var(--red, #dc2626)' }}>{err}</span>}
        </div>
      ) : (
        <div className="flex flex-wrap gap-6">
          <Meter label="עסקאות" actual={targets.actualDeals} target={targets.targetDeals} format={n => String(n)} />
          <Meter label="עמלות" actual={targets.actualCommission} target={targets.targetCommission} format={fmtShekel} />
        </div>
      )}
      {!editing && targets.targetDeals === 0 && targets.targetCommission === 0 && (
        <p className="text-xs faint mt-2">עוד לא הוגדר יעד לחודש הזה.</p>
      )}
    </div>
  )
}

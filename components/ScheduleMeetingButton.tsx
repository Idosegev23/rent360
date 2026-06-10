'use client'
import { useEffect, useState } from 'react'
import { CalendarDays, Loader2, Check } from 'lucide-react'

type Member = { id: string; name: string | null }

/** Convenient meeting scheduling from any entity (property/renter/thread): title + owner + time →
 *  creates a meeting pre-linked to the entity (shows on /meetings, on the entity's related panel,
 *  reminds the owner, syncs to Google). */
export default function ScheduleMeetingButton(props: { propertyId?: string; renterId?: string; threadId?: string; label?: string; onDone?: () => void }) {
  const [team, setTeam] = useState<Member[]>([])
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [owner, setOwner] = useState('')
  const [when, setWhen] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    fetch('/api/v1/team').then(r => r.ok ? r.json() : { members: [] }).then(d => setTeam((d.members || []).map((m: Member) => ({ id: m.id, name: m.name })))).catch(() => {})
  }, [])

  async function create() {
    if (busy || !title.trim() || !when) return
    setBusy(true)
    try {
      const start = new Date(when); const end = new Date(start.getTime() + 30 * 60000)
      const body: Record<string, unknown> = { title: title.trim(), starts_at: start.toISOString(), ends_at: end.toISOString() }
      if (owner) body.owner_user_id = owner
      if (props.propertyId) body.property_id = props.propertyId
      if (props.renterId) body.renter_id = props.renterId
      if (props.threadId) body.thread_id = props.threadId
      const r = await fetch('/api/v1/meetings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!r.ok) throw new Error('failed')
      setDone(true); setOpen(false); setTitle(''); setWhen(''); setOwner('')
      props.onDone?.()
      setTimeout(() => setDone(false), 2500)
    } catch { window.alert('תיאום הפגישה נכשל') } finally { setBusy(false) }
  }

  if (done) return <span className="inline-flex items-center gap-1 text-sm text-blue-700"><Check className="h-4 w-4" /> הפגישה נקבעה</span>
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 rounded-md border border-brand-border bg-white px-3 py-1.5 text-sm font-medium text-brand-primary hover:bg-brand-primary/5">
        <CalendarDays className="h-4 w-4" /> {props.label || 'קבע פגישה'}
      </button>
    )
  }
  return (
    <div className="rounded-lg border border-brand-border bg-white p-2 space-y-2" style={{ minWidth: 240 }}>
      <input value={title} onChange={e => setTitle(e.target.value)} placeholder="נושא הפגישה" className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
      <div className="flex flex-wrap gap-2">
        <input type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
        <select value={owner} onChange={e => setOwner(e.target.value)} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm" title="למי הפגישה">
          <option value="">היומן שלי</option>
          {team.map(m => <option key={m.id} value={m.id}>{m.name || m.id}</option>)}
        </select>
      </div>
      <div className="flex gap-2">
        <button onClick={create} disabled={busy || !title.trim() || !when} className="rounded-md bg-brand-primary px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'קבע פגישה'}</button>
        <button onClick={() => setOpen(false)} className="text-sm text-gray-400">ביטול</button>
      </div>
    </div>
  )
}

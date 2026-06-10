'use client'
import { useEffect, useState } from 'react'
import { Plus, Loader2 } from 'lucide-react'
import { DateTimeField } from '@/components/ui/DateTimePicker'

type Member = { id: string; name: string | null }

/** Quick-add a task linked to the current entity (renter / property). Assignee = a staff member. */
export function AddTaskButton(props: { entityType: 'renter' | 'property'; entityId: string; label?: string }) {
  const [open, setOpen] = useState(false)
  const [team, setTeam] = useState<Member[]>([])
  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState<Date | null>(null)
  const [assignee, setAssignee] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (open && team.length === 0) {
      fetch('/api/v1/team')
        .then((r) => (r.ok ? r.json() : { members: [] }))
        .then((d) => setTeam((d.members || []).map((m: Member) => ({ id: m.id, name: m.name }))))
        .catch(() => {})
    }
  }, [open, team.length])

  async function add() {
    if (!title.trim() || busy) return
    setBusy(true)
    const body: Record<string, unknown> = { title: title.trim(), entity_type: props.entityType, entity_id: props.entityId }
    if (dueDate) body.due_at = dueDate.toISOString()
    if (assignee) body.assignee_user_id = assignee
    const r = await fetch('/api/v1/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    setBusy(false)
    if (r.ok) {
      setDone(true)
      setTitle(''); setDueDate(null); setAssignee('')
      setTimeout(() => { setDone(false); setOpen(false) }, 1200)
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1 rounded-md border border-brand-border px-3 py-1.5 text-sm hover:bg-gray-50">
        <Plus className="h-4 w-4" /> {props.label || 'הוסף משימה'}
      </button>
    )
  }
  return (
    <div className="surface-card space-y-2 p-3" dir="rtl">
      <input value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="משימה (תשויך לכרטיס הזה)" className="w-full rounded-md border border-brand-border px-3 py-2 text-sm" />
      <div className="flex flex-wrap items-center gap-2">
        <DateTimeField value={dueDate} onChange={setDueDate} placeholder="מועד יעד" />
        <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="rounded-md border border-brand-border px-2 py-1.5 text-sm">
          <option value="">משויך אליי</option>
          {team.map((m) => <option key={m.id} value={m.id}>{m.name || m.id}</option>)}
        </select>
        <button onClick={add} disabled={!title.trim() || busy} className="rounded-md bg-brand-primary px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : done ? 'נוסף ✓' : 'הוסף'}
        </button>
        <button onClick={() => setOpen(false)} className="rounded-md px-2 py-1.5 text-sm text-gray-400">ביטול</button>
      </div>
    </div>
  )
}

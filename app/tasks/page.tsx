'use client'
import { useEffect, useState } from 'react'
import { Loader2, Plus, Check, Clock, User as UserIcon, Pencil, Repeat, X } from 'lucide-react'
import { DateTimeField } from '@/components/ui/DateTimePicker'

type Recurrence = 'daily' | 'weekdays' | 'weekly' | ''
type Task = {
  id: string
  title: string
  notes: string | null
  assignee_user_id: string | null
  status: 'open' | 'in_progress' | 'done' | 'cancelled'
  priority: 'low' | 'normal' | 'high' | 'urgent'
  due_at: string | null
  entity_type: string | null
  recurrence: Recurrence | null
  created_at: string
}
type Member = { id: string; name: string | null }

const RECUR: Record<string, string> = { daily: 'כל יום', weekdays: 'ימי חול', weekly: 'כל שבוע' }
const PRIORITIES: Array<{ k: Task['priority']; label: string }> = [
  { k: 'normal', label: 'רגיל' }, { k: 'low', label: 'נמוך' }, { k: 'high', label: 'גבוה' }, { k: 'urgent', label: 'דחוף' },
]

type Tab = { key: string; label: string; qs: string }
const TABS: Tab[] = [
  { key: 'mine', label: 'שלי', qs: 'scope=mine&status=open' },
  { key: 'today', label: 'היום', qs: 'due=today' },
  { key: 'overdue', label: 'באיחור', qs: 'due=overdue' },
  { key: 'all', label: 'הכל', qs: 'scope=all' },
]

const PRIORITY: Record<Task['priority'], { label: string; color: string }> = {
  urgent: { label: 'דחוף', color: '#dc2626' },
  high: { label: 'גבוה', color: '#ea580c' },
  normal: { label: 'רגיל', color: '#64748b' },
  low: { label: 'נמוך', color: '#94a3b8' },
}

function fmtDue(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function TasksPage() {
  const [tab, setTab] = useState('mine')
  const [tasks, setTasks] = useState<Task[]>([])
  const [team, setTeam] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState<Date | null>(null)
  const [assignee, setAssignee] = useState('')
  const [priority, setPriority] = useState<Task['priority']>('normal')
  const [recurrence, setRecurrence] = useState<Recurrence>('')
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Task | null>(null)

  const nameOf = (id: string | null) => team.find((m) => m.id === id)?.name || (id ? '—' : 'לא משויך')

  async function load(t = tab) {
    setLoading(true)
    const qs = TABS.find((x) => x.key === t)?.qs || 'scope=all'
    const r = await fetch(`/api/v1/tasks?${qs}`)
    const d = await r.json().catch(() => ({ tasks: [] }))
    setTasks(d.tasks || [])
    setLoading(false)
  }

  useEffect(() => {
    fetch('/api/v1/team')
      .then((r) => (r.ok ? r.json() : { members: [] }))
      .then((d) => setTeam((d.members || []).map((m: Member) => ({ id: m.id, name: m.name }))))
      .catch(() => {})
  }, [])
  useEffect(() => {
    load(tab)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  async function add() {
    if (!title.trim() || adding) return
    setAdding(true)
    const body: Record<string, unknown> = { title: title.trim(), priority }
    if (dueDate) body.due_at = dueDate.toISOString()
    if (assignee) body.assignee_user_id = assignee
    if (recurrence) body.recurrence = recurrence
    const r = await fetch('/api/v1/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setAdding(false)
    if (r.ok) {
      setTitle('')
      setDueDate(null)
      setAssignee('')
      setPriority('normal')
      setRecurrence('')
      load(tab)
    }
  }

  async function saveEdit(t: Task) {
    await fetch(`/api/v1/tasks/${t.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: t.title, assignee_user_id: t.assignee_user_id, priority: t.priority,
        due_at: t.due_at, remind_at: t.due_at, recurrence: t.recurrence || null,
      }),
    }).catch(() => {})
    setEditing(null)
    load(tab)
  }

  async function markDone(id: string) {
    setTasks((prev) => prev.filter((t) => t.id !== id))
    await fetch(`/api/v1/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    }).catch(() => load(tab))
  }

  return (
    <main className="pb-20" dir="rtl">
      <h1 className="mb-4 text-2xl font-bold">משימות</h1>

      {/* Quick add */}
      <div className="surface-card mb-4 flex flex-wrap items-center gap-2 p-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="משימה חדשה…"
          className="min-w-[200px] flex-1 rounded-md border border-brand-border px-3 py-2 text-sm"
        />
        <DateTimeField value={dueDate} onChange={setDueDate} placeholder="מועד יעד" />
        <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="rounded-md border border-brand-border px-2 py-2 text-sm">
          <option value="">משויך אליי</option>
          {team.map((m) => (
            <option key={m.id} value={m.id}>{m.name || m.id}</option>
          ))}
        </select>
        <select value={priority} onChange={(e) => setPriority(e.target.value as Task['priority'])} className="rounded-md border border-brand-border px-2 py-2 text-sm" title="חשיבות">
          {PRIORITIES.map((p) => <option key={p.k} value={p.k}>{p.label}</option>)}
        </select>
        <select value={recurrence} onChange={(e) => setRecurrence(e.target.value as Recurrence)} className="rounded-md border border-brand-border px-2 py-2 text-sm" title="חזרתיות">
          <option value="">חד-פעמי</option>
          <option value="daily">כל יום</option>
          <option value="weekdays">ימי חול</option>
          <option value="weekly">כל שבוע</option>
        </select>
        <button onClick={add} disabled={!title.trim() || adding} className="flex items-center gap-1 rounded-md bg-brand-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} הוסף
        </button>
      </div>

      {/* Tabs */}
      <div className="mb-3 flex gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-full px-4 py-1.5 text-sm ${tab === t.key ? 'bg-brand-primary text-white' : 'bg-gray-100 text-gray-600'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-brand-primary" /></div>
      ) : tasks.length === 0 ? (
        <div className="surface-card p-8 text-center text-sm text-gray-500">אין משימות בתצוגה הזו.</div>
      ) : (
        <div className="space-y-2">
          {tasks.map((t) => (
            <div key={t.id} className="surface-card flex items-center gap-3 p-3">
              <button
                onClick={() => markDone(t.id)}
                title="סמן כבוצע"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-gray-300 text-gray-400 hover:border-green-500 hover:text-green-600"
              >
                <Check className="h-4 w-4" />
              </button>
              <div className="min-w-0 flex-1">
                <div className={`text-sm font-medium ${t.status === 'done' ? 'text-gray-400 line-through' : ''}`}>{t.title}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                  <span className="inline-flex items-center gap-1"><UserIcon className="h-3 w-3" />{nameOf(t.assignee_user_id)}</span>
                  {t.due_at && <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{fmtDue(t.due_at)}</span>}
                  {t.recurrence && <span className="inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-blue-700"><Repeat className="h-3 w-3" />{RECUR[t.recurrence]}</span>}
                  {t.entity_type && <span className="rounded bg-gray-100 px-1.5 py-0.5">{t.entity_type}</span>}
                </div>
              </div>
              <span className="shrink-0 rounded-full px-2 py-0.5 text-xs" style={{ background: PRIORITY[t.priority].color + '1a', color: PRIORITY[t.priority].color }}>
                {PRIORITY[t.priority].label}
              </span>
              <button onClick={() => setEditing(t)} title="עריכה" className="shrink-0 rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
                <Pencil className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {editing && <EditTaskModal task={editing} team={team} onClose={() => setEditing(null)} onSave={saveEdit} />}
    </main>
  )
}

function EditTaskModal({ task, team, onClose, onSave }: { task: Task; team: Member[]; onClose: () => void; onSave: (t: Task) => void }) {
  const [t, setT] = useState<Task>(task)
  const [due, setDue] = useState<Date | null>(task.due_at ? new Date(task.due_at) : null)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="surface-card w-full max-w-md p-4" dir="rtl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display" style={{ fontSize: 18 }}>עריכת משימה</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-2">
          <input value={t.title} onChange={(e) => setT({ ...t, title: e.target.value })} placeholder="כותרת" className="w-full rounded-md border border-brand-border px-3 py-2 text-sm" />
          <div className="flex flex-wrap gap-2">
            <DateTimeField value={due} onChange={(d) => { setDue(d); setT({ ...t, due_at: d ? d.toISOString() : null }) }} placeholder="מועד יעד" />
            <select value={t.assignee_user_id || ''} onChange={(e) => setT({ ...t, assignee_user_id: e.target.value || null })} className="rounded-md border border-brand-border px-2 py-2 text-sm">
              <option value="">לא משויך</option>
              {team.map((m) => <option key={m.id} value={m.id}>{m.name || m.id}</option>)}
            </select>
          </div>
          <div className="flex flex-wrap gap-2">
            <select value={t.priority} onChange={(e) => setT({ ...t, priority: e.target.value as Task['priority'] })} className="rounded-md border border-brand-border px-2 py-2 text-sm">
              {PRIORITIES.map((p) => <option key={p.k} value={p.k}>{p.label}</option>)}
            </select>
            <select value={t.recurrence || ''} onChange={(e) => setT({ ...t, recurrence: (e.target.value || null) as Recurrence | null })} className="rounded-md border border-brand-border px-2 py-2 text-sm">
              <option value="">חד-פעמי</option>
              <option value="daily">כל יום</option>
              <option value="weekdays">ימי חול</option>
              <option value="weekly">כל שבוע</option>
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="rounded-md px-3 py-2 text-sm text-gray-500">ביטול</button>
            <button onClick={() => onSave(t)} disabled={!t.title.trim()} className="rounded-md bg-brand-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50">שמירה</button>
          </div>
        </div>
      </div>
    </div>
  )
}

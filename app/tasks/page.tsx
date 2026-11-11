'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Loader2, Plus, Check, Clock, User as UserIcon, Pencil, Repeat, X, Eye } from 'lucide-react'
import { DateTimeField } from '@/components/ui/DateTimePicker'
import TaskNotes from '@/components/tasks/TaskNotes'
import ExportButton from '@/components/ui/ExportButton'
import ActionCenter from '@/components/dashboard/ActionCenter'
import PivotBuilder from '@/components/ui/PivotBuilder'

type Recurrence = 'daily' | 'weekdays' | 'weekly' | 'monthly' | ''
type Source = 'meeting' | 'property' | 'customer' | 'delegated' | 'manual'
type Task = {
  id: string
  title: string
  notes: string | null
  assignee_user_id: string | null
  follower_user_id?: string | null
  created_by: string | null
  status: 'open' | 'in_progress' | 'done' | 'cancelled'
  priority: 'low' | 'normal' | 'high' | 'urgent'
  due_at: string | null
  entity_type: string | null
  entity_label?: string | null
  entity_href?: string | null
  source?: Source
  recurrence: Recurrence | null
  created_at: string
  notes_count?: number
  last_note?: { body: string | null; created_at: string } | null
}
type Member = { id: string; name: string | null }

const RECUR: Record<string, string> = { daily: 'כל יום', weekdays: 'ימי חול', weekly: 'כל שבוע', monthly: 'כל חודש' }
const PRIORITIES: Array<{ k: Task['priority']; label: string }> = [
  { k: 'normal', label: 'רגיל' }, { k: 'low', label: 'נמוך' }, { k: 'high', label: 'גבוה' }, { k: 'urgent', label: 'דחוף' },
]
const STATUS_LABEL: Record<Task['status'], string> = { open: 'פתוחה', in_progress: 'בטיפול', done: 'הושלמה', cancelled: 'בוטלה' }
const SOURCE_LABEL: Record<Source, string> = {
  property: 'תהליך נכס', meeting: 'פגישה או שיחה', customer: 'לקוח', delegated: 'הועברה מאחרים', manual: 'ידנית',
}

// One place for everything that needs doing: my tasks, what I handed to others, and the signals the
// AI picked up from conversations (previously the separate "מה לעשות" screen).
type Tab = { key: string; label: string; qs: string }
const TABS: Tab[] = [
  { key: 'mine', label: 'שלי', qs: 'scope=mine' },
  { key: 'today', label: 'היום', qs: 'scope=mine&due=today' },
  { key: 'overdue', label: 'באיחור', qs: 'scope=mine&due=overdue' },
  { key: 'delegated', label: 'העברתי לאחרים', qs: 'scope=delegated' },
  { key: 'signals', label: 'מהשיחות', qs: '' },
  { key: 'all', label: 'הכל', qs: 'scope=all' },
]

const STATUS_FILTERS = [
  { key: 'active', label: 'פעילות', qs: 'open,in_progress' },
  { key: 'done', label: 'הושלמו', qs: 'done' },
  { key: 'cancelled', label: 'בוטלו', qs: 'cancelled' },
  { key: 'any', label: 'הכל', qs: '' },
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

const selCls = 'rounded-md border border-brand-border px-2 py-2 text-sm'

export default function TasksPage() {
  const [tab, setTab] = useState('mine')
  const [tasks, setTasks] = useState<Task[]>([])
  const [team, setTeam] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState<Date | null>(null)
  const [assignee, setAssignee] = useState('')
  const [follower, setFollower] = useState('')
  const [priority, setPriority] = useState<Task['priority']>('normal')
  const [recurrence, setRecurrence] = useState<Recurrence>('')
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Task | null>(null)

  // Filters. Status goes to the server (it decides which rows come back); the rest narrow the loaded list.
  const [statusKey, setStatusKey] = useState('active')
  const [fPriority, setFPriority] = useState('')
  const [fSource, setFSource] = useState('')
  const [fFrom, setFFrom] = useState('')
  const [fTo, setFTo] = useState('')
  const [fText, setFText] = useState('')

  const nameOf = (id: string | null | undefined) => team.find((m) => m.id === id)?.name || (id ? '—' : 'לא משויך')

  async function load(t = tab, st = statusKey) {
    const base = TABS.find((x) => x.key === t)?.qs
    if (!base) { setLoading(false); return }
    setLoading(true)
    // today/overdue already restrict to open work, so the status filter only applies to the list views.
    const statusQs = STATUS_FILTERS.find((s) => s.key === st)?.qs
    const qs = statusQs && !base.includes('due=') ? `${base}&status=${statusQs}` : base
    const r = await fetch(`/api/v1/tasks?${qs}`)
    const d = await r.json().catch(() => ({ tasks: [] }))
    setTasks(d.tasks || [])
    setLoading(false)
  }

  // /action redirects here with ?tab=signals.
  useEffect(() => {
    const want = new URLSearchParams(window.location.search).get('tab')
    if (want && TABS.some((t) => t.key === want)) setTab(want)
  }, [])
  useEffect(() => {
    fetch('/api/v1/team')
      .then((r) => (r.ok ? r.json() : { members: [] }))
      .then((d) => setTeam((d.members || []).map((m: Member) => ({ id: m.id, name: m.name }))))
      .catch(() => {})
  }, [])
  useEffect(() => {
    load(tab, statusKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, statusKey])

  const visible = useMemo(() => {
    const q = fText.trim().toLowerCase()
    const from = fFrom ? new Date(`${fFrom}T00:00:00`).getTime() : null
    const to = fTo ? new Date(`${fTo}T23:59:59`).getTime() : null
    return tasks.filter((t) => {
      if (fPriority && t.priority !== fPriority) return false
      if (fSource && t.source !== fSource) return false
      if (from != null || to != null) {
        if (!t.due_at) return false
        const ts = new Date(t.due_at).getTime()
        if (from != null && ts < from) return false
        if (to != null && ts > to) return false
      }
      if (q && !`${t.title} ${t.entity_label ?? ''} ${t.notes ?? ''}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [tasks, fPriority, fSource, fFrom, fTo, fText])
  const filtersActive = !!(fPriority || fSource || fFrom || fTo || fText.trim())

  async function add() {
    if (!title.trim() || adding) return
    setAdding(true)
    const body: Record<string, unknown> = { title: title.trim(), priority }
    if (dueDate) body.due_at = dueDate.toISOString()
    if (assignee) body.assignee_user_id = assignee
    if (follower) body.follower_user_id = follower
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
      setFollower('')
      setPriority('normal')
      setRecurrence('')
      load(tab)
    }
  }

  async function saveEdit(t: Task, note?: string) {
    await fetch(`/api/v1/tasks/${t.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: t.title, assignee_user_id: t.assignee_user_id, priority: t.priority,
        // Only sent when the list carried it (it is absent until migration 0044 exists).
        ...(t.follower_user_id !== undefined ? { follower_user_id: t.follower_user_id } : {}),
        due_at: t.due_at, remind_at: t.due_at, recurrence: t.recurrence || null,
      }),
    }).catch(() => {})
    // A handoff note/request left while reassigning or returning the task — kept in the task's log.
    if (note && note.trim()) {
      await fetch('/api/v1/activity', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity_type: 'task', entity_id: t.id, kind: 'note', body: note.trim() }),
      }).catch(() => {})
    }
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
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">משימות</h1>
        {tab !== 'signals' && (
          <ExportButton
            disabled={visible.length === 0}
            getSpec={() => ({
              filename: 'משימות',
              rows: visible,
              columns: [
                { header: 'משימה', value: (t: Task) => t.title, width: 40 },
                { header: 'אחראי לביצוע', value: (t: Task) => nameOf(t.assignee_user_id), width: 16 },
                { header: 'אחראי למעקב', value: (t: Task) => (t.follower_user_id ? nameOf(t.follower_user_id) : null), width: 16 },
                { header: 'נוצרה על ידי', value: (t: Task) => (t.created_by ? nameOf(t.created_by) : null), width: 16 },
                { header: 'סטטוס', value: (t: Task) => STATUS_LABEL[t.status] ?? t.status, width: 12 },
                { header: 'דחיפות', value: (t: Task) => PRIORITY[t.priority].label, width: 10 },
                { header: 'תאריך יעד', value: (t: Task) => (t.due_at ? new Date(t.due_at) : null), numFmt: 'dd/mm/yyyy hh:mm', width: 18 },
                { header: 'מקור', value: (t: Task) => (t.source ? SOURCE_LABEL[t.source] : null), width: 16 },
                { header: 'נכס או לקוח', value: (t: Task) => t.entity_label ?? t.entity_type, width: 28 },
                { header: 'חזרתיות', value: (t: Task) => (t.recurrence ? RECUR[t.recurrence] ?? t.recurrence : null), width: 12 },
                { header: 'הערות', value: (t: Task) => t.notes, width: 40 },
                { header: 'נוצרה', value: (t: Task) => new Date(t.created_at), numFmt: 'dd/mm/yyyy', width: 12 },
              ],
            })}
          />
        )}
      </div>

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
        <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={selCls} title="אחראי לביצוע">
          <option value="">משויך אליי</option>
          {team.map((m) => (
            <option key={m.id} value={m.id}>{m.name || m.id}</option>
          ))}
        </select>
        <select value={follower} onChange={(e) => setFollower(e.target.value)} className={selCls} title="אחראי למעקב">
          <option value="">בלי מעקב</option>
          {team.map((m) => (
            <option key={m.id} value={m.id}>מעקב: {m.name || m.id}</option>
          ))}
        </select>
        <select value={priority} onChange={(e) => setPriority(e.target.value as Task['priority'])} className={selCls} title="חשיבות">
          {PRIORITIES.map((p) => <option key={p.k} value={p.k}>{p.label}</option>)}
        </select>
        <select value={recurrence} onChange={(e) => setRecurrence(e.target.value as Recurrence)} className={selCls} title="חזרתיות">
          <option value="">חד-פעמי</option>
          <option value="daily">כל יום</option>
          <option value="weekdays">ימי חול</option>
          <option value="weekly">כל שבוע</option>
          <option value="monthly">כל חודש</option>
        </select>
        <button onClick={add} disabled={!title.trim() || adding} className="flex items-center gap-1 rounded-md bg-brand-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} הוסף
        </button>
      </div>

      {/* Tabs */}
      <div className="mb-3 flex flex-wrap gap-2">
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

      {tab === 'signals' ? (
        // Conversation signals (hot leads, callbacks, viewings to log…). "המשימות שלי" is dropped here — it is this page.
        <ActionCenter variant="full" hideLanes={['my_tasks']} />
      ) : (
        <>
          {/* Filters */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input value={fText} onChange={(e) => setFText(e.target.value)} placeholder="חיפוש: משימה, נכס או לקוח" className="min-w-[180px] flex-1 rounded-md border border-brand-border px-3 py-2 text-sm" />
            <select value={statusKey} onChange={(e) => setStatusKey(e.target.value)} className={selCls} title="סטטוס" disabled={tab === 'today' || tab === 'overdue'}>
              {STATUS_FILTERS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <select value={fPriority} onChange={(e) => setFPriority(e.target.value)} className={selCls} title="דחיפות">
              <option value="">כל הדחיפויות</option>
              {PRIORITIES.map((p) => <option key={p.k} value={p.k}>{p.label}</option>)}
            </select>
            <select value={fSource} onChange={(e) => setFSource(e.target.value)} className={selCls} title="מקור המשימה">
              <option value="">כל המקורות</option>
              {(Object.keys(SOURCE_LABEL) as Source[]).map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
            </select>
            <label className="flex items-center gap-1 text-xs text-gray-500">יעד מ-
              <input type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} className={selCls} />
            </label>
            <label className="flex items-center gap-1 text-xs text-gray-500">עד
              <input type="date" min={fFrom || undefined} value={fTo} onChange={(e) => setFTo(e.target.value)} className={selCls} />
            </label>
            {filtersActive && (
              <button onClick={() => { setFPriority(''); setFSource(''); setFFrom(''); setFTo(''); setFText('') }} className="text-xs text-brand-primary hover:underline">נקה סינון</button>
            )}
          </div>

          {/* List */}
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-brand-primary" /></div>
          ) : visible.length === 0 ? (
            <div className="surface-card p-8 text-center text-sm text-gray-500">{filtersActive ? 'אין משימות שמתאימות לסינון.' : 'אין משימות בתצוגה הזו.'}</div>
          ) : (
            <div className="space-y-2">
              {visible.map((t) => (
                <div key={t.id} className="surface-card p-3">
                  <div className="flex items-center gap-3">
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
                        <span className="inline-flex items-center gap-1" title="אחראי לביצוע"><UserIcon className="h-3 w-3" />{nameOf(t.assignee_user_id)}</span>
                        {t.follower_user_id && <span className="inline-flex items-center gap-1" title="אחראי למעקב"><Eye className="h-3 w-3" />{nameOf(t.follower_user_id)}</span>}
                        {t.due_at && <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{fmtDue(t.due_at)}</span>}
                        {t.recurrence && <span className="inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-blue-700"><Repeat className="h-3 w-3" />{RECUR[t.recurrence]}</span>}
                        {t.status !== 'open' && <span className="rounded bg-gray-100 px-1.5 py-0.5">{STATUS_LABEL[t.status]}</span>}
                        {t.source && t.source !== 'manual' && <span className="rounded bg-violet-50 px-1.5 py-0.5 text-violet-700">{SOURCE_LABEL[t.source]}</span>}
                        {t.entity_label && (t.entity_href
                          ? <Link href={t.entity_href} className="rounded bg-gray-100 px-1.5 py-0.5 text-brand-primary hover:underline">{t.entity_label}</Link>
                          : <span className="rounded bg-gray-100 px-1.5 py-0.5">{t.entity_label}</span>)}
                        {!t.entity_label && t.entity_type && (t.entity_href
                          ? <Link href={t.entity_href} className="rounded bg-gray-100 px-1.5 py-0.5 text-brand-primary hover:underline">פרטים</Link>
                          : <span className="rounded bg-gray-100 px-1.5 py-0.5">{t.entity_type}</span>)}
                      </div>
                    </div>
                    <span className="shrink-0 rounded-full px-2 py-0.5 text-xs" style={{ background: PRIORITY[t.priority].color + '1a', color: PRIORITY[t.priority].color }}>
                      {PRIORITY[t.priority].label}
                    </span>
                    <button onClick={() => setEditing(t)} title="עריכה" className="shrink-0 rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
                      <Pencil className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Handoff notes: the latest request shown inline + the full thread on expand. */}
                  <div className="mt-2 ps-9">
                    {t.last_note?.body && (
                      <div className="mb-1.5 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900 whitespace-pre-wrap">{t.last_note.body}</div>
                    )}
                    <TaskNotes taskId={t.id} count={t.notes_count || 0} onChanged={() => load(tab)} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab !== 'signals' && !loading && visible.length > 0 && (
        <div className="mt-6">
          <PivotBuilder
            rows={visible}
            filename="פילוח משימות"
            dimensions={[
              { key: 'assignee', label: 'אחראי לביצוע', get: (t: Task) => nameOf(t.assignee_user_id) },
              { key: 'follower', label: 'אחראי למעקב', get: (t: Task) => (t.follower_user_id ? nameOf(t.follower_user_id) : null) },
              { key: 'status', label: 'סטטוס', get: (t: Task) => STATUS_LABEL[t.status] },
              { key: 'priority', label: 'דחיפות', get: (t: Task) => PRIORITY[t.priority].label },
              { key: 'source', label: 'מקור', get: (t: Task) => (t.source ? SOURCE_LABEL[t.source] : null) },
              { key: 'dueMonth', label: 'חודש יעד', get: (t: Task) => (t.due_at ? t.due_at.slice(0, 7) : null) },
              { key: 'overdue', label: 'באיחור', get: (t: Task) => (t.due_at && t.status !== 'done' && t.status !== 'cancelled' && new Date(t.due_at) < new Date() ? 'באיחור' : 'בזמן') },
            ]}
            measures={[]}
          />
        </div>
      )}

      {editing && <EditTaskModal task={editing} team={team} onClose={() => setEditing(null)} onSave={saveEdit} />}
    </main>
  )
}

function EditTaskModal({ task, team, onClose, onSave }: { task: Task; team: Member[]; onClose: () => void; onSave: (t: Task, note?: string) => void }) {
  const [t, setT] = useState<Task>(task)
  const [due, setDue] = useState<Date | null>(task.due_at ? new Date(task.due_at) : null)
  const [note, setNote] = useState('')
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
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-gray-500">אחראי לביצוע
              <select value={t.assignee_user_id || ''} onChange={(e) => setT({ ...t, assignee_user_id: e.target.value || null })} className={`${selCls} mt-1 w-full`}>
                <option value="">לא משויך</option>
                {team.map((m) => <option key={m.id} value={m.id}>{m.name || m.id}</option>)}
              </select>
            </label>
            <label className="text-xs text-gray-500">אחראי למעקב
              <select value={t.follower_user_id || ''} onChange={(e) => setT({ ...t, follower_user_id: e.target.value || null })} className={`${selCls} mt-1 w-full`}>
                <option value="">בלי מעקב</option>
                {team.map((m) => <option key={m.id} value={m.id}>{m.name || m.id}</option>)}
              </select>
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <select value={t.priority} onChange={(e) => setT({ ...t, priority: e.target.value as Task['priority'] })} className={selCls}>
              {PRIORITIES.map((p) => <option key={p.k} value={p.k}>{p.label}</option>)}
            </select>
            <select value={t.recurrence || ''} onChange={(e) => setT({ ...t, recurrence: (e.target.value || null) as Recurrence | null })} className={selCls}>
              <option value="">חד-פעמי</option>
              <option value="daily">כל יום</option>
              <option value="weekdays">ימי חול</option>
              <option value="weekly">כל שבוע</option>
              <option value="monthly">כל חודש</option>
            </select>
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="הערה / בקשה בהעברה (אופציונלי) — למשל: חסר חוזה, נא להשלים…"
            rows={2}
            className="w-full rounded-md border border-brand-border px-3 py-2 text-sm resize-y"
          />
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="rounded-md px-3 py-2 text-sm text-gray-500">ביטול</button>
            <button onClick={() => onSave(t, note)} disabled={!t.title.trim()} className="rounded-md bg-brand-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50">שמירה</button>
          </div>
        </div>
      </div>
    </div>
  )
}

'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ListChecks, CalendarDays, Check } from 'lucide-react'

type Me = { id: string; name?: string | null }
type Task = { id: string; title: string; due_at: string | null }
type Meeting = { id: string; title: string; starts_at: string }

function fmt(iso: string): string {
  try { return new Date(iso).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) } catch { return '' }
}

/** Personal "my day" strip at the top of the dashboard — the current user's tasks for today and
 *  their upcoming meetings (scope=mine / ownerUserId=me), so each staff member sees their own work. */
export default function MyDayPanel() {
  const [me, setMe] = useState<Me | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [meetings, setMeetings] = useState<Meeting[]>([])

  useEffect(() => {
    fetch('/api/me').then(r => r.ok ? r.json() : null).then(d => d && setMe(d)).catch(() => {})
    fetch('/api/v1/tasks?scope=mine&due=today').then(r => r.json()).then(d => setTasks(d.tasks || [])).catch(() => {})
  }, [])
  useEffect(() => {
    if (!me?.id) return
    const now = Date.now()
    fetch(`/api/v1/meetings?ownerUserId=${me.id}`).then(r => r.json())
      .then(d => setMeetings((d.meetings || [])
        .filter((m: Meeting) => new Date(m.starts_at).getTime() >= now)
        .sort((a: Meeting, b: Meeting) => +new Date(a.starts_at) - +new Date(b.starts_at))
        .slice(0, 5)))
      .catch(() => {})
  }, [me?.id])

  async function markDone(id: string) {
    setTasks(ts => ts.filter(t => t.id !== id))
    await fetch(`/api/v1/tasks/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'done' }) }).catch(() => {})
  }

  return (
    <section className="mb-6" dir="rtl">
      <h2 className="font-display mb-3" style={{ fontSize: 20 }}>{me?.name ? `הבוקר של ${me.name}` : 'היום שלי'}</h2>
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
        <div className="surface-card" style={{ padding: 16 }}>
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold inline-flex items-center gap-1.5"><ListChecks size={16} /> המשימות שלי להיום</span>
            <Link href="/tasks" className="text-xs" style={{ color: 'var(--brand)' }}>כל המשימות →</Link>
          </div>
          {tasks.length === 0
            ? <div className="text-sm faint py-3">אין משימות להיום ✦</div>
            : tasks.slice(0, 6).map(t => (
              <div key={t.id} className="flex items-center gap-2 py-1.5" style={{ borderTop: '1px solid var(--line)' }}>
                <button onClick={() => markDone(t.id)} title="בוצע" className="h-5 w-5 rounded flex items-center justify-center shrink-0" style={{ border: '1px solid var(--line-2)' }}><Check size={12} /></button>
                <span className="text-sm flex-1 truncate">{t.title}</span>
                {t.due_at && <span className="num text-xs faint">{fmt(t.due_at)}</span>}
              </div>
            ))}
        </div>
        <div className="surface-card" style={{ padding: 16 }}>
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold inline-flex items-center gap-1.5"><CalendarDays size={16} /> הפגישות שלי</span>
            <Link href="/meetings" className="text-xs" style={{ color: 'var(--brand)' }}>כל הפגישות →</Link>
          </div>
          {meetings.length === 0
            ? <div className="text-sm faint py-3">אין פגישות קרובות</div>
            : meetings.map(m => (
              <div key={m.id} className="flex items-center gap-2 py-1.5" style={{ borderTop: '1px solid var(--line)' }}>
                <span className="text-sm flex-1 truncate">{m.title}</span>
                <span className="num text-xs faint">{fmt(m.starts_at)}</span>
              </div>
            ))}
        </div>
      </div>
    </section>
  )
}

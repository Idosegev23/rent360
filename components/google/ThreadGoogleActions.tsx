'use client'
import { useState } from 'react'
import { DateTimeField } from '@/components/ui/DateTimePicker'

type TeamUser = { id: string; name: string | null }

export function ThreadGoogleActions(props: {
  threadId: string
  assignedUserId: string | null
  team: TeamUser[]
  contactEmail?: string | null
}) {
  const [assigned, setAssigned] = useState(props.assignedUserId)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  // Calendar-event mini-form (replaces the old prompt flow).
  const [evtOpen, setEvtOpen] = useState(false)
  const [evtTitle, setEvtTitle] = useState('')
  const [evtDate, setEvtDate] = useState<Date | null>(null)

  async function assign(userId: string | null) {
    setBusy(true)
    const r = await fetch(`/api/v1/inbox/threads/${props.threadId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assigned_to: userId }),
    })
    setBusy(false)
    if (r.ok) setAssigned(userId)
  }

  async function createEvent() {
    if (!evtTitle.trim() || !evtDate || busy) return
    const end = new Date(evtDate.getTime() + 30 * 60000)
    setBusy(true)
    const r = await fetch('/api/google/calendar/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary: evtTitle.trim(), start: evtDate.toISOString(), end: end.toISOString() }),
    })
    setBusy(false)
    if (r.ok) {
      setMsg('האירוע נוצר ביומן')
      setEvtOpen(false); setEvtTitle(''); setEvtDate(null)
    } else {
      setMsg((await r.json().catch(() => ({}))).message || 'שגיאה ביצירת האירוע')
    }
  }

  async function sendEmail() {
    const to = prompt('נמען:', props.contactEmail || '')
    if (!to) return
    const subject = prompt('נושא:')
    if (!subject) return
    const text = prompt('תוכן:')
    if (!text) return
    setBusy(true)
    const r = await fetch('/api/google/gmail/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, subject, text }),
    })
    setBusy(false)
    setMsg(r.ok ? 'המייל נשלח' : (await r.json().catch(() => ({}))).message || 'שגיאה בשליחת המייל')
  }

  return (
    <div dir="rtl">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={assigned ?? ''}
          disabled={busy}
          onChange={(e) => assign(e.target.value || null)}
          className="text-sm border rounded-lg px-2 py-1"
        >
          <option value="">לא משויך</option>
          {props.team.map((u) => (
            <option key={u.id} value={u.id}>{u.name || u.id}</option>
          ))}
        </select>
        <button onClick={() => setEvtOpen((o) => !o)} disabled={busy} className="text-sm px-2 py-1 rounded-lg border">הוסף ליומן</button>
        <button onClick={sendEmail} disabled={busy} className="text-sm px-2 py-1 rounded-lg border">שלח מייל</button>
        {msg && <span className="text-xs text-gray-600">{msg}</span>}
      </div>

      {evtOpen && (
        <div className="mt-2 space-y-2 rounded-lg border border-brand-border bg-gray-50 p-2">
          <input
            value={evtTitle}
            onChange={(e) => setEvtTitle(e.target.value)}
            placeholder="כותרת האירוע"
            className="w-full rounded-md border border-brand-border px-3 py-2 text-sm"
          />
          <div className="flex flex-wrap items-center gap-2">
            <DateTimeField value={evtDate} onChange={setEvtDate} placeholder="מתי?" />
            <button onClick={createEvent} disabled={!evtTitle.trim() || !evtDate || busy} className="rounded-md bg-brand-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-50">צור אירוע</button>
            <button onClick={() => setEvtOpen(false)} className="px-2 py-2 text-sm text-gray-400">ביטול</button>
          </div>
        </div>
      )}
    </div>
  )
}

'use client'
import { useState } from 'react'

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

  async function addEvent() {
    const summary = prompt('כותרת האירוע:')
    if (!summary) return
    const when = prompt('מתי? (YYYY-MM-DDTHH:MM, שעון ישראל):')
    if (!when) return
    const start = new Date(when)
    if (isNaN(start.getTime())) {
      setMsg('תאריך לא תקין')
      return
    }
    const end = new Date(start.getTime() + 30 * 60000)
    setBusy(true)
    const r = await fetch('/api/google/calendar/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary, start: start.toISOString(), end: end.toISOString() }),
    })
    setBusy(false)
    setMsg(r.ok ? 'האירוע נוצר ביומן' : (await r.json().catch(() => ({}))).message || 'שגיאה ביצירת האירוע')
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
    <div className="flex flex-wrap items-center gap-2" dir="rtl">
      <select
        value={assigned ?? ''}
        disabled={busy}
        onChange={(e) => assign(e.target.value || null)}
        className="text-sm border rounded-lg px-2 py-1"
      >
        <option value="">לא משויך</option>
        {props.team.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name || u.id}
          </option>
        ))}
      </select>
      <button onClick={addEvent} disabled={busy} className="text-sm px-2 py-1 rounded-lg border">
        הוסף ליומן
      </button>
      <button onClick={sendEmail} disabled={busy} className="text-sm px-2 py-1 rounded-lg border">
        שלח מייל
      </button>
      {msg && <span className="text-xs text-gray-600">{msg}</span>}
    </div>
  )
}

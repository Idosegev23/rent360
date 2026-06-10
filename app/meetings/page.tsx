'use client'
import { useEffect, useState } from 'react'
import { Loader2, Plus, MapPin, Clock, User as UserIcon, X, CalendarDays } from 'lucide-react'
import { DateTimeField } from '@/components/ui/DateTimePicker'

type Meeting = {
  id: string
  title: string
  location: string | null
  notes: string | null
  owner_user_id: string | null
  google_event_id: string | null
  starts_at: string
  ends_at: string
  status: string
}
type Member = { id: string; name: string | null }

function fmt(iso: string): string {
  return new Date(iso).toLocaleString('he-IL', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function MeetingsPage() {
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [team, setTeam] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [f, setF] = useState({ title: '', owner: '', location: '', notes: '' })
  const [startDate, setStartDate] = useState<Date | null>(null)
  const [endDate, setEndDate] = useState<Date | null>(null)

  const nameOf = (id: string | null) => team.find((m) => m.id === id)?.name || '—'

  async function load() {
    setLoading(true)
    const r = await fetch('/api/v1/meetings')
    const d = await r.json().catch(() => ({ meetings: [] }))
    setMeetings(d.meetings || [])
    setLoading(false)
  }
  useEffect(() => {
    fetch('/api/v1/team').then((r) => (r.ok ? r.json() : { members: [] })).then((d) => setTeam((d.members || []).map((m: Member) => ({ id: m.id, name: m.name })))).catch(() => {})
    load()
  }, [])

  async function create() {
    if (!f.title.trim() || !startDate || busy) return
    setBusy(true)
    setMsg(null)
    const start = startDate
    const end = endDate || new Date(start.getTime() + 60 * 60000)
    const body: Record<string, unknown> = { title: f.title.trim(), starts_at: start.toISOString(), ends_at: end.toISOString() }
    if (f.owner) body.owner_user_id = f.owner
    if (f.location) body.location = f.location
    if (f.notes) body.notes = f.notes
    const r = await fetch('/api/v1/meetings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const d = await r.json().catch(() => ({}))
    setBusy(false)
    if (r.ok) {
      setMsg(d.warning || 'הפגישה נוצרה' + (d.google_event_id ? ' וסונכרנה ליומן Google' : ''))
      setF({ title: '', owner: '', location: '', notes: '' })
      setStartDate(null); setEndDate(null)
      setOpen(false)
      load()
    } else {
      setMsg('שגיאה ביצירת הפגישה')
    }
  }

  async function cancel(id: string) {
    if (!confirm('לבטל את הפגישה?')) return
    setMeetings((prev) => prev.filter((m) => m.id !== id))
    await fetch(`/api/v1/meetings/${id}`, { method: 'DELETE' }).catch(() => load())
  }

  return (
    <main className="pb-20" dir="rtl">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">פגישות</h1>
        <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 rounded-md bg-brand-primary px-4 py-2 text-sm font-medium text-white">
          <Plus className="h-4 w-4" /> פגישה חדשה
        </button>
      </div>

      {msg && <div className="surface-card mb-3 p-2 text-sm text-gray-700">{msg}</div>}

      {open && (
        <div className="surface-card mb-4 space-y-2 p-3">
          <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="כותרת הפגישה" className="w-full rounded-md border border-brand-border px-3 py-2 text-sm" />
          <div className="flex flex-wrap gap-2">
            <select value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })} className="rounded-md border border-brand-border px-2 py-2 text-sm">
              <option value="">היומן שלי</option>
              {team.map((m) => <option key={m.id} value={m.id}>{m.name || m.id}</option>)}
            </select>
            <span className="flex items-center gap-1 text-xs text-gray-500">התחלה <DateTimeField value={startDate} onChange={setStartDate} placeholder="מתי?" /></span>
            <span className="flex items-center gap-1 text-xs text-gray-500">סיום <DateTimeField value={endDate} onChange={setEndDate} placeholder="(אופציונלי)" /></span>
          </div>
          <input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="מיקום (לא חובה)" className="w-full rounded-md border border-brand-border px-3 py-2 text-sm" />
          <textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="הערות (לא חובה)" rows={2} className="w-full rounded-md border border-brand-border px-3 py-2 text-sm" />
          <button onClick={create} disabled={!f.title.trim() || !startDate || busy} className="flex items-center gap-1 rounded-md bg-brand-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} צור פגישה
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-brand-primary" /></div>
      ) : meetings.length === 0 ? (
        <div className="surface-card flex flex-col items-center gap-2 p-8 text-center text-sm text-gray-500">
          <CalendarDays className="h-6 w-6" /> אין פגישות קרובות.
        </div>
      ) : (
        <div className="space-y-2">
          {meetings.map((m) => (
            <div key={m.id} className="surface-card flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{m.title}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                  <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{fmt(m.starts_at)}</span>
                  <span className="inline-flex items-center gap-1"><UserIcon className="h-3 w-3" />{nameOf(m.owner_user_id)}</span>
                  {m.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{m.location}</span>}
                  {m.google_event_id ? <span className="text-green-600">● Google</span> : <span className="text-amber-600">● מקומי</span>}
                </div>
              </div>
              <button onClick={() => cancel(m.id)} title="בטל" className="shrink-0 rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600">
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </main>
  )
}

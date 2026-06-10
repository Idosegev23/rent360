'use client'
import { useEffect, useState } from 'react'
import { Loader2, Plus, Phone, Mail, Check } from 'lucide-react'

type Member = {
  id: string
  name: string
  email: string
  phone: string | null
  role: string
  title: string | null
  is_active: boolean
  receives_alerts: boolean
}

export default function TeamPage() {
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', phone: '', title: '' })
  const [busy, setBusy] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const r = await fetch('/api/v1/team')
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error?.message || 'load failed')
      setMembers(d.members || [])
      setError(null)
    } catch (e) { setError(e instanceof Error ? e.message : 'load failed') } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  async function addMember() {
    if (busy || !form.name.trim() || !form.email.trim()) return
    setBusy(true)
    try {
      const r = await fetch('/api/v1/team', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      const d = await r.json()
      if (!r.ok || d.error) throw new Error(d?.error?.message || 'נכשל')
      setForm({ name: '', email: '', phone: '', title: '' }); setShowAdd(false); load()
    } catch (e) { alert(e instanceof Error ? e.message : 'נכשל') } finally { setBusy(false) }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setMembers(ms => ms.map(m => m.id === id ? { ...m, ...body } as Member : m)) // optimistic
    await fetch(`/api/v1/team/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 pb-24" dir="rtl">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">צוות</h1>
        <button onClick={() => setShowAdd(s => !s)} className="inline-flex items-center gap-1.5 rounded-md bg-brand-primary px-3 py-1.5 text-sm font-medium text-white">
          <Plus className="h-4 w-4" /> הוסף איש צוות
        </button>
      </div>
      <p className="mb-4 text-sm text-gray-500">לכולם הרשאות זהות — כל אחד רואה ומנהל הכל. השיוך (משימות/פגישות) הוא פרטני לכל עובד.</p>

      {showAdd && (
        <div className="mb-4 rounded-lg border border-brand-border bg-white p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input className="rounded-md border border-gray-300 px-2 py-1.5 text-sm" placeholder="שם" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            <input className="rounded-md border border-gray-300 px-2 py-1.5 text-sm" placeholder="אימייל (Google)" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} dir="ltr" />
            <input className="rounded-md border border-gray-300 px-2 py-1.5 text-sm" placeholder="טלפון" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} dir="ltr" />
            <input className="rounded-md border border-gray-300 px-2 py-1.5 text-sm" placeholder="תפקיד (אופציונלי)" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          </div>
          <button onClick={addMember} disabled={busy} className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} הוסף
          </button>
        </div>
      )}

      {loading && <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-brand-primary" /></div>}
      {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

      <div className="grid grid-cols-1 gap-2">
        {members.map(m => (
          <div key={m.id} className={`rounded-lg border border-brand-border bg-white p-3 ${m.is_active ? '' : 'opacity-60'}`}>
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-900">{m.name}</span>
                  {m.title && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">{m.title}</span>}
                  {!m.is_active && <span className="rounded bg-gray-200 px-1.5 py-0.5 text-xs text-gray-600">לא פעיל</span>}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-3 text-xs text-gray-500">
                  <span className="inline-flex items-center gap-1" dir="ltr"><Mail className="h-3 w-3" />{m.email}</span>
                  {m.phone && <span className="inline-flex items-center gap-1" dir="ltr"><Phone className="h-3 w-3" />{m.phone}</span>}
                </div>
              </div>
              <label className="flex items-center gap-1.5 text-xs text-gray-600">
                <input type="checkbox" checked={m.receives_alerts} onChange={e => patch(m.id, { receives_alerts: e.target.checked })} />
                התראות וואטסאפ
              </label>
              <label className="flex items-center gap-1.5 text-xs text-gray-600">
                <input type="checkbox" checked={m.is_active} onChange={e => patch(m.id, { is_active: e.target.checked })} />
                פעיל
              </label>
            </div>
          </div>
        ))}
      </div>
    </main>
  )
}

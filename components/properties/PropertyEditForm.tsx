'use client'
import { useState } from 'react'
import { supabaseBrowser } from '../../lib/supabase'

export default function PropertyEditForm({ item, onSaved }: { item: any; onSaved?: () => void }){
  const [title, setTitle] = useState<string>(item.title || '')
  const [price, setPrice] = useState<number>(item.price || 0)
  const [rooms, setRooms] = useState<number>(item.rooms || 0)
  const [sqm, setSqm] = useState<number>(item.sqm || 0)
  const [link, setLink] = useState<string>(item.link || '')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setMsg(null)
    setErr(null)
    try {
      const sb = supabaseBrowser()
      const { error } = await sb
        .from('properties')
        .update({ title, price, rooms, sqm, link })
        .eq('id', item.id)
        .select()
      if (error) throw error
      setMsg('השינויים נשמרו')
      onSaved?.()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block text-brand-inkMuted">כותרת</span>
          <input className="w-full rounded-md border border-brand-border p-2" value={title} onChange={e=>setTitle(e.target.value)} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-brand-inkMuted">מחיר (₪)</span>
          <input type="number" className="w-full rounded-md border border-brand-border p-2" value={price} onChange={e=>setPrice(Number(e.target.value||0))} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-brand-inkMuted">חדרים</span>
          <input type="number" className="w-full rounded-md border border-brand-border p-2" value={rooms} onChange={e=>setRooms(Number(e.target.value||0))} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-brand-inkMuted">מ&quot;ר</span>
          <input type="number" className="w-full rounded-md border border-brand-border p-2" value={sqm} onChange={e=>setSqm(Number(e.target.value||0))} />
        </label>
        <label className="block text-sm sm:col-span-2">
          <span className="mb-1 block text-brand-inkMuted">קישור למודעה</span>
          <input className="w-full rounded-md border border-brand-border p-2" value={link} onChange={e=>setLink(e.target.value)} />
        </label>
      </div>
      {err && <div className="text-sm text-red-600">{err}</div>}
      {msg && <div className="text-sm text-green-600">{msg}</div>}
      <button disabled={saving} className="rounded-md bg-brand-primary px-4 py-2 font-medium text-white disabled:opacity-50">שמירה</button>
    </form>
  )
}


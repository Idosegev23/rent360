'use client'
import { useState } from 'react'
import { z } from 'zod'
import { PropertyInputSchema } from '../../../lib/schemas'
import { PROPERTY_TYPES } from '../../../lib/constants'
import { supabaseBrowser } from '../../../lib/supabase'

export default function NewPropertyPage(){
  const [form, setForm] = useState({
    source_id: '', type:'', title: '', region:'', city: '', neighborhood: '', address: '', street:'', floor:'', price: '', rooms: '', sqm: '', link: '',
    amenities: { mamad:false, miklat:false, elevator:false, balcony:false, garden:false, parking:false, storage:false, ac_central:false, ac_rooms:false, screens:false, bars:false } as Record<string, boolean>,
    available_from: ''
  })
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string|null>(null)
  const [msg, setMsg] = useState<string|null>(null)

  async function onSubmit(e: React.FormEvent){
    e.preventDefault()
    setLoading(true)
    setErr(null)
    setMsg(null)
    try{
      const parsed = PropertyInputSchema.safeParse({
        source_id: form.source_id,
        type: form.type || undefined,
        title: form.title,
        region: form.region || undefined,
        city: form.city,
        neighborhood: form.neighborhood || undefined,
        address: form.address || undefined,
        street: form.street || undefined,
        floor: form.floor? Number(form.floor): undefined,
        price: Number(form.price),
        rooms: form.rooms? Number(form.rooms): undefined,
        sqm: form.sqm? Number(form.sqm): undefined,
        amenities: form.amenities,
        available_from: form.available_from || undefined,
        link: form.link || undefined,
      })
      if(!parsed.success){
        setErr('אנא מלאו את כל השדות החובה (מסומנים).')
        return
      }
      const sb = supabaseBrowser()
      const { error } = await sb.from('properties').insert({
        ...parsed.data,
      } as any)
      if(error) throw error
      setMsg('הנכס נוסף בהצלחה')
      setForm({ source_id:'', type:'', title:'', region:'', city:'', neighborhood:'', address:'', street:'', floor:'', price:'', rooms:'', sqm:'', link:'', amenities:{ mamad:false, miklat:false, elevator:false, balcony:false, garden:false, parking:false, storage:false, ac_central:false, ac_rooms:false, screens:false, bars:false }, available_from:'' })
    }catch(e:any){ setErr(e.message) }
    finally{ setLoading(false) }
  }

  return (
    <main className="pb-20 space-y-4">
      <h1 className="text-2xl font-bold">נכס חדש</h1>
      <form onSubmit={onSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-sm"><span className="mb-1 block text-brand-inkMuted">מזהה מקור (חובה)</span>
          <input className="w-full rounded-md border border-brand-border p-2" value={form.source_id} onChange={e=>setForm(v=>({...v, source_id:e.target.value}))} required />
        </label>
        <label className="block text-sm"><span className="mb-1 block text-brand-inkMuted">סוג הנכס</span>
          <select className="w-full rounded-md border border-brand-border p-2" value={form.type} onChange={e=>setForm(v=>({...v, type:e.target.value}))}>
            <option value="">בחר/י</option>
            {PROPERTY_TYPES.map(t=>(<option key={t} value={t}>{t}</option>))}
          </select>
        </label>
        <label className="block text-sm"><span className="mb-1 block text-brand-inkMuted">כותרת (חובה)</span>
          <input className="w-full rounded-md border border-brand-border p-2" value={form.title} onChange={e=>setForm(v=>({...v, title:e.target.value}))} required />
        </label>
        <label className="block text-sm"><span className="mb-1 block text-brand-inkMuted">אזור</span>
          <input className="w-full rounded-md border border-brand-border p-2" value={form.region} onChange={e=>setForm(v=>({...v, region:e.target.value}))} />
        </label>
        <label className="block text-sm"><span className="mb-1 block text-brand-inkMuted">עיר (חובה)</span>
          <input className="w-full rounded-md border border-brand-border p-2" value={form.city} onChange={e=>setForm(v=>({...v, city:e.target.value}))} required />
        </label>
        <label className="block text-sm"><span className="mb-1 block text-brand-inkMuted">שכונה</span>
          <input className="w-full rounded-md border border-brand-border p-2" value={form.neighborhood} onChange={e=>setForm(v=>({...v, neighborhood:e.target.value}))} />
        </label>
        <label className="block text-sm sm:col-span-2"><span className="mb-1 block text-brand-inkMuted">כתובת</span>
          <input className="w-full rounded-md border border-brand-border p-2" value={form.address} onChange={e=>setForm(v=>({...v, address:e.target.value}))} />
        </label>
        <label className="block text-sm"><span className="mb-1 block text-brand-inkMuted">רחוב</span>
          <input className="w-full rounded-md border border-brand-border p-2" value={form.street} onChange={e=>setForm(v=>({...v, street:e.target.value}))} />
        </label>
        <label className="block text-sm"><span className="mb-1 block text-brand-inkMuted">קומה</span>
          <input type="number" className="w-full rounded-md border border-brand-border p-2" value={form.floor} onChange={e=>setForm(v=>({...v, floor:e.target.value}))} />
        </label>
        <label className="block text-sm"><span className="mb-1 block text-brand-inkMuted">מחיר (חובה)</span>
          <input type="number" className="w-full rounded-md border border-brand-border p-2" value={form.price} onChange={e=>setForm(v=>({...v, price:e.target.value}))} required />
        </label>
        <label className="block text-sm"><span className="mb-1 block text-brand-inkMuted">חדרים</span>
          <input type="number" className="w-full rounded-md border border-brand-border p-2" value={form.rooms} onChange={e=>setForm(v=>({...v, rooms:e.target.value}))} />
        </label>
        <label className="block text-sm"><span className="mb-1 block text-brand-inkMuted">מ&quot;ר</span>
          <input type="number" className="w-full rounded-md border border-brand-border p-2" value={form.sqm} onChange={e=>setForm(v=>({...v, sqm:e.target.value}))} />
        </label>
        <label className="block text-sm sm:col-span-2"><span className="mb-1 block text-brand-inkMuted">תאריך כניסה</span>
          <input type="date" className="w-full rounded-md border border-brand-border p-2" value={form.available_from} onChange={e=>setForm(v=>({...v, available_from:e.target.value}))} />
        </label>
        <label className="block text-sm sm:col-span-2"><span className="mb-1 block text-brand-inkMuted">קישור למודעה</span>
          <input className="w-full rounded-md border border-brand-border p-2" value={form.link} onChange={e=>setForm(v=>({...v, link:e.target.value}))} />
        </label>
        <div className="sm:col-span-2">
          <div className="mb-1 text-sm text-brand-inkMuted">מאפיינים</div>
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
            {Object.entries(form.amenities).map(([k,val])=> (
              <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={val} onChange={e=>setForm(v=>({...v, amenities:{...v.amenities, [k]: e.target.checked}}))} /> {k}</label>
            ))}
          </div>
        </div>
        {err && <div className="sm:col-span-2 text-sm text-red-600">{err}</div>}
        {msg && <div className="sm:col-span-2 text-sm text-green-600">{msg}</div>}
        <div className="sm:col-span-2">
          <button disabled={loading} className="rounded-md bg-brand-primary px-4 py-2 font-medium text-white disabled:opacity-50">הוסף נכס</button>
        </div>
      </form>
    </main>
  )
}


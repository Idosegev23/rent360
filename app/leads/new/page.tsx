'use client'
import { useState } from 'react'
import { LeadInputSchema } from '../../../lib/schemas'
import { REGIONS } from '../../../lib/constants'
import { supabaseBrowser } from '../../../lib/supabase'

export default function NewLeadPage(){
  const [form, setForm] = useState({
    source_id:'', first_name:'', last_name:'', phone:'', email:'', budget_min:'', budget_max:'', preferred_regions:[] as string[], preferred_cities:'', preferred_rooms:'', pets:false, long_term:false, smokers:false, notes:'', required_fields: {} as Record<string, boolean>
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
      const parsed = LeadInputSchema.safeParse({
        source_id: form.source_id,
        first_name: form.first_name || undefined,
        last_name: form.last_name || undefined,
        phone: form.phone,
        email: form.email || undefined,
        budget_min: form.budget_min? Number(form.budget_min): undefined,
        budget_max: form.budget_max? Number(form.budget_max): undefined,
        preferred_regions: form.preferred_regions,
        preferred_cities: form.preferred_cities? form.preferred_cities.split(',').map(s=>s.trim()).filter(Boolean): undefined,
        preferred_rooms: form.preferred_rooms? Number(form.preferred_rooms): undefined,
        pets: form.pets || undefined,
        long_term: form.long_term || undefined,
        smokers: form.smokers || undefined,
        required_fields: form.required_fields,
        notes: form.notes || undefined,
      })
      if(!parsed.success){ setErr('אנא מלאו שדות חובה (מסומנים)'); return }
      const sb = supabaseBrowser()
      const { error } = await sb.from('leads').insert(parsed.data as any)
      if(error) throw error
      setMsg('הליד נוסף בהצלחה')
      setForm({ source_id:'', first_name:'', last_name:'', phone:'', email:'', budget_min:'', budget_max:'', preferred_regions:[], preferred_cities:'', preferred_rooms:'', pets:false, long_term:false, smokers:false, notes:'', required_fields:{} })
    }catch(e:any){ setErr(e.message) } finally { setLoading(false) }
  }

  return (
    <main className="pb-20 space-y-4">
      <h1 className="text-2xl font-bold">ליד חדש</h1>
      <form onSubmit={onSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-sm"><span className="mb-1 block text-brand-inkMuted">מזהה מקור (חובה)</span>
          <input className="w-full rounded-md border border-brand-border p-2" value={form.source_id} onChange={e=>setForm(v=>({...v, source_id:e.target.value}))} required />
        </label>
        <label className="block text-sm"><span className="mb-1 block text-brand-inkMuted">שם פרטי</span>
          <input className="w-full rounded-md border border-brand-border p-2" value={form.first_name} onChange={e=>setForm(v=>({...v, first_name:e.target.value}))} />
        </label>
        <label className="block text-sm"><span className="mb-1 block text-brand-inkMuted">שם משפחה</span>
          <input className="w-full rounded-md border border-brand-border p-2" value={form.last_name} onChange={e=>setForm(v=>({...v, last_name:e.target.value}))} />
        </label>
        <label className="block text-sm"><span className="mb-1 block text-brand-inkMuted">טלפון (חובה)</span>
          <input className="w-full rounded-md border border-brand-border p-2" value={form.phone} onChange={e=>setForm(v=>({...v, phone:e.target.value}))} required />
        </label>
        <label className="block text-sm"><span className="mb-1 block text-brand-inkMuted">אימייל</span>
          <input type="email" className="w-full rounded-md border border-brand-border p-2" value={form.email} onChange={e=>setForm(v=>({...v, email:e.target.value}))} />
        </label>
        <label className="block text-sm"><span className="mb-1 block text-brand-inkMuted">תקציב מינ׳</span>
          <input type="number" className="w-full rounded-md border border-brand-border p-2" value={form.budget_min} onChange={e=>setForm(v=>({...v, budget_min:e.target.value}))} />
        </label>
        <label className="block text-sm"><span className="mb-1 block text-brand-inkMuted">תקציב מקס׳</span>
          <input type="number" className="w-full rounded-md border border-brand-border p-2" value={form.budget_max} onChange={e=>setForm(v=>({...v, budget_max:e.target.value}))} />
        </label>
        <label className="block text-sm sm:col-span-2"><span className="mb-1 block text-brand-inkMuted">אזורים מועדפים (בחר/י כמה)</span>
          <div className="flex flex-wrap gap-2">
            {REGIONS.map(r => (
              <label key={r.key} className={`cursor-pointer rounded border px-2 py-1 text-sm ${form.preferred_regions.includes(r.key)?'bg-brand-bg':''}`}>
                <input type="checkbox" className="mr-1" checked={form.preferred_regions.includes(r.key)} onChange={(e)=>{
                  setForm(v=>({
                    ...v,
                    preferred_regions: e.target.checked? Array.from(new Set([...(v.preferred_regions||[]), r.key])) : (v.preferred_regions||[]).filter(x=>x!==r.key)
                  }))
                }} />
                {r.key}
              </label>
            ))}
          </div>
        </label>
        <label className="block text-sm sm:col-span-2"><span className="mb-1 block text-brand-inkMuted">ערים מועדפות (מופרד בפסיק)</span>
          <input className="w-full rounded-md border border-brand-border p-2" value={form.preferred_cities} onChange={e=>setForm(v=>({...v, preferred_cities:e.target.value}))} />
        </label>
        <div className="sm:col-span-2 grid grid-cols-2 gap-3">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.pets} onChange={e=>setForm(v=>({...v, pets:e.target.checked}))} /> מאפשר בעלי חיים</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.long_term} onChange={e=>setForm(v=>({...v, long_term:e.target.checked}))} /> לטווח ארוך</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.smokers} onChange={e=>setForm(v=>({...v, smokers:e.target.checked}))} /> למעשנים</label>
        </div>

        <div className="sm:col-span-2">
          <div className="mb-1 text-sm text-brand-inkMuted">שדות חובה (סמן/י מה חובה עבור הלקוח)</div>
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
            {['mamad','miklat','elevator','balcony','garden','parking','storage','ac_central','ac_rooms','screens','bars'].map(k => (
              <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={!!form.required_fields[k]} onChange={e=>setForm(v=>({...v, required_fields: {...v.required_fields, [k]: e.target.checked}}))} /> {k}</label>
            ))}
          </div>
        </div>
        <label className="block text-sm"><span className="mb-1 block text-brand-inkMuted">חדרים מועדפים</span>
          <input type="number" className="w-full rounded-md border border-brand-border p-2" value={form.preferred_rooms} onChange={e=>setForm(v=>({...v, preferred_rooms:e.target.value}))} />
        </label>
        <label className="block text-sm sm:col-span-2"><span className="mb-1 block text-brand-inkMuted">הערות</span>
          <textarea className="w-full rounded-md border border-brand-border p-2" value={form.notes} onChange={e=>setForm(v=>({...v, notes:e.target.value}))} />
        </label>
        {err && <div className="sm:col-span-2 text-sm text-red-600">{err}</div>}
        {msg && <div className="sm:col-span-2 text-sm text-green-600">{msg}</div>}
        <div className="sm:col-span-2">
          <button disabled={loading} className="rounded-md bg-brand-primary px-4 py-2 font-medium text-white disabled:opacity-50">הוסף ליד</button>
        </div>
      </form>
    </main>
  )
}


'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import PropertyCard from '../PropertyCard'

type Props = {
  items: any[]
}

export default function PropertiesView({ items }: Props){
  const [mode, setMode] = useState<'cards'|'table'>('cards')
  const [query, setQuery] = useState('')
  const [city, setCity] = useState('')
  const [sort, setSort] = useState<'created_at'|'price_desc'|'price_asc'>('created_at')
  const [priceMin, setPriceMin] = useState<string>('')
  const [priceMax, setPriceMax] = useState<string>('')
  const [roomsMin, setRoomsMin] = useState<string>('')
  const [roomsMax, setRoomsMax] = useState<string>('')
  const [status, setStatus] = useState<'all'|'active'|'inactive'>('all')

  const filtered = useMemo(() => {
    let res = Array.from(items || [])
    if(query){
      const q = query.toLowerCase()
      res = res.filter((p:any)=>[
        p.title, p.city, p.neighborhood, p.address
      ].filter(Boolean).some((s:string)=>s.toLowerCase().includes(q)))
    }
    if(city){ res = res.filter((p:any)=>p.city===city) }
    if(status!=='all'){
      res = res.filter((p:any)=> Boolean(p.is_active) === (status==='active'))
    }
    const pMin = priceMin? Number(priceMin) : null
    const pMax = priceMax? Number(priceMax) : null
    if(pMin!=null) res = res.filter((p:any)=> Number(p.price||0) >= pMin)
    if(pMax!=null) res = res.filter((p:any)=> Number(p.price||0) <= pMax)
    const rMin = roomsMin? Number(roomsMin) : null
    const rMax = roomsMax? Number(roomsMax) : null
    if(rMin!=null) res = res.filter((p:any)=> Number(p.rooms||0) >= rMin)
    if(rMax!=null) res = res.filter((p:any)=> Number(p.rooms||0) <= rMax)
    if(sort==='price_desc') res.sort((a:any,b:any)=>Number(b.price||0)-Number(a.price||0))
    else if(sort==='price_asc') res.sort((a:any,b:any)=>Number(a.price||0)-Number(b.price||0))
    else res.sort((a:any,b:any)=> new Date(b.created_at).getTime()-new Date(a.created_at).getTime())
    return res
  }, [items, query, city, sort, priceMin, priceMax, roomsMin, roomsMax, status])

  const uniqueCities = useMemo(()=>Array.from(new Set((items||[]).map((p:any)=>p.city).filter(Boolean))), [items])

  // Persist preferences
  useMemo(() => {
    try{
      const stored = localStorage.getItem('propertiesViewPrefs')
      if(stored){
        const v = JSON.parse(stored)
        if(v.mode) setMode(v.mode)
        if(typeof v.query==='string') setQuery(v.query)
        if(typeof v.city==='string') setCity(v.city)
        if(v.sort) setSort(v.sort)
        if(typeof v.priceMin==='string') setPriceMin(v.priceMin)
        if(typeof v.priceMax==='string') setPriceMax(v.priceMax)
        if(typeof v.roomsMin==='string') setRoomsMin(v.roomsMin)
        if(typeof v.roomsMax==='string') setRoomsMax(v.roomsMax)
        if(v.status) setStatus(v.status)
      }
    }catch{}
    // no deps: run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useMemo(() => {
    try{
      const prefs = { mode, query, city, sort, priceMin, priceMax, roomsMin, roomsMax, status }
      localStorage.setItem('propertiesViewPrefs', JSON.stringify(prefs))
    }catch{}
  }, [mode, query, city, sort, priceMin, priceMax, roomsMin, roomsMax, status])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="rounded-md border border-brand-border p-1">
          <button onClick={()=>setMode('cards')} className={`rounded px-2 py-1 text-sm ${mode==='cards'?'bg-brand-bg':''}`}>כרטיסיות</button>
          <button onClick={()=>setMode('table')} className={`rounded px-2 py-1 text-sm ${mode==='table'?'bg-brand-bg':''}`}>טבלה</button>
        </div>
        <input className="min-w-[200px] rounded-md border border-brand-border p-2 text-sm" placeholder="חיפוש חכם: כותרת/עיר/שכונה/כתובת" value={query} onChange={e=>setQuery(e.target.value)} />
        <select className="rounded-md border border-brand-border p-2 text-sm" value={city} onChange={e=>setCity(e.target.value)}>
          <option value="">כל הערים</option>
          {uniqueCities.map((c:string)=>(<option key={c} value={c}>{c}</option>))}
        </select>
        <select className="rounded-md border border-brand-border p-2 text-sm" value={status} onChange={e=>setStatus(e.target.value as any)}>
          <option value="all">כל הסטטוסים</option>
          <option value="active">פעיל</option>
          <option value="inactive">לא פעיל</option>
        </select>
        <div className="flex items-center gap-1 text-sm">
          <input className="w-24 rounded-md border border-brand-border p-2" placeholder="₪ מינ׳" value={priceMin} onChange={e=>setPriceMin(e.target.value)} />
          <span>–</span>
          <input className="w-24 rounded-md border border-brand-border p-2" placeholder="₪ מקס׳" value={priceMax} onChange={e=>setPriceMax(e.target.value)} />
        </div>
        <div className="flex items-center gap-1 text-sm">
          <input className="w-20 rounded-md border border-brand-border p-2" placeholder="חדרים מינ׳" value={roomsMin} onChange={e=>setRoomsMin(e.target.value)} />
          <span>–</span>
          <input className="w-20 rounded-md border border-brand-border p-2" placeholder="חדרים מקס׳" value={roomsMax} onChange={e=>setRoomsMax(e.target.value)} />
        </div>
        <select className="rounded-md border border-brand-border p-2 text-sm" value={sort} onChange={e=>setSort(e.target.value as any)}>
          <option value="created_at">חדשים קודם</option>
          <option value="price_desc">מחיר גבוה→נמוך</option>
          <option value="price_asc">מחיר נמוך→גבוה</option>
        </select>
        <button type="button" onClick={()=>{ setQuery(''); setCity(''); setSort('created_at'); setPriceMin(''); setPriceMax(''); setRoomsMin(''); setRoomsMax(''); setStatus('all') }} className="rounded-md border border-brand-border px-3 py-1 text-sm hover:bg-brand-bg">איפוס</button>
      </div>

      {mode==='cards' ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {filtered.map((p:any) => (
            <Link key={p.id} href={`/properties/${p.id}`}>
              <PropertyCard item={p} />
            </Link>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-brand-border bg-brand-bg text-brand-inkMuted">
                <th className="p-2 text-right">כותרת</th>
                <th className="p-2 text-right">עיר</th>
                <th className="p-2 text-right">מחיר</th>
                <th className="p-2 text-right">חדרים</th>
                <th className="p-2 text-right">מ&quot;ר</th>
                <th className="p-2 text-right">סטטוס</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p:any)=>(
                <tr key={p.id} className="border-b border-brand-border hover:bg-brand-bg">
                  <td className="p-2"><a className="underline" href={`/properties/${p.id}`}>{p.title}</a></td>
                  <td className="p-2">{p.city}</td>
                  <td className="p-2">₪{Number(p.price||0).toLocaleString()}</td>
                  <td className="p-2">{p.rooms||'—'}</td>
                  <td className="p-2">{p.sqm||'—'}</td>
                  <td className="p-2">{p.is_active? 'פעיל' : 'לא פעיל'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}


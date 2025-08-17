'use client'
import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

export default function DynamicChart(){
  const [entity, setEntity] = useState<'properties'|'leads'|'messages'>('properties')
  const [dim, setDim] = useState('city')
  const [range, setRange] = useState<'7d'|'30d'>('7d')
  const [series, setSeries] = useState<{label:string; value:number}[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const url = `/api/v1/dashboard/aggregations?entity=${entity}&dim=${dim}&range=${range}`
    setLoading(true)
    fetch(url).then(r=>r.json()).then(d=>setSeries(d.series||[])).finally(()=>setLoading(false))
  }, [entity, dim, range])

  const dimsByEntity: Record<string, { key:string; label:string }[]> = {
    properties: [
      { key:'city', label:'לפי עיר' },
      { key:'rooms', label:'לפי חדרים' },
    ],
    leads: [
      { key:'preferred_city', label:'ערים מועדפות' },
      { key:'preferred_rooms', label:'חדרים מועדפים' },
    ],
    messages: [
      { key:'status', label:'סטטוס הודעות' }
    ]
  }

  const defaultDim: Record<'properties'|'leads'|'messages', string> = {
    properties: 'city',
    leads: 'preferred_city',
    messages: 'status',
  }

  return (
    <div className="rounded-lg border border-brand-border bg-white p-4">
      <div className="mb-3 flex flex-wrap gap-2 text-sm">
        <select className="rounded-md border border-brand-border p-1" value={entity} onChange={e=>{
          const v = e.target.value as 'properties'|'leads'|'messages'
          setEntity(v)
          setDim(defaultDim[v])
        }}>
          <option value="properties">נכסים</option>
          <option value="leads">לידים</option>
          <option value="messages">הודעות</option>
        </select>
        <select className="rounded-md border border-brand-border p-1" value={dim} onChange={e=>setDim(e.target.value)}>
          {(dimsByEntity[entity] || []).map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
        </select>
        <select className="rounded-md border border-brand-border p-1" value={range} onChange={e=>setRange(e.target.value as any)}>
          <option value="7d">7 ימים</option>
          <option value="30d">30 ימים</option>
        </select>
      </div>
      {loading ? (
        <div className="text-sm text-brand-inkMuted">טוען גרף…</div>
      ) : (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={series}>
              <XAxis dataKey="label" tick={{ fontSize: 12 }} interval={0} angle={-20} height={60} />
              <YAxis />
              <Tooltip />
              <Bar dataKey="value" fill="#F2811D" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

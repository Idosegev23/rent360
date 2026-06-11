'use client'
import { useEffect, useState } from 'react'
import { UserCog, Loader2, Check } from 'lucide-react'

type Agent = { id: string; name: string | null }

/** Assigns the responsible agent for a property (the agents flagged handles_properties — שי / זיו).
 *  Interest alerts and viewing coordination route to whoever is set here. */
export default function AssignAgent({ propertyId, current }: { propertyId: string; current?: string | null }) {
  const [agents, setAgents] = useState<Agent[]>([])
  const [val, setVal] = useState(current || '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch('/api/v1/team').then(r => r.json())
      .then(d => setAgents((d.members || []).filter((m: any) => m.handles_properties).map((m: any) => ({ id: m.id, name: m.name }))))
      .catch(() => {})
  }, [])

  async function assign(v: string) {
    setVal(v); setSaving(true); setSaved(false)
    try {
      await fetch(`/api/v1/properties/${propertyId}/assign`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agentUserId: v || null }) })
      setSaved(true); setTimeout(() => setSaved(false), 2000)
    } catch {/* noop */} finally { setSaving(false) }
  }

  return (
    <div className="inline-flex items-center gap-1.5 rounded-lg border border-brand-border bg-white px-3 py-1.5 text-sm">
      <UserCog className="h-4 w-4 text-gray-500" />
      <span className="text-gray-600">סוכן מטפל:</span>
      <select value={val} onChange={e => assign(e.target.value)} disabled={saving} className="bg-transparent font-medium focus:outline-none">
        <option value="">לא משויך</option>
        {agents.map(a => <option key={a.id} value={a.id}>{a.name || a.id}</option>)}
      </select>
      {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" /> : saved ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : null}
    </div>
  )
}

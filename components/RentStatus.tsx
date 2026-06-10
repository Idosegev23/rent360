'use client'
import { useEffect, useState } from 'react'
import { Loader2, Home, RotateCcw } from 'lucide-react'

/** Active-tenancy banner with a re-rent action. When the property is rented through us, show it; on
 *  "סיום שכירות" the tenancy ends, the property goes back on-market and matches recompute. */
export default function RentStatus({ propertyId }: { propertyId: string }) {
  const [tenancyId, setTenancyId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [ended, setEnded] = useState(false)

  async function load() {
    try {
      const r = await fetch(`/api/v1/tenancies?propertyId=${propertyId}`)
      const d = await r.json()
      setTenancyId(d.existing?.id ?? null)
    } catch { setTenancyId(null) }
  }
  useEffect(() => { load() }, [propertyId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function endTenancy() {
    if (busy || !tenancyId) return
    if (!window.confirm('לסיים את השכירות? הנכס יחזור לשוק וההתאמות יחושבו מחדש.')) return
    setBusy(true)
    try {
      const r = await fetch(`/api/v1/tenancies/${tenancyId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'ended' }) })
      if (!r.ok) throw new Error('failed')
      setEnded(true); setTenancyId(null)
    } catch { window.alert('סיום השכירות נכשל') } finally { setBusy(false) }
  }

  if (ended) return <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 inline-flex items-center gap-1.5"><RotateCcw className="h-4 w-4" /> השכירות הסתיימה — הנכס חזר לשוק</div>
  if (!tenancyId) return null
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 flex items-center gap-2 text-sm text-blue-800">
      <Home className="h-4 w-4 shrink-0" />
      <span className="flex-1">מושכר דרכנו</span>
      <button onClick={endTenancy} disabled={busy} className="inline-flex items-center gap-1 rounded-md border border-blue-300 bg-white px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50">
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />} סיום שכירות (השכרה חוזרת)
      </button>
    </div>
  )
}

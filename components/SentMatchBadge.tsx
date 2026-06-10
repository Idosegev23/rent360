'use client'

import { useState, useEffect } from 'react'
import { Target } from 'lucide-react'

/**
 * Shows, on a property, which renters it was already sent to as a match — so the team can see at a
 * glance that this apartment was offered and avoid blasting it to other people. Reads the matches
 * API (renter_notified_at marks a sent match).
 */
export default function SentMatchBadge({ propertyId }: { propertyId: string }) {
  const [names, setNames] = useState<string[] | null>(null)

  useEffect(() => {
    let alive = true
    fetch(`/api/v1/matches?property_id=${propertyId}`)
      .then(r => r.json())
      .then(d => {
        if (!alive) return
        const sent = (d.matches || []).filter((m: any) => m.renter_notified_at)
        const ns = sent.map((m: any) => [m.renter?.first_name, m.renter?.last_name].filter(Boolean).join(' ') || 'שוכר')
        setNames(Array.from(new Set<string>(ns)))
      })
      .catch(() => { if (alive) setNames([]) })
    return () => { alive = false }
  }, [propertyId])

  if (!names || names.length === 0) return null
  return (
    <div className="inline-flex items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700">
      <Target className="h-4 w-4 shrink-0" />
      {names.length === 1
        ? <span>נשלח כהתאמה ל{names[0]}</span>
        : <span title={names.join(', ')}>נשלח כהתאמה ל-{names.length} שוכרים: {names.join(', ')}</span>}
    </div>
  )
}

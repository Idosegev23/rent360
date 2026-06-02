'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

type Item = {
  id: string
  renterId: string | null
  renterName: string
  propertyLocation: string
  createdAt: string
}

/** Dashboard widget: renters who clicked "interested in viewing" on their /share link. */
export default function RecentInterest() {
  const [items, setItems] = useState<Item[]>([])

  useEffect(() => {
    let cancelled = false
    fetch('/api/v1/notifications')
      .then(r => r.json())
      .then(d => { if (!cancelled) setItems((d.items || []).slice(0, 6)) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  if (items.length === 0) return null

  return (
    <section className="mb-6 rounded-xl border bg-white p-4" style={{ borderColor: 'var(--line)' }}>
      <div className="flex items-center gap-2 mb-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100">✋</span>
        <h2 className="font-semibold text-gray-900">שוכרים שמעוניינים בדירה ({items.length})</h2>
      </div>
      <div className="grid gap-2">
        {items.map(i => (
          <Link
            key={i.id}
            href={i.renterId ? `/renters/${i.renterId}` : '/inbox'}
            className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 no-underline hover:bg-gray-50"
            style={{ borderColor: 'var(--line)' }}
          >
            <div className="text-sm">
              <span className="font-semibold text-gray-900">{i.renterName}</span>{' '}
              <span className="text-gray-600">מעוניין/ת לראות דירה</span>
            </div>
            <div className="text-xs text-gray-500 shrink-0">🏠 {i.propertyLocation}</div>
          </Link>
        ))}
      </div>
    </section>
  )
}

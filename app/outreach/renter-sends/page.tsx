'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'

type Send = {
  id: string
  sent_at: string
  renter_name: string
  renter_id: string | null
  property_label: string | null
  property_id: string | null
  sent_by_name: string
  thread_id: string | null
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function RenterSendsLogPage() {
  const [rows, setRows] = useState<Send[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/v1/outreach/renter-sends')
      .then((r) => (r.ok ? r.json() : { sends: [] }))
      .then((d) => { setRows(d.sends || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  return (
    <main className="pb-20" dir="rtl">
      <h1 className="mb-1 text-2xl font-bold">יומן שליחות לשוכרים</h1>
      <p className="mb-4 text-sm text-gray-500">כל התאמה שנשלחה לשוכר — מי שלח, מתי, ואיזה נכס.</p>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-brand-primary" /></div>
      ) : rows.length === 0 ? (
        <div className="surface-card p-8 text-center text-sm text-gray-500">עדיין לא נשלחו התאמות לשוכרים.</div>
      ) : (
        <div className="surface-card overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b text-right text-xs text-gray-500">
                <th className="px-3 py-2 font-medium">תאריך</th>
                <th className="px-3 py-2 font-medium">שוכר</th>
                <th className="px-3 py-2 font-medium">נכס</th>
                <th className="px-3 py-2 font-medium">נשלח ע״י</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className="border-b last:border-0">
                  <td className="whitespace-nowrap px-3 py-2 text-gray-600">{fmt(s.sent_at)}</td>
                  <td className="px-3 py-2">
                    {s.renter_id ? <Link href={`/renters/${s.renter_id}`} className="text-brand-primary hover:underline">{s.renter_name}</Link> : s.renter_name}
                  </td>
                  <td className="px-3 py-2">
                    {s.property_id ? <Link href={`/properties/${s.property_id}`} className="text-brand-primary hover:underline">{s.property_label || 'נכס'}</Link> : (s.property_label || '—')}
                  </td>
                  <td className="px-3 py-2">{s.sent_by_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}

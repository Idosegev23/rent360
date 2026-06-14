'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, Home, User, Phone, Calendar, Coins, KeyRound, FileText, ChevronDown } from 'lucide-react'
import DocumentsPanel from '@/components/DocumentsPanel'

type Tenancy = {
  id: string
  renter_id: string | null
  property_id: string | null
  started_at: string | null
  monthly_rent: number | null
  commission_amount: number | null
  created_at: string
  renter_name: string
  renter_phone: string | null
  property_label: string
  property_rooms: number | null
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('he-IL') } catch { return iso }
}

export default function RentedPage() {
  const [rows, setRows] = useState<Tenancy[]>([])
  const [loading, setLoading] = useState(true)
  const [openDocs, setOpenDocs] = useState<Record<string, boolean>>({})

  useEffect(() => {
    fetch('/api/v1/tenancies')
      .then((r) => (r.ok ? r.json() : { tenancies: [] }))
      .then((d) => { setRows(d.tenancies || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  return (
    <main className="pb-20" dir="rtl">
      <h1 className="mb-1 flex items-center gap-2 text-2xl font-bold"><KeyRound className="h-6 w-6 text-emerald-600" /> הושכרו על ידינו</h1>
      <p className="mb-4 text-sm text-gray-500">עסקאות שנסגרו דרכנו — מי השוכר, תנאי העסקה, והמסמכים (חוזה, ביטחונות).</p>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-brand-primary" /></div>
      ) : rows.length === 0 ? (
        <div className="surface-card p-8 text-center text-sm text-gray-500">עדיין לא נסגרו עסקאות. סגירת עסקה נעשית מכפתור &quot;נסגרה עסקה&quot; בדף נכס/שוכר.</div>
      ) : (
        <div className="space-y-3">
          {rows.map((t) => {
            const docsOpen = !!openDocs[t.id]
            return (
              <div key={t.id} className="surface-card p-4" dir="rtl">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 font-semibold">
                      <Home className="h-4 w-4 text-gray-400" />
                      {t.property_id ? (
                        <Link href={`/properties/${t.property_id}`} className="text-brand-primary hover:underline">{t.property_label}</Link>
                      ) : t.property_label}
                      {t.property_rooms != null && <span className="text-xs text-gray-400">· {t.property_rooms} חד׳</span>}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-gray-600">
                      <span className="inline-flex items-center gap-1">
                        <User className="h-3.5 w-3.5" />
                        {t.renter_id ? <Link href={`/renters/${t.renter_id}`} className="text-brand-primary hover:underline">{t.renter_name}</Link> : t.renter_name}
                      </span>
                      {t.renter_phone && <span className="inline-flex items-center gap-1 text-gray-500"><Phone className="h-3.5 w-3.5" />{t.renter_phone}</span>}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {t.monthly_rent != null && <span className="rounded-full bg-gray-100 px-2 py-1">₪{Number(t.monthly_rent).toLocaleString('he-IL')} / חודש</span>}
                    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-1"><Calendar className="h-3 w-3" />כניסה {fmtDate(t.started_at)}</span>
                    {t.commission_amount != null && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-emerald-700"><Coins className="h-3 w-3" />עמלה ₪{Number(t.commission_amount).toLocaleString('he-IL')}</span>}
                  </div>
                </div>

                <button
                  onClick={() => setOpenDocs((s) => ({ ...s, [t.id]: !s[t.id] }))}
                  className="mt-3 inline-flex items-center gap-1 text-sm text-brand-primary hover:underline"
                >
                  <FileText className="h-4 w-4" /> מסמכים (חוזה / ביטחונות / ת״ז)
                  <ChevronDown className={`h-4 w-4 transition-transform ${docsOpen ? 'rotate-180' : ''}`} />
                </button>
                {docsOpen && (
                  <div className="mt-2">
                    <DocumentsPanel entityType="tenancy" entityId={t.id} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </main>
  )
}

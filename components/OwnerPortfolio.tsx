'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Building2 } from 'lucide-react'

type P = { id: string; street: string | null; address: string | null; city: string | null; price: number | null; rooms: number | null; is_active: boolean }

/** "Other properties of this owner" — shown on the property page so the team sees the full portfolio
 *  (and avoids spamming a landlord who listed many units). */
export default function OwnerPortfolio({ propertyId, phone, ownerName }: { propertyId: string; phone: string | null | undefined; ownerName?: string | null }) {
  const [items, setItems] = useState<P[] | null>(null)
  useEffect(() => {
    if (!phone) { setItems([]); return }
    fetch(`/api/v1/owner-properties?phone=${encodeURIComponent(phone)}`).then(r => r.json())
      .then(d => setItems((d.properties || []).filter((p: P) => p.id !== propertyId)))
      .catch(() => setItems([]))
  }, [phone, propertyId])

  if (!items || items.length === 0) return null
  return (
    <div className="surface-card" style={{ padding: 14 }}>
      <div className="faint mb-2 inline-flex items-center gap-1.5" style={{ fontSize: 12, fontWeight: 700 }}>
        <Building2 size={13} /> עוד {items.length} נכסים של {ownerName || 'אותו בעל דירה'}
      </div>
      {items.map(p => (
        <Link key={p.id} href={`/properties/${p.id}`} className="flex items-center gap-2 py-1.5 no-underline" style={{ borderTop: '1px solid var(--line)', color: 'var(--ink)' }}>
          <span className="flex-1 truncate text-sm">{[p.street || p.address, p.city].filter(Boolean).join(', ') || 'נכס'}</span>
          {p.price != null && <span className="num faint" style={{ fontSize: 12 }}>₪{Number(p.price).toLocaleString('he-IL')}</span>}
          {!p.is_active && <span className="pill pill-gray" style={{ fontSize: 10 }}>לא פעיל</span>}
        </Link>
      ))}
    </div>
  )
}

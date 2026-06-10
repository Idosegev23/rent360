import { NextResponse } from 'next/server'
import { requireOrg } from '../../../../lib/api/org-context'

/** Commission tracking across closed deals (tenancies): expected / collected / outstanding + per-deal. */
export async function GET() {
  const ctx = await requireOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  const { sb, orgId } = ctx

  const { data: tens } = await sb
    .from('tenancies')
    .select('id, renter_id, property_id, monthly_rent, commission_amount, commission_status, commission_collected_at, status, started_at, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(300)
  const rows = tens || []

  const rIds = Array.from(new Set(rows.map(t => t.renter_id).filter(Boolean))) as string[]
  const pIds = Array.from(new Set(rows.map(t => t.property_id).filter(Boolean))) as string[]
  const renters = rIds.length ? ((await sb.from('renters').select('id, first_name, last_name').in('id', rIds)).data || []) : []
  const props = pIds.length ? ((await sb.from('properties').select('id, street, address, city').in('id', pIds)).data || []) : []
  const rName = new Map(renters.map(r => [r.id, [r.first_name, r.last_name].filter(Boolean).join(' ') || 'שוכר']))
  const pLabel = new Map(props.map(p => [p.id, [p.street || p.address, p.city].filter(Boolean).join(', ') || 'נכס']))

  const items = rows.map(t => ({
    id: t.id,
    renter: rName.get(t.renter_id) || '—',
    property: pLabel.get(t.property_id) || '—',
    amount: t.commission_amount != null ? Number(t.commission_amount) : null,
    monthly_rent: t.monthly_rent != null ? Number(t.monthly_rent) : null,
    status: t.commission_status || 'pending',
    started_at: t.started_at,
    tenancy_status: t.status,
  }))
  const sum = (f: (i: typeof items[number]) => boolean) => items.filter(f).reduce((s, i) => s + (i.amount || 0), 0)
  return NextResponse.json({
    items,
    totals: {
      expected: sum(() => true),
      collected: sum(i => i.status === 'collected'),
      pending: sum(i => i.status === 'pending'),
    },
  })
}

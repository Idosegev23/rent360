import { NextResponse } from 'next/server'
import { requireOrg } from '../../../../lib/api/org-context'

/** Office KPIs: inventory, funnel, deals, commissions, viewings, lead sources. */
export async function GET() {
  const ctx = await requireOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  const { sb, orgId } = ctx
  const count = async (table: string, build: (q: any) => any) => {
    const { count } = await build(sb.from(table).select('id', { count: 'exact', head: true }).eq('org_id', orgId))
    return count || 0
  }
  const monthStart = (() => { const d = new Date(); d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0); return d.toISOString() })()

  const [propsTotal, propsActive, approved, vettedRenters, rentersTotal] = await Promise.all([
    count('properties', q => q),
    count('properties', q => q.or('is_active.is.null,is_active.eq.true')),
    count('approved_properties', q => q.is('irrelevant_at', null)),
    count('renters', q => q.gt('submissions_count', 0)),
    count('renters', q => q),
  ])

  const { data: tens } = await sb.from('tenancies').select('status, commission_amount, commission_status, created_at').eq('org_id', orgId).limit(1000)
  const deals = tens || []
  const sumIf = (f: (t: any) => boolean) => deals.filter(f).reduce((s, t) => s + (Number(t.commission_amount) || 0), 0)
  const dealsClosedThisMonth = deals.filter(t => (t.created_at || '') >= monthStart).length

  const { data: viewings } = await sb.from('meetings').select('outcome').eq('org_id', orgId).eq('kind', 'viewing').limit(1000)
  const vOut: Record<string, number> = {}
  for (const v of viewings || []) { const k = v.outcome || 'pending'; vOut[k] = (vOut[k] || 0) + 1 }

  const { data: srcRows } = await sb.from('properties').select('source').eq('org_id', orgId).not('source', 'is', null).limit(5000)
  const srcCounts: Record<string, number> = {}
  for (const r of srcRows || []) { const s = String(r.source).split(' - ')[0]!.trim() || 'אחר'; srcCounts[s] = (srcCounts[s] || 0) + 1 }
  const sources = Object.entries(srcCounts).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, n]) => ({ name, n }))

  return NextResponse.json({
    inventory: { properties: propsTotal, active: propsActive, approved },
    renters: { total: rentersTotal, vetted: vettedRenters },
    deals: { total: deals.length, active: deals.filter(t => t.status === 'active').length, ended: deals.filter(t => t.status === 'ended').length, closedThisMonth: dealsClosedThisMonth },
    commissions: { expected: sumIf(() => true), collected: sumIf(t => t.commission_status === 'collected'), pending: sumIf(t => t.commission_status === 'pending') },
    viewings: vOut,
    sources,
  })
}

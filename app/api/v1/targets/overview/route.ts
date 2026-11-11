import { NextRequest, NextResponse } from 'next/server'
import { requireOrg, capabilitiesOf } from '../../../../../lib/api/org-context'
import { israelDateOf, monthStartIso, nextMonthStartIso } from '../../../../../lib/board/stages'

/**
 * Monthly targets vs. actuals for the dashboard header.
 * Everyone gets their own row. Staff with `company.dashboard` also get every agent plus company totals.
 * Actuals are closed rentals (tenancies) credited to whoever recorded them, in the month of move-in
 * (else the month recorded) — the same rule the agent board uses. Sales are not tracked in the system
 * yet, so the sale split is zero and `salesTracked` is false.
 */
export const dynamic = 'force-dynamic'

type Split = { deals: number; commission: number }
type AgentRow = {
  id: string
  name: string
  targetDeals: number
  targetCommission: number
  actualDeals: number
  actualCommission: number
  rent: Split
  sale: Split
}

export async function GET(req: NextRequest) {
  const ctx = await requireOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  const { sb, orgId, uid } = ctx

  const asked = req.nextUrl.searchParams.get('month')
  const month = asked && /^\d{4}-\d{2}-01$/.test(asked) ? asked : monthStartIso()
  const nextMonth = nextMonthStartIso(month)

  const [usersRes, targetsRes, tenRes, caps] = await Promise.all([
    sb.from('users').select('id, name, handles_properties').eq('org_id', orgId).eq('is_active', true),
    sb.from('agent_targets').select('user_id, target_deals, target_commission').eq('org_id', orgId).eq('month', month),
    sb.from('tenancies').select('created_by, started_at, created_at, commission_amount').eq('org_id', orgId).not('created_by', 'is', null),
    capabilitiesOf(ctx),
  ])
  for (const r of [usersRes, targetsRes, tenRes]) {
    if (r.error) return NextResponse.json({ error: { code: 'DB_ERROR', message: r.error.message } }, { status: 500 })
  }
  const users = (usersRes.data || []) as Array<{ id: string; name: string | null; handles_properties: boolean | null }>
  const targetBy = new Map((targetsRes.data || []).map((t: any) => [t.user_id as string, t]))

  const actual = new Map<string, Split>()
  for (const t of (tenRes.data || []) as Array<{ created_by: string; started_at: string | null; created_at: string; commission_amount: number | null }>) {
    const a = israelDateOf(t.started_at || t.created_at)
    if (!(a >= month && a < nextMonth)) continue
    const cur = actual.get(t.created_by) ?? { deals: 0, commission: 0 }
    cur.deals += 1
    cur.commission += Number(t.commission_amount || 0)
    actual.set(t.created_by, cur)
  }

  const rowFor = (u: { id: string; name: string | null }): AgentRow => {
    const tg = targetBy.get(u.id) as { target_deals?: number; target_commission?: number } | undefined
    const rent = actual.get(u.id) ?? { deals: 0, commission: 0 }
    return {
      id: u.id,
      name: u.name || '',
      targetDeals: Number(tg?.target_deals ?? 0),
      targetCommission: Number(tg?.target_commission ?? 0),
      actualDeals: rent.deals,
      actualCommission: rent.commission,
      rent,
      sale: { deals: 0, commission: 0 },
    }
  }

  const involved = (u: { id: string; handles_properties: boolean | null }) => !!u.handles_properties || targetBy.has(u.id)
  const canSeeCompany = caps.includes('company.dashboard')
  const me = users.find(u => u.id === uid)
  const meRow = me && involved(me) ? rowFor(me) : null
  const agents = canSeeCompany ? users.filter(involved).map(rowFor).sort((a, b) => a.name.localeCompare(b.name, 'he')) : []

  const sum = (f: (r: AgentRow) => number) => agents.reduce((s, r) => s + f(r), 0)
  const company = canSeeCompany ? {
    targetDeals: sum(r => r.targetDeals),
    targetCommission: sum(r => r.targetCommission),
    actualDeals: sum(r => r.actualDeals),
    actualCommission: sum(r => r.actualCommission),
    rent: { deals: sum(r => r.rent.deals), commission: sum(r => r.rent.commission) },
    sale: { deals: 0, commission: 0 },
  } : null

  return NextResponse.json({ month, me: meRow, company, agents, salesTracked: false })
}

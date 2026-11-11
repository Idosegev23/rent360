import { NextResponse } from 'next/server'
import { requireOrg } from '../../../../lib/api/org-context'
import {
  effectiveStatus, expectedFee, deriveRecruitSource, type DealRow,
} from '../../../../lib/deals/model'

/**
 * Deal control board (rent): one row per approved, relevant property across the whole company, with
 * the 22 columns the managers review daily. Card data (address, owner, rooms, price, handling agent,
 * tenancy, commission) is read live; the rest comes from property_deals (migration 0045).
 * Filtering/forecasting happens client-side on this list — it is a few hundred rows at most.
 */
export const dynamic = 'force-dynamic'


const CHUNK = 200
async function inChunks<T>(ids: string[], fetchChunk: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += CHUNK) out.push(...(await fetchChunk(ids.slice(i, i + CHUNK))))
  return out
}
function must<T>(res: { data: unknown; error: { message: string } | null }): T[] {
  if (res.error) throw new Error(res.error.message)
  return (res.data || []) as T[]
}
const day = (v: string | null | undefined) => (v ? v.slice(0, 10) : null)
const daysSince = (iso: string | null) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)) : 0)

export async function GET() {
  const ctx = await requireOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  const { sb, orgId } = ctx
  try {
    const [usersRes, approvedRes] = await Promise.all([
      sb.from('users').select('id, name, handles_properties').eq('org_id', orgId).eq('is_active', true).order('name'),
      sb.from('approved_properties').select('property_id, approved_at').eq('org_id', orgId).is('irrelevant_at', null),
    ])
    const users = must<{ id: string; name: string | null; handles_properties: boolean | null }>(usersRes)
    const approved = must<{ property_id: string; approved_at: string | null }>(approvedRes)
    const approvedAt = new Map(approved.map(a => [a.property_id, a.approved_at]))
    const ids = Array.from(approvedAt.keys())

    const props = await inChunks<any>(ids, async c => must<any>(await sb.from('properties')
      .select('id, street, address, city, contact_name, contact_phone, rooms, price, source, assigned_agent_user_id, created_at, agreed_commission_months, agreed_commission_amount')
      .eq('org_id', orgId).in('id', c)))

    const dealsRes = await Promise.all(chunk(ids).map(c => sb.from('property_deals').select('*').eq('org_id', orgId).in('property_id', c)))
    const missing = dealsRes.find(r => r.error && /property_deals/.test(r.error.message))
    if (missing) {
      return NextResponse.json({ error: { code: 'MIGRATION_REQUIRED', message: 'חסרה טבלת property_deals. יש להריץ את מיגרציה 0045.' } }, { status: 503 })
    }
    const deals = dealsRes.flatMap(r => must<any>(r))
    const dealBy = new Map<string, any>(deals.map(d => [d.property_id, d]))

    const tenancies = await inChunks<any>(ids, async c => must<any>(await sb.from('tenancies')
      .select('property_id, renter_id, started_at, monthly_rent, commission_amount, commission_status, commission_collected_at, created_at')
      .eq('org_id', orgId).eq('status', 'active').in('property_id', c)))
    const tenBy = new Map<string, any>(tenancies.map(t => [t.property_id, t]))
    const renterIds = Array.from(new Set(tenancies.map(t => t.renter_id).filter(Boolean))) as string[]
    const renters = await inChunks<any>(renterIds, async c => must<any>(await sb.from('renters').select('id, first_name, last_name, phone').in('id', c)))
    const renterBy = new Map<string, any>(renters.map(r => [r.id, r]))

    const rows: DealRow[] = props.map((p: any): DealRow => {
      const d = dealBy.get(p.id)
      const t = tenBy.get(p.id)
      const r = t?.renter_id ? renterBy.get(t.renter_id) : null
      const status = effectiveStatus(d?.work_status, !!t)
      const rent = d?.closing_price ?? t?.monthly_rent ?? p.price ?? null
      const fee = expectedFee({
        override: d?.expected_fee ?? null,
        agreedAmount: p.agreed_commission_amount != null ? Number(p.agreed_commission_amount) : null,
        agreedMonths: p.agreed_commission_months != null ? Number(p.agreed_commission_months) : null,
        rent: rent != null ? Number(rent) : null,
      })
      // With a tenancy the commission status on the tenancy is the source of truth (the /commissions screen edits it).
      const paymentStatus = t ? (t.commission_status || 'pending') : (d?.payment_status || 'pending')
      return {
        propertyId: p.id,
        address: p.street || p.address || 'נכס',
        city: p.city || '',
        ownerName: p.contact_name ?? null,
        ownerPhone: p.contact_phone ?? null,
        rooms: p.rooms != null ? Number(p.rooms) : null,
        askingPrice: p.price != null ? Number(p.price) : null,
        recruitedAt: day(d?.recruited_at) ?? day(approvedAt.get(p.id)) ?? day(p.created_at),
        recruitSource: d?.recruit_source ?? deriveRecruitSource(p.source),
        recruitSourceDerived: !d?.recruit_source,
        recruiterId: d?.recruited_by_user_id ?? null,
        handlerId: p.assigned_agent_user_id ?? null,
        status,
        daysInStatus: daysSince(d?.status_changed_at ?? approvedAt.get(p.id) ?? p.created_at),
        expectedCloseDate: day(d?.expected_close_date),
        closingPrice: d?.closing_price ?? (t?.monthly_rent != null ? Number(t.monthly_rent) : null),
        renterName: r ? [r.first_name, r.last_name].filter(Boolean).join(' ') || null : (d?.deal_renter_name ?? null),
        renterPhone: r?.phone ?? d?.deal_renter_phone ?? null,
        signingDate: day(d?.signing_date) ?? day(t?.started_at),
        docsStatus: d?.docs_status ?? 'not_started',
        expectedFee: fee,
        feeIsOverride: d?.expected_fee != null,
        paymentStatus,
        paymentMethod: d?.payment_method ?? null,
        invoiceNumber: d?.invoice_number ?? null,
        collectedAt: day(t?.commission_collected_at) ?? day(d?.collected_at),
        note: d?.note ?? null,
        hasTenancy: !!t,
      }
    })

    // Newest recruits first; the page re-sorts as asked.
    rows.sort((a, b) => (b.recruitedAt ?? '').localeCompare(a.recruitedAt ?? ''))
    return NextResponse.json({
      rows,
      agents: users.map(u => ({ id: u.id, name: u.name || '', handles: !!u.handles_properties })),
    })
  } catch (err) {
    return NextResponse.json({ error: { code: 'DB_ERROR', message: err instanceof Error ? err.message : String(err) } }, { status: 500 })
  }
}

function chunk(ids: string[]): string[][] {
  const out: string[][] = []
  for (let i = 0; i < ids.length; i += CHUNK) out.push(ids.slice(i, i + CHUNK))
  return out.length ? out : [[]]
}


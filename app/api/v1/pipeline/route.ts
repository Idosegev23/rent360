import { NextResponse } from 'next/server'
import { requireOrg } from '../../../../lib/api/org-context'

/**
 * Deal board (landlord pipeline). Derives each WORKED property's stage from existing signals —
 * no extra table — so the team sees the funnel at a glance. The huge untouched backlog ("new")
 * lives in the outreach queue, not here; this board is only properties we're actively working.
 *
 * Stages: contacted → in_convo → approved → rented.
 */
const STAGES = [
  { key: 'contacted', label: 'ממתין למענה' },
  { key: 'in_convo', label: 'בשיחה פעילה' },
  { key: 'approved', label: 'מאושר לתיווך' },
  { key: 'rented', label: 'הושכר' },
] as const
const ACTIVE_INTENTS = new Set(['interested', 'price_objection', 'callback_later'])

export async function GET() {
  const ctx = await requireOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  const { sb, orgId } = ctx

  const [threadsRes, approvedRes, tenancyRes] = await Promise.all([
    sb.from('threads').select('id, property_id, tags, last_message_at').eq('org_id', orgId).not('property_id', 'is', null).order('last_message_at', { ascending: false }).limit(2000),
    sb.from('approved_properties').select('property_id').eq('org_id', orgId).is('irrelevant_at', null),
    sb.from('tenancies').select('property_id').eq('org_id', orgId).eq('status', 'active'),
  ])

  const threadByProp = new Map<string, { threadId: string; intent: string | null }>()
  for (const t of threadsRes.data || []) {
    const pid = t.property_id as string
    if (!pid || threadByProp.has(pid)) continue // first = most recent (ordered desc)
    const intent = (t.tags && typeof t.tags === 'object' ? (t.tags as any).intent : null) as string | null
    threadByProp.set(pid, { threadId: t.id as string, intent })
  }
  const approvedIds = new Set((approvedRes.data || []).map(a => a.property_id as string))
  const rentedIds = new Set((tenancyRes.data || []).map(t => t.property_id as string))

  // Worked universe = anything approved / rented / with a conversation.
  const propIds = Array.from(new Set<string>([...approvedIds, ...rentedIds, ...threadByProp.keys()]))
  const propById = new Map<string, any>()
  for (let i = 0; i < propIds.length; i += 300) {
    const { data } = await sb.from('properties').select('id, contact_name, street, address, city, price, rooms')
      .eq('org_id', orgId).in('id', propIds.slice(i, i + 300))
    for (const p of data || []) propById.set(p.id, p)
  }

  const cols: Record<string, any[]> = { contacted: [], in_convo: [], approved: [], rented: [] }
  for (const pid of propIds) {
    const p = propById.get(pid)
    if (!p) continue
    const th = threadByProp.get(pid)
    let stage: string
    if (rentedIds.has(pid)) stage = 'rented'
    else if (approvedIds.has(pid)) stage = 'approved'
    else if (th && th.intent && ACTIVE_INTENTS.has(th.intent)) stage = 'in_convo'
    else stage = 'contacted'
    cols[stage]!.push({
      id: pid,
      label: [p.street || p.address, p.city].filter(Boolean).join(', ') || 'נכס',
      contact: p.contact_name || null,
      price: p.price ?? null,
      rooms: p.rooms ?? null,
      intent: th?.intent ?? null,
      threadId: th?.threadId ?? null,
    })
  }

  return NextResponse.json({
    columns: STAGES.map(s => ({ key: s.key, label: s.label, count: cols[s.key]!.length, items: cols[s.key]!.slice(0, 80) })),
  })
}

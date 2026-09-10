import { NextRequest, NextResponse } from 'next/server'
import { requireOrg, type OrgContext } from '../../../../lib/api/org-context'
import {
  STAGES, effectiveStage, daysSince, monthStartIso, nextMonthStartIso, isStageKey, israelDateOf, type StageKey,
} from '../../../../lib/board/stages'

/**
 * The agent deal board (spec: docs/superpowers/specs/2026-09-10-agent-deal-board-design.md).
 * Scope = approved, not-irrelevant properties assigned to `?agent=` (default: the viewer), plus the
 * unassigned ones surfaced as `orphans`. Next task / next meeting are read from the existing
 * `tasks` / `meetings` tables — the board never duplicates them.
 * The client mirror of this response lives in components/board/types.ts.
 */
export const dynamic = 'force-dynamic'

type BoardItem = {
  propertyId: string
  label: string
  ownerName: string | null
  ownerPhone: string | null
  stage: StageKey
  daysInStage: number
  note: string | null
  nextTask: { id: string; title: string; dueAt: string | null } | null
  nextMeeting: { id: string; title: string; startsAt: string } | null
  updatedBy: string | null
  updatedAt: string | null
}

type AgentRow = { id: string; name: string | null }
type ApprovedRow = { property_id: string; approved_at: string | null }
type PropRow = {
  id: string; street: string | null; address: string | null; city: string | null
  contact_name: string | null; contact_phone: string | null; assigned_agent_user_id: string | null
}
type StageRow = { property_id: string; stage: string; stage_changed_at: string; note: string | null; updated_by: string | null; updated_at: string }
type TenancyRow = { property_id: string; started_at: string | null; created_at: string }
type EndedRow = { property_id: string; ended_at: string }
type TaskRow = { id: string; title: string; due_at: string | null; entity_id: string }
type MeetingRow = { id: string; title: string; starts_at: string; property_id: string }

const CHUNK = 200
async function inChunks<T>(ids: string[], fetchChunk: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += CHUNK) out.push(...(await fetchChunk(ids.slice(i, i + CHUNK))))
  return out
}

/**
 * Unwrap a Supabase result, turning a query error into a thrown one. The board must fail loudly rather
 * than render a silently wrong picture — e.g. every stage "חדש" and a zero target if 0041 is missing.
 */
function must<T>(res: { data: unknown; error: { message: string } | null }): T[] {
  if (res.error) throw new Error(res.error.message)
  return (res.data || []) as T[]
}

/** Month anchor for a tenancy (spec §4): the move-in date, else when it was recorded — Israel-local. */
function tenancyAnchor(t: { started_at: string | null; created_at: string }): string {
  return israelDateOf(t.started_at || t.created_at)
}

function ms(v: string): number {
  return new Date(v).getTime()
}

export async function GET(req: NextRequest) {
  const ctx = await requireOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  const agentId = req.nextUrl.searchParams.get('agent') || ctx.uid
  try {
    return NextResponse.json(await buildBoard(ctx.sb, ctx.orgId, ctx.uid, agentId))
  } catch (err) {
    return NextResponse.json({ error: { code: 'DB_ERROR', message: err instanceof Error ? err.message : String(err) } }, { status: 500 })
  }
}

async function buildBoard(sb: OrgContext['sb'], orgId: string, uid: string, agentId: string) {
  const month = monthStartIso()
  const nextMonth = nextMonthStartIso(month)
  const nowIso = new Date().toISOString()

  const [agentsRes, approvedRes] = await Promise.all([
    sb.from('users').select('id, name').eq('org_id', orgId).eq('is_active', true).order('name'),
    sb.from('approved_properties').select('property_id, approved_at').eq('org_id', orgId).is('irrelevant_at', null),
  ])
  const agents = must<AgentRow>(agentsRes)
  const approvedAt = new Map(must<ApprovedRow>(approvedRes).map(a => [a.property_id, a.approved_at]))

  const props = await inChunks<PropRow>(Array.from(approvedAt.keys()), async c => must<PropRow>(await sb.from('properties')
    .select('id, street, address, city, contact_name, contact_phone, assigned_agent_user_id')
    .eq('org_id', orgId).in('id', c)))
  const mine = props.filter(p => p.assigned_agent_user_id === agentId)
  const orphanProps = props.filter(p => !p.assigned_agent_user_id)
  const ids = [...mine, ...orphanProps].map(p => p.id)

  const [stages, tenancies, ended, tasks, meetings] = await Promise.all([
    inChunks<StageRow>(ids, async c => must<StageRow>(await sb.from('deal_stages')
      .select('property_id, stage, stage_changed_at, note, updated_by, updated_at')
      .eq('org_id', orgId).in('property_id', c))),
    inChunks<TenancyRow>(ids, async c => must<TenancyRow>(await sb.from('tenancies')
      .select('property_id, started_at, created_at')
      .eq('org_id', orgId).eq('status', 'active').in('property_id', c))),
    inChunks<EndedRow>(ids, async c => must<EndedRow>(await sb.from('tenancies')
      .select('property_id, ended_at')
      .eq('org_id', orgId).eq('status', 'ended').not('ended_at', 'is', null).in('property_id', c))),
    inChunks<TaskRow>(ids, async c => must<TaskRow>(await sb.from('tasks')
      .select('id, title, due_at, entity_id')
      .eq('org_id', orgId).eq('entity_type', 'property').in('status', ['open', 'in_progress']).in('entity_id', c)
      .order('due_at', { ascending: true, nullsFirst: false }))),
    inChunks<MeetingRow>(ids, async c => must<MeetingRow>(await sb.from('meetings')
      .select('id, title, starts_at, property_id')
      .eq('org_id', orgId).neq('status', 'cancelled').gte('starts_at', nowIso).in('property_id', c)
      .order('starts_at', { ascending: true }))),
  ])

  const stageBy = new Map(stages.map(s => [s.property_id, s]))
  const tenancyBy = new Map(tenancies.map(t => [t.property_id, t]))
  const endedBy = new Map<string, string>()
  for (const e of ended) {
    const cur = endedBy.get(e.property_id)
    if (!cur || ms(e.ended_at) > ms(cur)) endedBy.set(e.property_id, e.ended_at)
  }
  // Rows arrive soonest-first per chunk; chunking can interleave, so compare rather than trust order.
  const taskBy = new Map<string, TaskRow>()
  for (const t of tasks) {
    const cur = taskBy.get(t.entity_id)
    if (!cur || (t.due_at ?? '9999') < (cur.due_at ?? '9999')) taskBy.set(t.entity_id, t)
  }
  const meetingBy = new Map<string, MeetingRow>()
  for (const m of meetings) {
    const cur = meetingBy.get(m.property_id)
    if (!cur || m.starts_at < cur.starts_at) meetingBy.set(m.property_id, m)
  }
  const nameBy = new Map(agents.map(a => [a.id, a.name || '']))

  function toItem(p: PropRow): BoardItem | null {
    const s = stageBy.get(p.id)
    const ten = tenancyBy.get(p.id)
    const endedAt = ten ? null : (endedBy.get(p.id) ?? null)
    // A tenancy that ended after the stored stage was set means the property is back on the market:
    // its pre-rental stage is stale, so it reads as `new`, counted from the end date. The stage POST
    // applies the same rule, so choosing a real stage now restarts the clock.
    const staleByEnd = !!(s && endedAt && ms(endedAt) > ms(s.stage_changed_at))
    const stored = s && !staleByEnd && isStageKey(s.stage) ? s.stage : null
    const stage = effectiveStage(stored, !!ten)
    // Signed deals stay only in the month they count toward — this is a board of OPEN properties.
    if (stage === 'signed') {
      const a = ten ? tenancyAnchor(ten) : ''
      if (!(a >= month && a < nextMonth)) return null
    }
    const since = stage === 'signed' && ten ? tenancyAnchor(ten)
      : s && !staleByEnd ? s.stage_changed_at
      : (endedAt ?? approvedAt.get(p.id) ?? null)
    const task = taskBy.get(p.id)
    const mtg = meetingBy.get(p.id)
    return {
      propertyId: p.id,
      label: [p.street || p.address, p.city].filter(Boolean).join(', ') || 'נכס',
      ownerName: p.contact_name,
      ownerPhone: p.contact_phone,
      stage,
      daysInStage: daysSince(since),
      note: s?.note ?? null,
      nextTask: task ? { id: task.id, title: task.title, dueAt: task.due_at } : null,
      nextMeeting: mtg ? { id: mtg.id, title: mtg.title, startsAt: mtg.starts_at } : null,
      updatedBy: s?.updated_by ? (nameBy.get(s.updated_by) ?? null) : null,
      updatedAt: s?.updated_at ?? null,
    }
  }

  const byStale = (a: BoardItem, b: BoardItem) => b.daysInStage - a.daysInStage
  const items = mine.map(toItem).filter((x): x is BoardItem => x !== null)
  const orphans = orphanProps.map(toItem).filter((x): x is BoardItem => x !== null).sort(byStale)
  const groups = STAGES.map(st => ({
    stage: st.key,
    label: st.label,
    items: items.filter(i => i.stage === st.key).sort(byStale),
  }))

  const [targetRes, agentTenRes] = await Promise.all([
    sb.from('agent_targets').select('target_deals, target_commission')
      .eq('org_id', orgId).eq('user_id', agentId).eq('month', month).maybeSingle(),
    sb.from('tenancies').select('started_at, created_at, commission_amount')
      .eq('org_id', orgId).eq('created_by', agentId),
  ])
  if (targetRes.error) throw new Error(targetRes.error.message)
  let actualDeals = 0
  let actualCommission = 0
  for (const t of must<{ started_at: string | null; created_at: string; commission_amount: number | null }>(agentTenRes)) {
    const a = tenancyAnchor(t)
    if (a >= month && a < nextMonth) { actualDeals++; actualCommission += Number(t.commission_amount || 0) }
  }

  return {
    me: { id: uid },
    // The agent this payload describes. The targets form writes for THIS id, never the selector's,
    // so a fast agent switch cannot save one agent's numbers onto another.
    agentId,
    agents: agents.map(a => ({ id: a.id, name: a.name || '' })),
    targets: {
      month,
      targetDeals: (targetRes.data?.target_deals as number | undefined) ?? 0,
      targetCommission: (targetRes.data?.target_commission as number | undefined) ?? 0,
      actualDeals,
      actualCommission,
    },
    orphans,
    groups,
  }
}

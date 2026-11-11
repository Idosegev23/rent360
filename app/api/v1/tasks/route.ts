import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireOrg } from '@/lib/api/org-context'
import { israelDayRangeUTC } from '@/lib/time/israel'

/**
 * Tasks list + quick-add. All staff see all tasks (shared org).
 * scope: mine (I do it) | delegated (I created it or follow it, someone else does it) | following (I follow it)
 *        | unassigned | all. status: comma list of open,in_progress,done,cancelled.
 * Each task comes back with a derived `source` and, for property/renter links, the entity's label + href.
 * Reminders are driven off `remind_at` (defaults to `due_at` on create).
 */

const TASK_COLS = 'id, title, notes, assignee_user_id, created_by, status, priority, due_at, entity_type, entity_id, remind_at, reminded_at, done_at, created_at, recurrence'

/** Where a task came from, derived (no column): meeting / property / customer link, else delegated vs manual. */
function taskSource(t: { entity_type: string | null; created_by: string | null; assignee_user_id: string | null }): 'meeting' | 'property' | 'customer' | 'delegated' | 'manual' {
  if (t.entity_type === 'meeting') return 'meeting'
  if (t.entity_type === 'property') return 'property'
  if (t.entity_type === 'renter' || t.entity_type === 'thread' || t.entity_type === 'contact' || t.entity_type === 'tenancy') return 'customer'
  if (t.created_by && t.assignee_user_id && t.created_by !== t.assignee_user_id) return 'delegated'
  return 'manual'
}

const ENTITY_HREF: Record<string, (id: string) => string> = {
  property: id => `/properties/${id}`,
  renter: id => `/renters/${id}`,
  thread: id => `/inbox/${id}`,
  tenancy: () => '/rented',
  meeting: () => '/meetings',
}
export async function GET(req: NextRequest) {
  const ctx = await requireOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  const q = new URL(req.url).searchParams
  const scope = q.get('scope') || 'all' // all | mine | unassigned
  const statuses = (q.get('status') || '').split(',').map(s => s.trim()).filter(s => ['open', 'in_progress', 'done', 'cancelled'].includes(s))
  const due = q.get('due') // today | overdue | upcoming
  const entityType = q.get('entity_type')
  const entityId = q.get('entity_id')

  // follower_user_id comes from migration 0044; until it exists we fall back to the older column set
  // so the list keeps working.
  const build = (withFollower: boolean) => {
    let query = ctx.sb
      .from('tasks')
      .select(withFollower ? `${TASK_COLS}, follower_user_id` : TASK_COLS)
      .eq('org_id', ctx.orgId)

    if (scope === 'mine') query = query.eq('assignee_user_id', ctx.uid)
    else if (scope === 'unassigned') query = query.is('assignee_user_id', null)
    else if (scope === 'following') query = withFollower ? query.eq('follower_user_id', ctx.uid) : query.eq('id', '00000000-0000-0000-0000-000000000000')
    else if (scope === 'delegated') {
      query = (withFollower ? query.or(`created_by.eq.${ctx.uid},follower_user_id.eq.${ctx.uid}`) : query.eq('created_by', ctx.uid))
        .not('assignee_user_id', 'is', null)
        .neq('assignee_user_id', ctx.uid)
    }
    if (statuses.length) query = query.in('status', statuses)
    if (entityType) query = query.eq('entity_type', entityType)
    if (entityId) query = query.eq('entity_id', entityId)

    const nowIso = new Date().toISOString()
    if (due === 'today') {
      const { endUTC } = israelDayRangeUTC()
      query = query.not('due_at', 'is', null).lte('due_at', endUTC.toISOString()).in('status', ['open', 'in_progress'])
    } else if (due === 'overdue') {
      query = query.not('due_at', 'is', null).lt('due_at', nowIso).in('status', ['open', 'in_progress'])
    } else if (due === 'upcoming') {
      query = query.not('due_at', 'is', null).gt('due_at', nowIso).in('status', ['open', 'in_progress'])
    }
    // Open tasks first, then by due date (nulls last), newest created last.
    return query.order('due_at', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false })
  }
  let { data, error } = await build(true)
  if (error && /follower_user_id/.test(error.message)) ({ data, error } = await build(false))
  if (error) return NextResponse.json({ error: { code: 'QUERY_FAILED', message: error.message } }, { status: 500 })

  // Attach the handoff-note count + latest note per task (activity log, entity_type='task'), so the
  // list can show "someone left you a note/request" without a per-task fetch.
  const tasks = (data || []) as unknown as Array<Record<string, any>>
  const ids = tasks.map(t => t.id)

  // Label + link for property / renter tasks, so the list can show "which property or customer".
  const pIds = Array.from(new Set(tasks.filter(t => t.entity_type === 'property' && t.entity_id).map(t => t.entity_id as string)))
  const rIds = Array.from(new Set(tasks.filter(t => t.entity_type === 'renter' && t.entity_id).map(t => t.entity_id as string)))
  const [props, renters] = await Promise.all([
    pIds.length ? ctx.sb.from('properties').select('id, street, address, city, title').eq('org_id', ctx.orgId).in('id', pIds).then(r => r.data || []) : Promise.resolve([] as any[]),
    rIds.length ? ctx.sb.from('renters').select('id, first_name, last_name').in('id', rIds).then(r => r.data || []) : Promise.resolve([] as any[]),
  ])
  const labels = new Map<string, string>()
  for (const p of props as any[]) labels.set(p.id, [p.street || p.address, p.city].filter(Boolean).join(', ') || p.title || 'נכס')
  for (const r of renters as any[]) labels.set(r.id, [r.first_name, r.last_name].filter(Boolean).join(' ') || 'שוכר')
  for (const t of tasks) {
    t.source = taskSource(t as any)
    t.entity_label = t.entity_id ? labels.get(t.entity_id) ?? null : null
    t.entity_href = t.entity_type && t.entity_id && ENTITY_HREF[t.entity_type] ? ENTITY_HREF[t.entity_type]!(t.entity_id) : null
  }
  if (ids.length) {
    const { data: notes } = await ctx.sb
      .from('activity')
      .select('entity_id, body, created_at')
      .eq('org_id', ctx.orgId).eq('entity_type', 'task').eq('kind', 'note')
      .in('entity_id', ids)
      .order('created_at', { ascending: false })
    const byTask = new Map<string, { count: number; last: { body: string | null; created_at: string } }>()
    for (const n of notes || []) {
      const cur = byTask.get(n.entity_id)
      if (cur) cur.count += 1
      else byTask.set(n.entity_id, { count: 1, last: { body: n.body, created_at: n.created_at } })
    }
    for (const t of tasks) {
      const info = byTask.get(t.id)
      t.notes_count = info?.count || 0
      t.last_note = info?.last || null
    }
  }
  return NextResponse.json({ tasks })
}

const CreateBody = z.object({
  title: z.string().min(1),
  notes: z.string().optional(),
  assignee_user_id: z.string().uuid().nullable().optional(),
  follower_user_id: z.string().uuid().nullable().optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  due_at: z.string().datetime().nullable().optional(),
  remind_at: z.string().datetime().nullable().optional(),
  entity_type: z.enum(['property', 'renter', 'thread', 'tenancy', 'meeting', 'contact']).nullable().optional(),
  entity_id: z.string().uuid().nullable().optional(),
  recurrence: z.enum(['daily', 'weekdays', 'weekly', 'monthly']).nullable().optional(),
})

export async function POST(req: NextRequest) {
  const ctx = await requireOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  const parsed = CreateBody.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: { code: 'BAD_REQUEST', message: parsed.error.message } }, { status: 400 })
  const b = parsed.data

  // Default assignee = creator; default reminder = due date (so a due task nudges its owner).
  const assignee = b.assignee_user_id === undefined ? ctx.uid : b.assignee_user_id
  const remindAt = b.remind_at !== undefined ? b.remind_at : b.due_at ?? null

  const { data, error } = await ctx.sb
    .from('tasks')
    .insert({
      org_id: ctx.orgId,
      title: b.title,
      notes: b.notes ?? null,
      assignee_user_id: assignee,
      created_by: ctx.uid,
      priority: b.priority ?? 'normal',
      due_at: b.due_at ?? null,
      remind_at: remindAt,
      entity_type: b.entity_type ?? null,
      entity_id: b.entity_id ?? null,
      recurrence: b.recurrence ?? null,
      // Only sent when set, so creating tasks keeps working before migration 0044 is applied.
      ...(b.follower_user_id ? { follower_user_id: b.follower_user_id } : {}),
    })
    .select('id')
    .single()
  if (error) return NextResponse.json({ error: { code: 'INSERT_FAILED', message: error.message } }, { status: 500 })
  return NextResponse.json({ ok: true, id: data.id })
}

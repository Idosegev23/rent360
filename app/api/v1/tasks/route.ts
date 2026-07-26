import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireOrg } from '@/lib/api/org-context'
import { israelDayRangeUTC } from '@/lib/time/israel'

/**
 * Tasks list + quick-add. All staff see all tasks (shared org); `scope=mine` filters to the
 * caller as assignee. Reminders are driven off `remind_at` (defaults to `due_at` on create).
 */
export async function GET(req: NextRequest) {
  const ctx = await requireOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  const q = new URL(req.url).searchParams
  const scope = q.get('scope') || 'all' // all | mine | unassigned
  const status = q.get('status') // open | in_progress | done | cancelled
  const due = q.get('due') // today | overdue | upcoming
  const entityType = q.get('entity_type')
  const entityId = q.get('entity_id')

  let query = ctx.sb
    .from('tasks')
    .select('id, title, notes, assignee_user_id, created_by, status, priority, due_at, entity_type, entity_id, remind_at, reminded_at, done_at, created_at, recurrence')
    .eq('org_id', ctx.orgId)

  if (scope === 'mine') query = query.eq('assignee_user_id', ctx.uid)
  else if (scope === 'unassigned') query = query.is('assignee_user_id', null)
  if (status) query = query.eq('status', status)
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
  const { data, error } = await query.order('due_at', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: { code: 'QUERY_FAILED', message: error.message } }, { status: 500 })

  // Attach the handoff-note count + latest note per task (activity log, entity_type='task'), so the
  // list can show "someone left you a note/request" without a per-task fetch.
  const tasks = (data || []) as Array<Record<string, any>>
  const ids = tasks.map(t => t.id)
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
    })
    .select('id')
    .single()
  if (error) return NextResponse.json({ error: { code: 'INSERT_FAILED', message: error.message } }, { status: 500 })
  return NextResponse.json({ ok: true, id: data.id })
}

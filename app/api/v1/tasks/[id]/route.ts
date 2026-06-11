import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireOrg } from '@/lib/api/org-context'

const PatchBody = z.object({
  title: z.string().min(1).optional(),
  notes: z.string().nullable().optional(),
  assignee_user_id: z.string().uuid().nullable().optional(),
  status: z.enum(['open', 'in_progress', 'done', 'cancelled']).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  due_at: z.string().datetime().nullable().optional(),
  remind_at: z.string().datetime().nullable().optional(),
  recurrence: z.enum(['daily', 'weekdays', 'weekly', 'monthly']).nullable().optional(),
})

function nextOccurrence(base: Date, rec: string): Date {
  const d = new Date(base)
  if (rec === 'monthly') { d.setMonth(d.getMonth() + 1); return d }
  if (rec === 'weekly') { d.setDate(d.getDate() + 7); return d }
  d.setDate(d.getDate() + 1)
  if (rec === 'weekdays') while (d.getDay() === 5 || d.getDay() === 6) d.setDate(d.getDate() + 1) // skip Fri/Sat
  return d
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  const parsed = PatchBody.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: { code: 'BAD_REQUEST', message: parsed.error.message } }, { status: 400 })
  const b = parsed.data

  const update: Record<string, unknown> = {}
  if (b.title !== undefined) update.title = b.title
  if (b.notes !== undefined) update.notes = b.notes
  if (b.assignee_user_id !== undefined) update.assignee_user_id = b.assignee_user_id
  if (b.priority !== undefined) update.priority = b.priority
  if (b.recurrence !== undefined) update.recurrence = b.recurrence
  if (b.due_at !== undefined) update.due_at = b.due_at
  // Rescheduling the reminder re-arms it (so it fires again at the new time).
  if (b.remind_at !== undefined) {
    update.remind_at = b.remind_at
    update.reminded_at = null
  }
  if (b.status !== undefined) {
    update.status = b.status
    if (b.status === 'done') {
      update.done_at = new Date().toISOString()
      update.done_by = ctx.uid
    } else {
      update.done_at = null
      update.done_by = null
    }
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'no fields' } }, { status: 400 })
  }

  const { error } = await ctx.sb.from('tasks').update(update).eq('id', params.id).eq('org_id', ctx.orgId)
  if (error) return NextResponse.json({ error: { code: 'UPDATE_FAILED', message: error.message } }, { status: 500 })

  // Completing a recurring task spawns the next occurrence (so it "appears every day" without manual
  // re-creation), unless the recurrence was just turned off in this same request.
  if (b.status === 'done' && b.recurrence !== null) {
    const { data: tk } = await ctx.sb.from('tasks')
      .select('recurrence, due_at, title, notes, assignee_user_id, priority, entity_type, entity_id')
      .eq('id', params.id).eq('org_id', ctx.orgId).maybeSingle()
    if (tk?.recurrence) {
      const next = nextOccurrence(tk.due_at ? new Date(tk.due_at) : new Date(), tk.recurrence)
      await ctx.sb.from('tasks').insert({
        org_id: ctx.orgId, title: tk.title, notes: tk.notes, assignee_user_id: tk.assignee_user_id,
        created_by: ctx.uid, priority: tk.priority, due_at: next.toISOString(), remind_at: next.toISOString(),
        entity_type: tk.entity_type, entity_id: tk.entity_id, recurrence: tk.recurrence, status: 'open',
      })
    }
  }
  return NextResponse.json({ ok: true })
}

/** Soft-cancel (keep history) rather than hard-delete. */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  const { error } = await ctx.sb.from('tasks').update({ status: 'cancelled' }).eq('id', params.id).eq('org_id', ctx.orgId)
  if (error) return NextResponse.json({ error: { code: 'UPDATE_FAILED', message: error.message } }, { status: 500 })
  return NextResponse.json({ ok: true })
}

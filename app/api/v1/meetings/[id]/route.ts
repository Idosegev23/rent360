import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireOrg } from '@/lib/api/org-context'
import { updateCalendarEvent, cancelCalendarEvent } from '@/lib/google/calendar'

const PatchBody = z.object({
  title: z.string().min(1).optional(),
  notes: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  starts_at: z.string().datetime().optional(),
  ends_at: z.string().datetime().optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  const parsed = PatchBody.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: { code: 'BAD_REQUEST', message: parsed.error.message } }, { status: 400 })
  const b = parsed.data

  const { data: m } = await ctx.sb
    .from('meetings')
    .select('owner_user_id, google_event_id')
    .eq('id', params.id)
    .eq('org_id', ctx.orgId)
    .maybeSingle()
  if (!m) return NextResponse.json({ error: { code: 'NOT_FOUND' } }, { status: 404 })

  const update: Record<string, unknown> = {}
  if (b.title !== undefined) update.title = b.title
  if (b.notes !== undefined) update.notes = b.notes
  if (b.location !== undefined) update.location = b.location
  if (b.starts_at !== undefined) update.starts_at = b.starts_at
  if (b.ends_at !== undefined) update.ends_at = b.ends_at
  // Time change re-arms the reminder.
  if (b.starts_at !== undefined) update.whatsapp_reminded_at = null
  if (Object.keys(update).length === 0) return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'no fields' } }, { status: 400 })

  // Mirror to Google (best-effort — never block the local update).
  if (m.google_event_id && m.owner_user_id) {
    try {
      await updateCalendarEvent({
        orgId: ctx.orgId,
        userId: m.owner_user_id,
        eventId: m.google_event_id,
        ...(b.title !== undefined ? { summary: b.title } : {}),
        ...(b.notes != null ? { description: b.notes } : {}),
        ...(b.starts_at !== undefined ? { start: new Date(b.starts_at) } : {}),
        ...(b.ends_at !== undefined ? { end: new Date(b.ends_at) } : {}),
      })
    } catch {/* best-effort */}
  }

  const { error } = await ctx.sb.from('meetings').update(update).eq('id', params.id).eq('org_id', ctx.orgId)
  if (error) return NextResponse.json({ error: { code: 'UPDATE_FAILED', message: error.message } }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  const { data: m } = await ctx.sb
    .from('meetings')
    .select('owner_user_id, google_event_id')
    .eq('id', params.id)
    .eq('org_id', ctx.orgId)
    .maybeSingle()
  if (m?.google_event_id && m.owner_user_id) {
    try { await cancelCalendarEvent({ orgId: ctx.orgId, userId: m.owner_user_id, eventId: m.google_event_id }) } catch {/* best-effort */}
  }
  const { error } = await ctx.sb.from('meetings').update({ status: 'cancelled' }).eq('id', params.id).eq('org_id', ctx.orgId)
  if (error) return NextResponse.json({ error: { code: 'UPDATE_FAILED', message: error.message } }, { status: 500 })
  return NextResponse.json({ ok: true })
}

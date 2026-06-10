import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireOrg } from '@/lib/api/org-context'
import { createCalendarEvent } from '@/lib/google/calendar'
import { GoogleNotConnectedError } from '@/lib/google/client'

/** Meetings list (mirror of Google Calendar). All staff see all; filter by owner/date range. */
export async function GET(req: NextRequest) {
  const ctx = await requireOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  const q = new URL(req.url).searchParams
  const ownerUserId = q.get('ownerUserId')
  const from = q.get('from') // ISO
  const to = q.get('to')

  let query = ctx.sb
    .from('meetings')
    .select('id, title, location, notes, owner_user_id, property_id, renter_id, thread_id, google_event_id, starts_at, ends_at, status, created_at')
    .eq('org_id', ctx.orgId)
    .neq('status', 'cancelled')
  if (ownerUserId) query = query.eq('owner_user_id', ownerUserId)
  query = query.gte('starts_at', from || new Date().toISOString())
  if (to) query = query.lte('starts_at', to)

  const { data, error } = await query.order('starts_at', { ascending: true }).limit(200)
  if (error) return NextResponse.json({ error: { code: 'QUERY_FAILED', message: error.message } }, { status: 500 })
  return NextResponse.json({ meetings: data || [] })
}

const CreateBody = z.object({
  title: z.string().min(1),
  starts_at: z.string().datetime(),
  ends_at: z.string().datetime(),
  owner_user_id: z.string().uuid().optional(),
  location: z.string().optional(),
  notes: z.string().optional(),
  property_id: z.string().uuid().nullable().optional(),
  renter_id: z.string().uuid().nullable().optional(),
  thread_id: z.string().uuid().nullable().optional(),
  attendees: z.array(z.string().email()).optional(),
})

export async function POST(req: NextRequest) {
  const ctx = await requireOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  const parsed = CreateBody.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: { code: 'BAD_REQUEST', message: parsed.error.message } }, { status: 400 })
  const b = parsed.data
  const owner = b.owner_user_id || ctx.uid

  // Create on the owner's Google Calendar. Fail-soft: if they haven't connected Google,
  // still store the meeting locally (google_event_id null) so the office view works.
  let googleEventId: string | null = null
  let googleWarning: string | null = null
  try {
    const ev = await createCalendarEvent({
      orgId: ctx.orgId,
      userId: owner,
      summary: b.title,
      ...(b.notes ? { description: b.notes } : {}),
      start: new Date(b.starts_at),
      end: new Date(b.ends_at),
      ...(b.attendees ? { attendees: b.attendees } : {}),
    })
    googleEventId = ev.eventId
  } catch (err) {
    if (err instanceof GoogleNotConnectedError) googleWarning = 'בעל הפגישה לא חיבר יומן Google — נשמרה מקומית בלבד'
    else googleWarning = 'יצירת האירוע ב-Google נכשלה — נשמרה מקומית בלבד'
  }

  const { data, error } = await ctx.sb
    .from('meetings')
    .insert({
      org_id: ctx.orgId,
      owner_user_id: owner,
      created_by: ctx.uid,
      title: b.title,
      location: b.location ?? null,
      notes: b.notes ?? null,
      property_id: b.property_id ?? null,
      renter_id: b.renter_id ?? null,
      thread_id: b.thread_id ?? null,
      google_event_id: googleEventId,
      starts_at: b.starts_at,
      ends_at: b.ends_at,
    })
    .select('id')
    .single()
  if (error) return NextResponse.json({ error: { code: 'INSERT_FAILED', message: error.message } }, { status: 500 })
  return NextResponse.json({ ok: true, id: data.id, google_event_id: googleEventId, warning: googleWarning })
}

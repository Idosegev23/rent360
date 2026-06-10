import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireOrg } from '@/lib/api/org-context'
import { createCalendarEvent } from '@/lib/google/calendar'
import { GoogleNotConnectedError } from '@/lib/google/client'

const Body = z.object({
  summary: z.string().min(1),
  description: z.string().optional(),
  start: z.string().datetime(), // ISO 8601 (UTC) from the client
  end: z.string().datetime(),
  attendees: z.array(z.string().email()).optional(),
})

export async function POST(req: NextRequest) {
  const ctx = await requireOrg()
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  try {
    const res = await createCalendarEvent({
      orgId: ctx.orgId,
      userId: ctx.uid,
      summary: parsed.data.summary,
      ...(parsed.data.description ? { description: parsed.data.description } : {}),
      start: new Date(parsed.data.start),
      end: new Date(parsed.data.end),
      ...(parsed.data.attendees ? { attendees: parsed.data.attendees } : {}),
    })
    return NextResponse.json({ ok: true, ...res })
  } catch (err) {
    if (err instanceof GoogleNotConnectedError) {
      return NextResponse.json({ error: 'google_not_connected', message: 'חבר חשבון Google קודם' }, { status: 428 })
    }
    return NextResponse.json({ error: 'calendar_failed' }, { status: 500 })
  }
}

import { supabaseService } from '@/lib/supabase'
import { createCalendarEvent, updateCalendarEvent } from '@/lib/google/calendar'

/** Parse an Israel wall-clock string ("YYYY-MM-DD" or "YYYY-MM-DDTHH:MM") into a UTC Date. */
export function israelLocalToDate(local: string): Date {
  const [datePart = '', timePart = '00:00'] = local.split('T')
  const [y, m, d] = datePart.split('-').map(Number)
  const [hh, mm] = timePart.split(':').map(Number)
  const guess = new Date(Date.UTC(y || 1970, (m || 1) - 1, d || 1, hh || 0, mm || 0))
  const back = new Date(guess.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }))
  const offsetMs = guess.getTime() - back.getTime()
  return new Date(guess.getTime() + offsetMs)
}

async function resolveOwner(orgId: string, threadId: string): Promise<string | null> {
  const sb = supabaseService()
  const { data: thread } = await sb.from('threads').select('assigned_user_id').eq('id', threadId).maybeSingle()
  if (thread?.assigned_user_id) return thread.assigned_user_id
  const { data: settings } = await sb
    .from('settings')
    .select('default_calendar_user_id')
    .eq('org_id', orgId)
    .maybeSingle()
  return settings?.default_calendar_user_id ?? null
}

/**
 * Best-effort: create/update a calendar event for a callback. Never throws — a Google failure
 * must not block intent recording or the conversation flow.
 */
export async function syncCallbackEvent(args: {
  orgId: string
  threadId: string
  propertyId: string | null
  callbackAt: string // Israel local "YYYY-MM-DD[THH:MM]"
}): Promise<void> {
  try {
    const userId = await resolveOwner(args.orgId, args.threadId)
    if (!userId) return
    const sb = supabaseService()
    const { data: thread } = await sb.from('threads').select('tags, phone').eq('id', args.threadId).maybeSingle()
    const tags = (thread?.tags && typeof thread.tags === 'object' ? thread.tags : {}) as Record<string, unknown>
    let title = 'חזרה ללקוח'
    if (args.propertyId) {
      const { data: p } = await sb
        .from('properties')
        .select('contact_name, title')
        .eq('id', args.propertyId)
        .maybeSingle()
      title = `חזרה ל${p?.contact_name || p?.title || thread?.phone || 'לקוח'}`
    }
    const start = israelLocalToDate(args.callbackAt)
    const end = new Date(start.getTime() + 30 * 60000)
    const base = process.env.APP_BASE_URL || 'https://rent360-vert.vercel.app'
    const description = `שיחת חזרה מתוזמנת אוטומטית ע"י רנט360.\n${base}/inbox/${args.threadId}`
    const existingId = typeof tags.calendar_event_id === 'string' ? tags.calendar_event_id : null
    if (existingId) {
      await updateCalendarEvent({ orgId: args.orgId, userId, eventId: existingId, summary: title, description, start, end })
    } else {
      const res = await createCalendarEvent({ orgId: args.orgId, userId, summary: title, description, start, end })
      tags.calendar_event_id = res.eventId
      await sb.from('threads').update({ tags }).eq('id', args.threadId)
    }
  } catch {
    /* best-effort — never block the caller */
  }
}

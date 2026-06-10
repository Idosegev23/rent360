import { NextRequest, NextResponse } from 'next/server'
import { supabaseService } from '../../../../../lib/supabase'
import { notifyAdminsCallbackReminder } from '../../../../../lib/alerts/admin-whatsapp'

/**
 * Daily cron: find landlord conversations whose requested callback date has arrived
 * (tags.intent='callback_later' + tags.callback_at <= today) and WhatsApp-remind the admins
 * (שי + זיו) once per callback. Marks tags.callback_reminded_at so it doesn't nag every day;
 * a rescheduled callback (later callback_at) re-arms the reminder.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>`. Vercel Cron sends this header automatically when
 * CRON_SECRET is set. Allowlisted in middleware.
 */
export const maxDuration = 120

async function run(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 })
  }

  const sb = supabaseService()
  // Current Israel local time as a sortable string ("2026-06-10T16:30:45"). callback_at is stored
  // Israel-local ("YYYY-MM-DD" or "YYYY-MM-DDTHH:MM"), so a lexicographic <= comparison is correct
  // for both date-only (fires that day) and time-specific (fires once the hour passes) callbacks.
  const israelNow = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Jerusalem' }).replace(' ', 'T')

  const { data: threads } = await sb
    .from('threads')
    .select('id, org_id, phone, property_id, tags')
    .eq('tags->>intent', 'callback_later')
    .lte('tags->>callback_at', israelNow)
    .neq('status', 'opted_out')
    .limit(200)

  const due = (threads || []).filter(t => {
    const tg = (t.tags && typeof t.tags === 'object' ? t.tags : {}) as Record<string, any>
    if (!tg.callback_at) return false
    // Already reminded for this (or a later) callback date → skip.
    if (tg.callback_reminded_at && String(tg.callback_reminded_at) >= String(tg.callback_at)) return false
    return true
  })

  let reminded = 0
  const errors: Array<{ threadId: string; error: string }> = []
  for (const t of due) {
    const tg = (t.tags && typeof t.tags === 'object' ? t.tags : {}) as Record<string, any>
    let landlordName = 'בעל דירה'
    let propertyTitle = 'נכס'
    let landlordPhone = t.phone || '-'
    if (t.property_id) {
      const { data: p } = await sb.from('properties').select('*').eq('id', t.property_id).maybeSingle()
      if (p) {
        landlordName = (p as any).contact_name || landlordName
        landlordPhone = (p as any).contact_phone || landlordPhone
        const loc = [(p as any).street, (p as any).city].filter(Boolean).join(', ')
        propertyTitle = loc || (p as any).title || propertyTitle
      }
    }
    try {
      const res = await notifyAdminsCallbackReminder({
        threadId: t.id, landlordName, landlordPhone, propertyTitle, callbackDate: String(tg.callback_at),
      })
      if (res.sent > 0) {
        reminded++
        // Stamp the callback_at value we reminded for (not "now") — TZ-independent, and a later
        // reschedule (bigger callback_at) re-arms the reminder via the guard above.
        await sb.from('threads').update({ tags: { ...tg, callback_reminded_at: String(tg.callback_at) } }).eq('id', t.id)
      } else if (res.errors.length) {
        errors.push({ threadId: t.id, error: res.errors[0]!.error })
      }
    } catch (err) {
      errors.push({ threadId: t.id, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return NextResponse.json({ ok: true, due: due.length, reminded, errors })
}

export async function GET(req: NextRequest) { return run(req) }
export async function POST(req: NextRequest) { return run(req) }

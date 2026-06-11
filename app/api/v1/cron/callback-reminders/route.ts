import { NextRequest, NextResponse } from 'next/server'
import { supabaseService } from '../../../../../lib/supabase'
import { notifyAdminsCallbackReminder, notifyAdminsPropertyRecheck } from '../../../../../lib/alerts/admin-whatsapp'
import { notifyStaffTask, notifyStaffMeeting } from '../../../../../lib/alerts/staff-whatsapp'
import { syncTemplateStatuses } from '../../../../../lib/whatsapp/template-sync'
import { sendText } from '../../../../../lib/whatsapp/meta-provider'
import { isInSessionWindow } from '../../../../../lib/whatsapp/window-guard'

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
  // Auto-sync Meta template statuses first, so newly-approved staff templates start sending this run.
  const templateSync = await syncTemplateStatuses()
  // Current Israel local time as a sortable string ("2026-06-10T16:30:45"). callback_at is stored
  // Israel-local ("YYYY-MM-DD" or "YYYY-MM-DDTHH:MM"), so a lexicographic <= comparison is correct
  // for both date-only (fires that day) and time-specific (fires once the hour passes) callbacks.
  const israelNow = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Jerusalem' }).replace(' ', 'T')
  // Quiet hours: never WhatsApp staff overnight. Nagging reminders (callbacks / rechecks / tasks) are
  // held until 09:00 Israel and re-fire then (we don't stamp, so nothing is lost). Meeting reminders
  // are event-driven and always fire. Avoids the 00:00 pings.
  const israelHour = Number(israelNow.slice(11, 13))
  const quietHours = israelHour < 9 || israelHour >= 21

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
  for (const t of (quietHours ? [] : due)) {
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

  // --- Second pass: ~1-year recheck reminders for properties marked "irrelevant" ---
  const todayDate = israelNow.slice(0, 10)
  let rechecks = 0
  const { data: dueRechecks } = await sb
    .from('approved_properties')
    .select('id, org_id, property_id, irrelevant_at, irrelevant_reason, recheck_at')
    .not('irrelevant_at', 'is', null)
    .is('recheck_reminded_at', null)
    .lte('recheck_at', todayDate)
    .limit(100)
  for (const ap of (quietHours ? [] : (dueRechecks || []))) {
    let propertyTitle = 'נכס'
    const { data: p } = await sb.from('properties').select('title, street, city').eq('id', ap.property_id).maybeSingle()
    if (p) propertyTitle = [(p as any).street, (p as any).city].filter(Boolean).join(', ') || (p as any).title || propertyTitle
    try {
      const res = await notifyAdminsPropertyRecheck({
        propertyId: ap.property_id, propertyTitle,
        markedAt: String(ap.irrelevant_at), reason: ap.irrelevant_reason || 'לא צוין',
      })
      if (res.sent > 0) {
        rechecks++
        await sb.from('approved_properties').update({ recheck_reminded_at: new Date().toISOString() }).eq('id', ap.id)
      } else if (res.errors.length) {
        errors.push({ threadId: `recheck:${ap.property_id}`, error: res.errors[0]!.error })
      }
    } catch (err) {
      errors.push({ threadId: `recheck:${ap.property_id}`, error: err instanceof Error ? err.message : String(err) })
    }
  }

  // --- Third pass: task reminders to the assignee (gated on staff template; no-ops until approved) ---
  const nowIso = new Date().toISOString()
  let taskReminders = 0
  const { data: dueTasks } = await sb
    .from('tasks')
    .select('id, org_id, title, due_at, assignee_user_id')
    .not('assignee_user_id', 'is', null)
    .not('remind_at', 'is', null)
    .is('reminded_at', null)
    .in('status', ['open', 'in_progress'])
    .lte('remind_at', nowIso)
    .limit(200)
  for (const t of (quietHours ? [] : (dueTasks || []))) {
    try {
      const dueLabel = t.due_at
        ? new Date(t.due_at).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
        : 'ללא תאריך'
      const res = await notifyStaffTask({ orgId: t.org_id, userId: t.assignee_user_id as string, taskId: t.id, title: t.title, dueLabel })
      // Stamp only on a real send, so an un-approved template re-fires once it's approved.
      if (res.sent > 0) {
        taskReminders++
        await sb.from('tasks').update({ reminded_at: nowIso }).eq('id', t.id)
      }
    } catch (err) {
      errors.push({ threadId: `task:${t.id}`, error: err instanceof Error ? err.message : String(err) })
    }
  }

  // --- Fourth pass: meeting reminders for meetings starting within the next ~60 min ---
  let meetingReminders = 0
  const in60 = new Date(Date.now() + 60 * 60000).toISOString()
  const { data: dueMeetings } = await sb
    .from('meetings')
    .select('id, org_id, title, starts_at, owner_user_id')
    .eq('status', 'confirmed')
    .is('whatsapp_reminded_at', null)
    .not('owner_user_id', 'is', null)
    .gte('starts_at', nowIso)
    .lte('starts_at', in60)
    .limit(200)
  for (const m of dueMeetings || []) {
    try {
      const timeLabel = new Date(m.starts_at).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' })
      const res = await notifyStaffMeeting({ orgId: m.org_id, userId: m.owner_user_id as string, meetingId: m.id, title: m.title, timeLabel })
      if (res.sent > 0) {
        meetingReminders++
        await sb.from('meetings').update({ whatsapp_reminded_at: nowIso }).eq('id', m.id)
      }
    } catch (err) {
      errors.push({ threadId: `meeting:${m.id}`, error: err instanceof Error ? err.message : String(err) })
    }
  }

  // --- Fifth pass: speed-to-lead — stalled conversations get an auto follow-up task (no lead falls) ---
  const STALE_DAYS = Number(process.env.FOLLOWUP_STALE_DAYS || '3')
  let followups = 0
  const staleBefore = new Date(Date.now() - STALE_DAYS * 86400000).toISOString()
  const { data: staleThreads } = await sb
    .from('threads')
    .select('id, org_id, phone, assigned_to, tags, last_message_at, status')
    .not('status', 'in', '("opted_out","closed_won","closed_lost","admin_alerts")')
    .not('last_outbound_at', 'is', null)
    .lt('last_message_at', staleBefore)
    .limit(200)
  const staleCandidates = (staleThreads || []).filter(t => {
    const tg = (t.tags && typeof t.tags === 'object' ? t.tags : {}) as Record<string, any>
    if (tg.intent === 'not_interested' || tg.intent === 'already_rented') return false
    if (tg.callback_at && String(tg.callback_at) >= israelNow) return false // already scheduled to return
    return true
  })
  if (staleCandidates.length) {
    const ids = staleCandidates.map(t => t.id)
    const { data: openTasks } = await sb.from('tasks').select('entity_id').eq('entity_type', 'thread').in('entity_id', ids).in('status', ['open', 'in_progress'])
    const hasTask = new Set((openTasks || []).map(t => t.entity_id as string))
    const nowIso2 = new Date().toISOString()
    for (const t of staleCandidates) {
      if (hasTask.has(t.id)) continue
      try {
        const { error } = await sb.from('tasks').insert({
          org_id: t.org_id, title: `מעקב — אין מענה ${STALE_DAYS}+ ימים (${t.phone || 'שיחה'})`,
          assignee_user_id: t.assigned_to || null, entity_type: 'thread', entity_id: t.id,
          due_at: nowIso2, remind_at: t.assigned_to ? nowIso2 : null, priority: 'normal', status: 'open',
        })
        if (!error) followups++
      } catch (err) {
        errors.push({ threadId: `followup:${t.id}`, error: err instanceof Error ? err.message : String(err) })
      }
    }
  }

  // --- Sixth pass: round-robin assign unassigned engaged threads so every lead has an owner ---
  let assigned = 0
  const { data: staff } = await sb.from('users').select('id').eq('is_active', true).not('phone', 'is', null).order('created_at', { ascending: true })
  const staffIds = (staff || []).map(s => s.id as string)
  if (staffIds.length) {
    const { data: unassigned } = await sb.from('threads')
      .select('id, tags, status')
      .is('assigned_to', null)
      .in('status', ['active', 'human_takeover'])
      .limit(100)
    const need = (unassigned || []).filter(t => {
      const tg = (t.tags && typeof t.tags === 'object' ? t.tags : {}) as Record<string, any>
      return t.status === 'human_takeover' || ['interested', 'price_objection', 'callback_later'].includes(tg.intent)
    })
    let i = 0
    for (const t of need) {
      const owner = staffIds[i % staffIds.length]; i++
      const { error } = await sb.from('threads').update({ assigned_to: owner }).eq('id', t.id)
      if (!error) assigned++
    }
  }

  // --- Seventh pass: gently re-engage a landlord who went quiet mid-conversation (active threads
  // only, max 2 nudges, spaced, and only 08:00–20:00 Israel). Free text within the 24h window. ---
  let reengaged = 0
  const landlordHourOk = israelHour >= 8 && israelHour < 20
  if (landlordHourOk) {
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    const sixHoursAgo = new Date(Date.now() - 6 * 3600 * 1000).toISOString()
    const { data: quiet } = await sb.from('threads')
      .select('id, org_id, phone, status, tags, last_inbound_at, last_outbound_at, last_message_at')
      .eq('status', 'active')
      .eq('channel', 'whatsapp')
      .is('opted_out_at', null)
      .not('last_outbound_at', 'is', null)
      .gt('last_inbound_at', dayAgo)         // window still open → free text allowed
      .lt('last_message_at', sixHoursAgo)    // quiet for at least 6h
      .limit(60)
    for (const t of quiet || []) {
      const tg = (t.tags && typeof t.tags === 'object' ? t.tags : {}) as Record<string, any>
      if (tg.audience === 'renter') continue                                   // landlords only
      if (!t.phone || !isInSessionWindow(t.last_inbound_at)) continue
      if (String(t.last_outbound_at || '') <= String(t.last_inbound_at || '')) continue // we're not the ones waiting
      const count = Number(tg.reengage_count || 0)
      if (count >= 2) continue
      if (tg.reengaged_at && String(tg.reengaged_at) > new Date(Date.now() - 12 * 3600 * 1000).toISOString()) continue // space ≥12h
      const msg = count === 0
        ? 'היי, רצינו להמשיך מאיפה שעצרנו לגבי הנכס. אם זה עדיין רלוונטי, נשמח שתחזרו אלינו כאן ונמשיך משם.'
        : 'היי, רק מזכירים שאנחנו כאן לכל שאלה לגבי הנכס. אם פספסנו את הזמן הנכון, מוזמנים לכתוב לנו מתי נוח להמשיך.'
      try {
        const sent = await sendText(t.phone, msg)
        const now = new Date().toISOString()
        await sb.from('messages').insert({
          org_id: t.org_id, thread_id: t.id, channel: 'whatsapp', direction: 'out', body: msg,
          status: 'sent', external_id: sent.messageId, meta_message_type: 'text',
          metadata: { sent_by_name: 'מערכת — תזכורת חזרה' },
        })
        await sb.from('threads').update({
          last_outbound_at: now, last_message_at: now,
          tags: { ...tg, reengage_count: count + 1, reengaged_at: now },
        }).eq('id', t.id)
        reengaged++
      } catch (err) {
        errors.push({ threadId: `reengage:${t.id}`, error: err instanceof Error ? err.message : String(err) })
      }
    }
  }

  return NextResponse.json({ ok: true, due: due.length, reminded, rechecksDue: (dueRechecks || []).length, rechecks, taskReminders, meetingReminders, followups, assigned, reengaged, templateSync, errors })
}

export async function GET(req: NextRequest) { return run(req) }
export async function POST(req: NextRequest) { return run(req) }

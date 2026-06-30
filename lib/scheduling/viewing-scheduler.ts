/**
 * Smart 3-way viewing scheduler — engine (Phase 3).
 *
 * Flow (see docs/superpowers/specs/2026-06-29-viewing-scheduler-phase3-design.md):
 *   renter interested → read assigned agent's free/busy → propose 3 slots → renter picks →
 *   landlord confirms → book (agent's Google calendar + a `meetings` row) → WhatsApp the agent →
 *   confirm the renter (now WITH the exact address).
 *
 * Gated by `VIEWING_SCHEDULER_ENABLED`. Degrades gracefully: if the agent isn't connected with
 * read scope, no free slots, or a needed template isn't approved yet, it falls back to the existing
 * office-alert path (`recordRenterInterest`) so nothing is lost.
 */

import { supabaseService } from '../supabase'
import { getCalendarBusy } from '../google/freebusy'
import { suggestSlots, type Slot } from './slots'
import { recordRenterInterest } from '../outreach/renter-interest'
import { sendInteractiveButtons, sendTemplate, sendText, normalizePhone } from '../whatsapp/meta-provider'
import { createCalendarEvent } from '../google/calendar'

const TZ = 'Asia/Jerusalem'
const LANDLORD_TEMPLATE = 'viewing_landlord_confirm_v1'
const AGENT_TEMPLATE = 'viewing_agent_scheduled_v1'
const VIEWING_DURATION_MIN = 30

export function viewingSchedulerEnabled(): boolean {
  const v = process.env.VIEWING_SCHEDULER_ENABLED
  return v === 'true' || v === '1'
}

type SB = ReturnType<typeof supabaseService>

// ---------- Hebrew slot formatting ----------

function localParts(d: Date): { dow: number; day: number; month: number; hh: string; mm: string } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  })
  const p: Record<string, string> = {}
  for (const part of fmt.formatToParts(d)) p[part.type] = part.value
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return {
    dow: dowMap[p.weekday || 'Sun'] ?? 0,
    day: parseInt(p.day || '1', 10),
    month: parseInt(p.month || '1', 10),
    hh: (p.hour || '00').padStart(2, '0'),
    mm: (p.minute || '00').padStart(2, '0'),
  }
}

const HE_DOW = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש']

/** Short label for a WhatsApp button title (≤20 chars), e.g. "יום ג׳ 1.7 17:00". */
export function shortSlotLabel(iso: string): string {
  const p = localParts(new Date(iso))
  return `יום ${HE_DOW[p.dow]}׳ ${p.day}.${p.month} ${p.hh}:${p.mm}`
}

/** Fuller label for message bodies, e.g. "יום שלישי 1.7 בשעה 17:00". */
export function fullSlotLabel(iso: string): string {
  const full = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'numeric' }).format(new Date(iso))
  const p = localParts(new Date(iso))
  return `${full} בשעה ${p.hh}:${p.mm}`
}

async function templateApproved(sb: SB, name: string): Promise<boolean> {
  const { data } = await sb.from('whatsapp_templates').select('status').eq('name', name).maybeSingle()
  return data?.status === 'approved'
}

// ---------- Step 1: start (propose + send renter the options) ----------

export type StartResult = { ok: boolean; reason?: string; requestId?: string; slotCount?: number }

export async function startViewingScheduling(opts: {
  orgId: string
  renterId: string
  propertyId: string
  renterThreadId: string
  renterPhone: string
}): Promise<StartResult> {
  if (!viewingSchedulerEnabled()) return { ok: false, reason: 'disabled' }
  const sb = supabaseService()

  // Don't double-schedule: if there's already an in-flight request for this renter+property, stop.
  const { data: inflight } = await sb
    .from('viewing_requests')
    .select('id')
    .eq('org_id', opts.orgId)
    .eq('renter_id', opts.renterId)
    .eq('property_id', opts.propertyId)
    .in('status', ['proposing', 'awaiting_renter', 'awaiting_landlord'])
    .maybeSingle()
  if (inflight) return { ok: false, reason: 'already_in_flight', requestId: inflight.id }

  const { data: property } = await sb
    .from('properties')
    .select('id, assigned_agent_user_id')
    .eq('id', opts.propertyId)
    .eq('org_id', opts.orgId)
    .maybeSingle()
  const agentUserId = property?.assigned_agent_user_id as string | null | undefined
  if (!agentUserId) return { ok: false, reason: 'no_assigned_agent' }

  // Read the agent's free/busy for the next week (requires calendar.readonly — may fail until the
  // agent reconnects; treat any failure as "can't auto-schedule" and fall back).
  const from = new Date(Date.now() + 3 * 60 * 60 * 1000) // ≥3h lead
  const to = new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000)
  let busy
  try {
    busy = await getCalendarBusy(opts.orgId, agentUserId, from, to)
  } catch {
    return { ok: false, reason: 'agent_calendar_unavailable' }
  }

  const slots: Slot[] = suggestSlots({
    busy, from, lookaheadDays: 7, durationMin: VIEWING_DURATION_MIN,
    dayStartHour: 10, dayEndHour: 20, count: 3, stepMin: 30,
  })
  if (slots.length === 0) return { ok: false, reason: 'no_free_slots' }

  const proposed = slots.map(s => ({ start: s.start.toISOString(), end: s.end.toISOString() }))
  const { data: reqRow, error } = await sb
    .from('viewing_requests')
    .insert({
      org_id: opts.orgId, renter_id: opts.renterId, property_id: opts.propertyId,
      agent_user_id: agentUserId, renter_thread_id: opts.renterThreadId,
      status: 'awaiting_renter', proposed_slots: proposed,
    })
    .select('id')
    .single()
  if (error || !reqRow) return { ok: false, reason: 'db_error' }

  // Renter just messaged us → inside the 24h window → free-form interactive buttons (no template).
  try {
    await sendInteractiveButtons({
      to: opts.renterPhone,
      body: 'מצאתי כמה מועדים אפשריים לצפייה בדירה. מה הכי מתאים?',
      buttons: proposed.slice(0, 3).map((s, i) => ({ id: `vw:${reqRow.id}:${i}`, title: shortSlotLabel(s.start).slice(0, 20) })),
    })
  } catch {
    await sb.from('viewing_requests').update({ status: 'failed', note: 'send_options_failed', updated_at: new Date().toISOString() }).eq('id', reqRow.id)
    return { ok: false, reason: 'send_options_failed', requestId: reqRow.id }
  }
  return { ok: true, requestId: reqRow.id, slotCount: proposed.length }
}

// ---------- Step 2: renter picks a slot (vw:<id>:<idx> button) ----------

export async function handleRenterSlotChoice(buttonId: string): Promise<{ ok: boolean; reason?: string }> {
  const m = /^vw:([0-9a-f-]{36}):(\d+)$/i.exec(buttonId)
  if (!m) return { ok: false, reason: 'bad_button' }
  const reqId = m[1]!, idx = parseInt(m[2]!, 10)
  const sb = supabaseService()

  const { data: req } = await sb.from('viewing_requests').select('*').eq('id', reqId).maybeSingle()
  if (!req || req.status !== 'awaiting_renter') return { ok: false, reason: 'not_awaiting_renter' }
  const slots = Array.isArray(req.proposed_slots) ? req.proposed_slots as Array<{ start: string; end: string }> : []
  const chosen = slots[idx]
  if (!chosen) return { ok: false, reason: 'bad_index' }

  // Property + landlord contact for the confirm request.
  const { data: property } = await sb
    .from('properties')
    .select('city, neighborhood, street, contact_phone, contact_name, owner_viewing_availability')
    .eq('id', req.property_id)
    .maybeSingle()
  const cityClean = (property?.city || '').replace(/\s*-\s*(מגורים|משרדים|rent).*$/i, '').trim()
  const location = [property?.neighborhood, cityClean].filter(Boolean).join(' · ') || cityClean || 'הדירה'
  const { data: agent } = req.agent_user_id
    ? await sb.from('users').select('name, phone').eq('id', req.agent_user_id).maybeSingle()
    : { data: null as any }
  const agentName = agent?.name || 'הסוכן שלנו'

  // Ask the landlord to confirm (template — landlord is likely out of the 24h window).
  let landlordThreadId: string | null = null
  if (property?.contact_phone && await templateApproved(sb, LANDLORD_TEMPLATE)) {
    const lphone = normalizePhone(property.contact_phone)
    try {
      await sendTemplate({
        to: lphone, name: LANDLORD_TEMPLATE, language: 'he',
        components: [{ type: 'body', parameters: [
          { type: 'text', text: location },
          { type: 'text', text: fullSlotLabel(chosen.start) },
          { type: 'text', text: agentName },
        ] }],
      })
      landlordThreadId = await upsertThreadId(sb, req.org_id, lphone)
    } catch {/* fall through to office fallback below */}
  }

  await sb.from('viewing_requests').update({
    status: 'awaiting_landlord', chosen_slot: chosen, landlord_thread_id: landlordThreadId, updated_at: new Date().toISOString(),
  }).eq('id', reqId)

  // Reply to the renter (in-window free text).
  if (req.renter_thread_id) {
    const phone = await threadPhone(sb, req.renter_thread_id)
    if (phone) { try { await sendText(phone, `מעולה, בחרת ${fullSlotLabel(chosen.start)}. אני מתאם/ת מול בעל/ת הדירה ואחזור אליך לאישור סופי.`) } catch {/* ignore */} }
  }

  // If we couldn't reach the landlord by template, alert the office to confirm manually.
  if (!landlordThreadId) {
    await recordRenterInterest({ orgId: req.org_id, renterId: req.renter_id, propertyId: req.property_id, threadId: req.renter_thread_id, source: 'reply_bot' }).catch(() => {})
  }
  return { ok: true }
}

// ---------- Step 3: landlord confirms / declines ----------

const AFFIRM = /(מאשר|מתאים|כן|אישור|אוקיי|אוקי|סבבה|טוב|👍|בסדר|אפשר)/
const DECLINE = /(לא מתאים|לא|אי אפשר|נדחה|לדחות|מבטל)/

export async function handleLandlordDecision(landlordThreadId: string, text: string): Promise<{ ok: boolean; handled: boolean; reason?: string }> {
  const sb = supabaseService()
  const { data: req } = await sb
    .from('viewing_requests')
    .select('*')
    .eq('landlord_thread_id', landlordThreadId)
    .eq('status', 'awaiting_landlord')
    .order('updated_at', { ascending: false })
    .maybeSingle()
  if (!req) return { ok: true, handled: false }

  const t = (text || '').trim()
  const declined = DECLINE.test(t) && !/לא מתאים לי הזמן הזה בלבד/.test(t)
  const affirmed = !declined && AFFIRM.test(t)
  if (!affirmed && !declined) return { ok: true, handled: false } // let a human read ambiguous replies

  if (declined) {
    await sb.from('viewing_requests').update({ status: 'cancelled', note: 'landlord_declined', updated_at: new Date().toISOString() }).eq('id', req.id)
    // Tell the renter we'll find another time; alert the office to re-coordinate.
    if (req.renter_thread_id) { const ph = await threadPhone(sb, req.renter_thread_id); if (ph) { try { await sendText(ph, 'המועד הזה לא הסתדר מול בעל/ת הדירה — נתאם מועד אחר ונחזור אליך בהקדם.') } catch {/* ignore */} } }
    await recordRenterInterest({ orgId: req.org_id, renterId: req.renter_id, propertyId: req.property_id, threadId: req.renter_thread_id, source: 'reply_bot' }).catch(() => {})
    return { ok: true, handled: true, reason: 'declined' }
  }

  // Affirmed → book it.
  await bookViewing(sb, req)
  return { ok: true, handled: true, reason: 'confirmed' }
}

// ---------- Step 4: book (calendar + meeting + notifications) ----------

async function bookViewing(sb: SB, req: any): Promise<void> {
  const chosen = req.chosen_slot as { start: string; end: string } | null
  if (!chosen) return

  const { data: property } = await sb
    .from('properties')
    .select('city, neighborhood, street, contact_name')
    .eq('id', req.property_id)
    .maybeSingle()
  const { data: renter } = await sb.from('renters').select('first_name, last_name, phone, email').eq('id', req.renter_id).maybeSingle()
  const cityClean = (property?.city || '').replace(/\s*-\s*(מגורים|משרדים|rent).*$/i, '').trim()
  const fullAddress = [property?.street, cityClean].filter(Boolean).join(', ') || cityClean
  const location = [property?.neighborhood, cityClean].filter(Boolean).join(' · ') || cityClean

  // Create the event on the agent's calendar (write scope — agents already have calendar.events).
  let googleEventId: string | null = null
  if (req.agent_user_id) {
    try {
      const ev = await createCalendarEvent({
        orgId: req.org_id, userId: req.agent_user_id,
        summary: `צפייה — ${location}`,
        description: `שוכר/ת: ${[renter?.first_name, renter?.last_name].filter(Boolean).join(' ')} ${renter?.phone || ''}\nכתובת: ${fullAddress}`,
        start: new Date(chosen.start), end: new Date(chosen.end),
        ...(renter?.email ? { attendees: [renter.email] } : {}),
      })
      googleEventId = ev.eventId
    } catch {/* calendar write failed — still record the meeting + notify */}
  }

  // Confirmed meeting row (plugs into the existing ~1h-before staff reminder cron).
  const { data: meeting } = await sb.from('meetings').insert({
    org_id: req.org_id, owner_user_id: req.agent_user_id, created_by: req.agent_user_id,
    title: `צפייה — ${location}`, location: fullAddress,
    property_id: req.property_id, renter_id: req.renter_id, thread_id: req.renter_thread_id,
    google_event_id: googleEventId, google_calendar_id: 'primary',
    starts_at: chosen.start, ends_at: chosen.end, status: 'confirmed', kind: 'viewing',
  }).select('id').single()

  await sb.from('viewing_requests').update({
    status: 'confirmed', meeting_id: meeting?.id || null, google_event_id: googleEventId, updated_at: new Date().toISOString(),
  }).eq('id', req.id)

  // Confirm the renter — NOW reveal the exact address (viewing is set).
  if (req.renter_thread_id) {
    const ph = await threadPhone(sb, req.renter_thread_id)
    if (ph) { try { await sendText(ph, `מצוין! נקבעה צפייה ל${fullSlotLabel(chosen.start)}.\nכתובת: ${fullAddress}\nנתראה שם!`) } catch {/* ignore */} }
  }

  // WhatsApp the agent the details (template, if approved; otherwise the calendar event covers it).
  if (req.agent_user_id && await templateApproved(sb, AGENT_TEMPLATE)) {
    const { data: agent } = await sb.from('users').select('phone').eq('id', req.agent_user_id).maybeSingle()
    if (agent?.phone) {
      const renterLabel = `${[renter?.first_name, renter?.last_name].filter(Boolean).join(' ') || 'שוכר'} ${renter?.phone || ''}`.trim()
      try {
        await sendTemplate({
          to: normalizePhone(agent.phone), name: AGENT_TEMPLATE, language: 'he',
          components: [
            { type: 'body', parameters: [
              { type: 'text', text: location },
              { type: 'text', text: fullSlotLabel(chosen.start) },
              { type: 'text', text: renterLabel.slice(0, 60) },
              { type: 'text', text: (property?.contact_name || 'בעל/ת הנכס').slice(0, 60) },
            ] },
            { type: 'button', sub_type: 'url', index: 0, parameters: [{ type: 'text', text: req.renter_thread_id || 'x' }] },
          ],
        })
      } catch {/* best-effort */}
    }
  }
}

// ---------- small helpers ----------

async function threadPhone(sb: SB, threadId: string): Promise<string | null> {
  const { data } = await sb.from('threads').select('phone').eq('id', threadId).maybeSingle()
  return data?.phone || null
}

async function upsertThreadId(sb: SB, orgId: string, phone: string): Promise<string | null> {
  const { data: existing } = await sb.from('threads').select('id').eq('org_id', orgId).eq('phone', phone).maybeSingle()
  if (existing) return existing.id
  const { data: created } = await sb.from('threads').insert({ org_id: orgId, phone, channel: 'whatsapp', status: 'human_takeover' }).select('id').single()
  return created?.id || null
}

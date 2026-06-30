/**
 * Smart 3-way viewing scheduler — engine (Phase 3).
 *
 * Flow (landlord-proposes, system-filters; user-confirmed 2026-06-30):
 *   renter interested → ASK THE LANDLORD for a few possible times → landlord replies (free text) →
 *   parse the times + FILTER against the assigned agent's calendar free/busy → send the renter the
 *   times the agent is free for → renter picks → book on the agent's calendar (+ tell the landlord
 *   which time was chosen, reveal the exact address to the renter, WhatsApp the agent).
 *
 * Gated by `VIEWING_SCHEDULER_ENABLED`. Degrades gracefully: missing assigned agent / landlord phone
 * / unapproved ask-template / unparseable reply → falls back to the office-alert path so nothing is
 * lost. If the agent isn't read-connected, we trust the landlord's times (can't filter).
 */

import OpenAI from 'openai'
import { supabaseService } from '../supabase'
import { getCalendarBusy } from '../google/freebusy'
import { recordRenterInterest } from '../outreach/renter-interest'
import { sendInteractiveButtons, sendTemplate, sendText, normalizePhone } from '../whatsapp/meta-provider'
import { createCalendarEvent } from '../google/calendar'
import { israelLocalToDate } from '../google/auto-callback-event'

const TZ = 'Asia/Jerusalem'
const LANDLORD_ASK_TEMPLATE = 'viewing_landlord_times_v1'
const AGENT_TEMPLATE = 'viewing_agent_scheduled_v1'
const VIEWING_DURATION_MIN = 30

export function viewingSchedulerEnabled(): boolean {
  const v = process.env.VIEWING_SCHEDULER_ENABLED
  return v === 'true' || v === '1'
}

type SB = ReturnType<typeof supabaseService>

let _client: OpenAI | null = null
function openai(): OpenAI {
  if (_client) return _client
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY missing')
  _client = new OpenAI({ apiKey })
  return _client
}

// ---------- Hebrew labels ----------

function localParts(d: Date): { dow: number; minutes: number } {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
  const p: Record<string, string> = {}
  for (const part of fmt.formatToParts(d)) p[part.type] = part.value
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return { dow: dowMap[p.weekday || 'Sun'] ?? 0, minutes: (parseInt(p.hour || '0', 10) % 24) * 60 + parseInt(p.minute || '0', 10) }
}

const HE_DOW = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש']

/** Short label for a WhatsApp button title (≤20 chars), e.g. "יום ג׳ 1.7 17:00". */
export function shortSlotLabel(iso: string): string {
  const d = new Date(iso)
  const f = new Intl.DateTimeFormat('en-US', { timeZone: TZ, day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
  const p: Record<string, string> = {}
  for (const x of f.formatToParts(d)) p[x.type] = x.value
  return `יום ${HE_DOW[localParts(d).dow]}׳ ${p.day}.${p.month} ${p.hour}:${p.minute}`
}

/** Fuller label for message bodies, e.g. "יום שלישי 1.7 בשעה 17:00". */
export function fullSlotLabel(iso: string): string {
  const d = new Date(iso)
  const full = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'numeric' }).format(d)
  const f = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })
  const p: Record<string, string> = {}
  for (const x of f.formatToParts(d)) p[x.type] = x.value
  return `${full} בשעה ${p.hour}:${p.minute}`
}

async function templateApproved(sb: SB, name: string): Promise<boolean> {
  const { data } = await sb.from('whatsapp_templates').select('status').eq('name', name).maybeSingle()
  return data?.status === 'approved'
}

function locationLabel(property: { city?: string | null; neighborhood?: string | null }): string {
  const cityClean = (property.city || '').replace(/\s*-\s*(מגורים|משרדים|rent).*$/i, '').trim()
  return [property.neighborhood, cityClean].filter(Boolean).join(' · ') || cityClean || 'הדירה'
}

// ---------- Step 1: renter interested → ask the landlord for times ----------

export type StartResult = { ok: boolean; reason?: string; requestId?: string }

export async function startViewingScheduling(opts: {
  orgId: string
  renterId: string
  propertyId: string
  renterThreadId: string
  renterPhone: string
}): Promise<StartResult> {
  if (!viewingSchedulerEnabled()) return { ok: false, reason: 'disabled' }
  const sb = supabaseService()

  const { data: inflight } = await sb
    .from('viewing_requests')
    .select('id')
    .eq('org_id', opts.orgId)
    .eq('renter_id', opts.renterId)
    .eq('property_id', opts.propertyId)
    .in('status', ['awaiting_landlord_times', 'awaiting_renter'])
    .maybeSingle()
  if (inflight) return { ok: false, reason: 'already_in_flight', requestId: inflight.id }

  const { data: property } = await sb
    .from('properties')
    .select('id, city, neighborhood, assigned_agent_user_id, contact_phone')
    .eq('id', opts.propertyId)
    .eq('org_id', opts.orgId)
    .maybeSingle()
  if (!property?.assigned_agent_user_id) return { ok: false, reason: 'no_assigned_agent' }
  if (!property.contact_phone) return { ok: false, reason: 'no_landlord_phone' }
  if (!(await templateApproved(sb, LANDLORD_ASK_TEMPLATE))) return { ok: false, reason: 'ask_template_pending' }

  const lphone = normalizePhone(property.contact_phone)
  const location = locationLabel(property)

  // Ask the landlord for possible times (template — landlord likely out of the 24h window).
  try {
    await sendTemplate({
      to: lphone, name: LANDLORD_ASK_TEMPLATE, language: 'he',
      components: [{ type: 'body', parameters: [{ type: 'text', text: location }] }],
    })
  } catch {
    return { ok: false, reason: 'ask_send_failed' }
  }
  const landlordThreadId = await upsertThreadId(sb, opts.orgId, lphone, opts.propertyId)

  const { data: reqRow } = await sb
    .from('viewing_requests')
    .insert({
      org_id: opts.orgId, renter_id: opts.renterId, property_id: opts.propertyId,
      agent_user_id: property.assigned_agent_user_id, renter_thread_id: opts.renterThreadId,
      landlord_thread_id: landlordThreadId, status: 'awaiting_landlord_times',
    })
    .select('id')
    .single()
  return { ok: true, requestId: reqRow?.id }
}

// ---------- Step 2: landlord replies with times → filter vs agent calendar → send renter ----------

export async function handleLandlordTimes(landlordThreadId: string, text: string): Promise<{ handled: boolean; reason?: string }> {
  const sb = supabaseService()
  const { data: req } = await sb
    .from('viewing_requests')
    .select('*')
    .eq('landlord_thread_id', landlordThreadId)
    .eq('status', 'awaiting_landlord_times')
    .order('updated_at', { ascending: false })
    .maybeSingle()
  if (!req) return { handled: false }

  const lphone = await threadPhone(sb, landlordThreadId)
  const candidates = await parseLandlordTimes(text)
  if (candidates.length === 0) {
    if (lphone) { try { await sendText(lphone, 'לא הצלחתי לקלוט את המועדים. אפשר לכתוב למשל: "ראשון 17:00, שלישי 18:30, חמישי בבוקר"?') } catch {/* ignore */} }
    return { handled: true, reason: 'unparsed' }
  }

  const free = await filterFreeAgainstAgent(req.org_id, req.agent_user_id, candidates)
  if (free.length === 0) {
    if (lphone) { try { await sendText(lphone, 'תודה! המועדים האלה כבר תפוסים אצל הסוכן. אפשר להציע מועדים אחרים?') } catch {/* ignore */} }
    return { handled: true, reason: 'none_free' }
  }

  const proposed = free.map(d => ({ start: d.toISOString(), end: new Date(d.getTime() + VIEWING_DURATION_MIN * 60000).toISOString() }))
  await sb.from('viewing_requests').update({ status: 'awaiting_renter', proposed_slots: proposed, updated_at: new Date().toISOString() }).eq('id', req.id)

  // Send the renter the available times (free-form interactive — the renter is in-window).
  const renterPhone = req.renter_thread_id ? await threadPhone(sb, req.renter_thread_id) : null
  if (renterPhone) {
    try {
      await sendInteractiveButtons({
        to: renterPhone,
        body: 'מצאנו מועדים אפשריים לצפייה בדירה. מה הכי מתאים?',
        buttons: proposed.slice(0, 3).map((s, i) => ({ id: `vw:${req.id}:${i}`, title: shortSlotLabel(s.start).slice(0, 20) })),
      })
    } catch {/* renter will be handled by the office fallback */}
  }
  if (lphone) { try { await sendText(lphone, 'תודה! שלחתי את המועדים הפנויים לשוכר/ת, ונעדכן ברגע שייבחר מועד.') } catch {/* ignore */} }
  return { handled: true, reason: 'sent_to_renter' }
}

// ---------- Step 3: renter picks a slot (vw:<id>:<idx> button) → book ----------

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

  await bookViewing(sb, req, chosen)
  return { ok: true }
}

// ---------- Step 4: book (calendar + meeting + notifications) ----------

async function bookViewing(sb: SB, req: any, chosen: { start: string; end: string }): Promise<void> {
  const { data: property } = await sb
    .from('properties')
    .select('city, neighborhood, street, contact_name')
    .eq('id', req.property_id)
    .maybeSingle()
  const { data: renter } = await sb.from('renters').select('first_name, last_name, phone, email').eq('id', req.renter_id).maybeSingle()
  const cityClean = (property?.city || '').replace(/\s*-\s*(מגורים|משרדים|rent).*$/i, '').trim()
  const fullAddress = [property?.street, cityClean].filter(Boolean).join(', ') || cityClean
  const location = locationLabel(property || {})

  // Event on the agent's calendar (write scope — agents already have calendar.events).
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
    } catch {/* still record the meeting + notify */}
  }

  const { data: meeting } = await sb.from('meetings').insert({
    org_id: req.org_id, owner_user_id: req.agent_user_id, created_by: req.agent_user_id,
    title: `צפייה — ${location}`, location: fullAddress,
    property_id: req.property_id, renter_id: req.renter_id, thread_id: req.renter_thread_id,
    google_event_id: googleEventId, google_calendar_id: 'primary',
    starts_at: chosen.start, ends_at: chosen.end, status: 'confirmed', kind: 'viewing',
  }).select('id').single()

  await sb.from('viewing_requests').update({
    status: 'confirmed', meeting_id: meeting?.id || null, google_event_id: googleEventId, chosen_slot: chosen, updated_at: new Date().toISOString(),
  }).eq('id', req.id)

  // Confirm the renter — reveal the exact address now (viewing is set).
  if (req.renter_thread_id) {
    const ph = await threadPhone(sb, req.renter_thread_id)
    if (ph) { try { await sendText(ph, `מצוין! נקבעה צפייה ל${fullSlotLabel(chosen.start)}.\nכתובת: ${fullAddress}\nנתראה שם!`) } catch {/* ignore */} }
  }

  // Tell the landlord which time was chosen (free text — they replied recently, so in-window).
  if (req.landlord_thread_id) {
    const lph = await threadPhone(sb, req.landlord_thread_id)
    if (lph) { try { await sendText(lph, `מעולה — נקבעה צפייה ל${fullSlotLabel(chosen.start)}. תודה!`) } catch {/* ignore */} }
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

// ---------- time parsing + calendar filter ----------

/** Parse a landlord's free-text reply into up to 3 future viewing times (Israel local → UTC Date). */
async function parseLandlordTimes(text: string): Promise<Date[]> {
  const nowLocal = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date())
  let content = ''
  try {
    const res = await openai().chat.completions.create({
      model: process.env.OPENAI_PARSE_MODEL || process.env.OPENAI_AGENT_MODEL || 'gpt-5.4',
      temperature: 0,
      messages: [
        { role: 'system', content: `עכשיו ${nowLocal} (שעון ישראל). בעל/ת דירה כתב/ה מתי נוח להראות דירה. החזר/י אך ורק JSON בצורה {"slots":["YYYY-MM-DDTHH:MM"]} — עד 3 מועדים עתידיים בשעון ישראל מקומי, בלי אזור זמן. אם חסרה שעה — קבע/י 17:00. אם מועד לא ברור או בעבר — דלג/י עליו. בלי טקסט נוסף.` },
        { role: 'user', content: text.slice(0, 500) },
      ],
    })
    content = res.choices[0]?.message?.content || ''
  } catch { return [] }

  let parsed: any = {}
  try {
    const json = content.match(/\{[\s\S]*\}/)
    parsed = json ? JSON.parse(json[0]) : {}
  } catch { return [] }
  const slots = Array.isArray(parsed.slots) ? parsed.slots : []
  const out: Date[] = []
  for (const s of slots.slice(0, 3)) {
    if (typeof s !== 'string') continue
    const d = israelLocalToDate(s)
    if (!Number.isNaN(d.getTime())) out.push(d)
  }
  return out
}

/** Keep the candidate times that are in the future, not on Shabbat, and the agent is FREE for. */
async function filterFreeAgainstAgent(orgId: string, agentUserId: string | null, candidates: Date[]): Promise<Date[]> {
  const future = candidates.filter(d => d.getTime() > Date.now() + 30 * 60000 && localParts(d).dow !== 6)
  if (future.length === 0 || !agentUserId) return future.slice(0, 3)
  const min = new Date(Math.min(...future.map(d => d.getTime())) - 60000)
  const max = new Date(Math.max(...future.map(d => d.getTime())) + (VIEWING_DURATION_MIN + 1) * 60000)
  let busy
  try { busy = await getCalendarBusy(orgId, agentUserId, min, max) } catch { return future.slice(0, 3) } // can't read → trust the landlord
  const B = busy.map(b => ({ s: Date.parse(b.start), e: Date.parse(b.end) }))
  const free = future.filter(d => { const s = d.getTime(), e = s + VIEWING_DURATION_MIN * 60000; return !B.some(b => s < b.e && e > b.s) })
  return free.slice(0, 3)
}

// ---------- small helpers ----------

async function threadPhone(sb: SB, threadId: string): Promise<string | null> {
  const { data } = await sb.from('threads').select('phone').eq('id', threadId).maybeSingle()
  return data?.phone || null
}

async function upsertThreadId(sb: SB, orgId: string, phone: string, propertyId: string): Promise<string | null> {
  const { data: existing } = await sb.from('threads').select('id').eq('org_id', orgId).eq('phone', phone).maybeSingle()
  if (existing) return existing.id
  const { data: created } = await sb.from('threads').insert({ org_id: orgId, phone, channel: 'whatsapp', status: 'human_takeover', property_id: propertyId }).select('id').single()
  return created?.id || null
}

/**
 * Shared "a renter is interested in viewing this property" recorder.
 *
 * Two callers:
 *  - `app/api/v1/shares/[token]/interest` — the renter tapped "מעוניין/ת לראות" on their /share page.
 *  - the renter reply-bot's `express_interest` tool — the renter said so in WhatsApp.
 *
 * Effects (all best-effort except the message insert):
 *  - drop an inbound `meta_message_type:'interest'` message on the renter's thread (so it surfaces
 *    in the inbox with a clear label),
 *  - set `tags.interested = true` and anchor the thread to this property,
 *  - WhatsApp-alert the office (`notifyAdminsRenterInterest` → `renter_interest_alert_v2`),
 *  - email the property's assigned agent the renter's details.
 *
 * The street address IS used here (office-facing alert + email only) so staff know exactly which
 * apartment — it is never sent to the renter.
 */

import { supabaseService } from '../supabase'
import { normalizePhone } from './phone'
import { notifyAdminsRenterInterest } from '../alerts/admin-whatsapp'
import { sendGmail } from '../google/gmail'

export type RecordInterestResult = { ok: boolean; recorded: boolean; threadId?: string }

export async function recordRenterInterest(opts: {
  orgId: string
  renterId: string
  propertyId: string
  /** Known thread (reply-bot). When omitted, resolve/create by the renter's phone (share link). */
  threadId?: string | null
  /** Match row for the % score in the office alert. */
  matchId?: string | null
  /** Share link flips the thread to human_takeover; the reply-bot keeps it active to keep chatting. */
  flipToHumanTakeover?: boolean
  source: 'share_link' | 'reply_bot'
}): Promise<RecordInterestResult> {
  const { orgId, renterId, propertyId, matchId, flipToHumanTakeover = false, source } = opts
  const sb = supabaseService()

  // Property label (specific address — office-facing only, never shown to the renter).
  const { data: prop } = await sb
    .from('properties')
    .select('city, neighborhood, street, price, rooms, assigned_agent_user_id')
    .eq('id', propertyId)
    .maybeSingle()
  const cityClean = (prop?.city || '').replace(/\s*-\s*(מגורים|משרדים|rent).*$/i, '').trim()
  const location = prop
    ? ([prop.street, cityClean].filter(Boolean).join(', ') || cityClean || prop.street || '')
    : ''

  const { data: renter } = await sb
    .from('renters')
    .select('phone, first_name, last_name, budget_min, budget_max, preferred_rooms, move_in_date, household_size, notes')
    .eq('id', renterId)
    .maybeSingle()
  if (!renter?.phone) return { ok: true, recorded: false }
  const phone = normalizePhone(renter.phone)

  // Resolve the thread.
  let threadId = opts.threadId || null
  let tags: Record<string, unknown> = {
    audience: 'renter',
    renter_id: renterId,
    ...(renter.first_name ? { renter_name: renter.first_name } : {}),
  }
  if (!threadId) {
    const { data: existing } = await sb
      .from('threads')
      .select('id, tags')
      .eq('org_id', orgId)
      .eq('phone', phone)
      .maybeSingle()
    if (existing) {
      threadId = existing.id
      if (existing.tags && typeof existing.tags === 'object') tags = existing.tags as Record<string, unknown>
    } else {
      const { data: created } = await sb
        .from('threads')
        .insert({ org_id: orgId, phone, channel: 'whatsapp', status: 'human_takeover', property_id: propertyId, tags })
        .select('id')
        .single()
      threadId = created?.id || null
    }
  } else {
    const { data: existing } = await sb.from('threads').select('tags').eq('id', threadId).maybeSingle()
    if (existing?.tags && typeof existing.tags === 'object') tags = existing.tags as Record<string, unknown>
  }
  if (!threadId) return { ok: false, recorded: false }

  const now = new Date().toISOString()
  await sb.from('messages').insert({
    org_id: orgId,
    thread_id: threadId,
    property_id: propertyId,
    channel: 'whatsapp',
    direction: 'in',
    status: 'received',
    meta_message_type: 'interest',
    body: location ? `מעוניין/ת לראות את הדירה — ${location}` : 'מעוניין/ת לראות את הדירה',
    metadata: { kind: 'interest', renter_id: renterId, property_id: propertyId, source },
  })

  await sb
    .from('threads')
    .update({
      ...(flipToHumanTakeover ? { status: 'human_takeover' } : {}),
      last_inbound_at: now,
      last_message_at: now,
      tags: { ...tags, interested: true },
      property_id: propertyId,
    })
    .eq('id', threadId)

  // Office WhatsApp alert (fail-soft — needs ADMIN_ALERT_PHONES + approved template).
  let score = ''
  if (matchId) {
    const { data: m } = await sb.from('matches').select('score').eq('id', matchId).maybeSingle()
    if (m?.score != null) score = String(Math.round(Number(m.score)))
  }
  try {
    await notifyAdminsRenterInterest({
      renterId,
      renterName: renter.first_name || 'שוכר',
      renterPhone: renter.phone,
      propertyLocation: location,
      price: prop?.price != null ? Number(prop.price).toLocaleString('en-US') : '',
      rooms: prop?.rooms != null ? String(prop.rooms) : '',
      score,
    })
  } catch {/* best-effort */}

  // Email the property's assigned agent the renter's details (fail-soft).
  try {
    if (prop?.assigned_agent_user_id) {
      const { data: agent } = await sb.from('users').select('email, name').eq('id', prop.assigned_agent_user_id).eq('org_id', orgId).maybeSingle()
      const { data: sender } = await sb.from('google_connections').select('user_id').eq('org_id', orgId).eq('status', 'active').limit(1).maybeSingle()
      if (agent?.email && sender?.user_id) {
        const fullName = [renter.first_name, renter.last_name].filter(Boolean).join(' ') || 'שוכר'
        const budget = renter.budget_min || renter.budget_max
          ? `${renter.budget_min ? `₪${Number(renter.budget_min).toLocaleString('he-IL')}` : ''}${renter.budget_max ? `–₪${Number(renter.budget_max).toLocaleString('he-IL')}` : ''}`
          : '—'
        const lines = [
          `שוכר/ת מעוניין/ת לראות את הנכס: ${location || '—'}`,
          prop.price != null ? `מחיר: ₪${Number(prop.price).toLocaleString('he-IL')}` : '',
          score ? `התאמה: ${score}%` : '',
          '',
          'פרטי השוכר/ת:',
          `שם: ${fullName}`,
          `טלפון: ${renter.phone}`,
          `תקציב: ${budget}`,
          renter.preferred_rooms != null ? `חדרים מבוקשים: ${renter.preferred_rooms}` : '',
          renter.household_size != null ? `גודל משק בית: ${renter.household_size}` : '',
          renter.move_in_date ? `כניסה: ${renter.move_in_date}` : '',
          renter.notes ? `הערות: ${renter.notes}` : '',
          '',
          `${(process.env.APP_BASE_URL || '').replace(/\/$/, '')}/renters/${renterId}`,
        ].filter(Boolean)
        await sendGmail({
          orgId, userId: sender.user_id, to: agent.email,
          subject: `מעוניין/ת לראות דירה — ${location || 'נכס'}`, text: lines.join('\n'),
        })
      }
    }
  } catch {/* best-effort — email failures never block recording the interest */}

  return { ok: true, recorded: true, threadId }
}

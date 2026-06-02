/**
 * Dispatch a "we found a matching apartment" WhatsApp alert to a RENTER.
 *
 * This is the renter-facing counterpart to `dispatcher.ts` (which targets
 * landlords). A renter who filled the questionnaire has no open 24h session
 * window, so the first touch MUST be a template — `renter_match_alert_v1`:
 *   - IMAGE header  → the property's cover photo
 *   - BODY (4 vars) → first name, location, rooms, price (partial details,
 *                     never the full street address)
 *   - URL button    → the public /share/<token> page for full details
 *
 * Both the single-trigger endpoint and the batch cron call this, so the
 * validations and side-effects stay identical regardless of trigger source.
 *
 * Renter threads are parked in `human_takeover` with an `audience: 'renter'`
 * tag: the landlord-outreach AI agent must NOT auto-reply to renters, so a
 * human handles their replies from the inbox until a renter-side agent exists.
 */

import { nanoid } from 'nanoid'
import { supabaseService } from '../supabase'
import { sendTemplate, normalizePhone } from '../whatsapp/meta-provider'
import { isSuppressed } from './suppression'

const TEMPLATE_NAME = 'renter_match_alert_v1'
const TEMPLATE_LANG = 'he'

function appBaseUrl(): string {
  return (process.env.APP_BASE_URL || 'https://rent360-vert.vercel.app').replace(/\/+$/, '')
}

export type RenterAlertResult =
  | { ok: true; messageId: string; threadId: string; phone: string; shareUrl: string }
  | { ok: false; code: string; message: string }

export async function dispatchRenterMatchAlert(opts: {
  orgId: string
  renterId: string
  propertyId: string
  /** When provided, dedupe on this match row's `renter_notified_at`. */
  matchId?: string | undefined
  /** Bypass the already-notified guard. */
  force?: boolean
}): Promise<RenterAlertResult> {
  const { orgId, renterId, propertyId, matchId, force } = opts
  const sb = supabaseService()

  // ---- Renter ----
  const { data: renter, error: rErr } = await sb
    .from('renters')
    .select('id, phone, first_name')
    .eq('id', renterId)
    .maybeSingle()
  if (rErr) return { ok: false, code: 'DB_ERROR', message: rErr.message }
  if (!renter) return { ok: false, code: 'RENTER_NOT_FOUND', message: 'לקוח לא נמצא' }
  if (!renter.phone) return { ok: false, code: 'PHONE_MISSING', message: 'אין מספר טלפון ללקוח' }

  // ---- Property ----
  const { data: property, error: pErr } = await sb
    .from('properties')
    .select('id, org_id, city, neighborhood, rooms, price, images')
    .eq('id', propertyId)
    .eq('org_id', orgId)
    .maybeSingle()
  if (pErr) return { ok: false, code: 'DB_ERROR', message: pErr.message }
  if (!property) return { ok: false, code: 'PROPERTY_NOT_FOUND', message: 'נכס לא נמצא בארגון' }

  const images: string[] = Array.isArray(property.images)
    ? property.images.filter((u): u is string => typeof u === 'string' && u.startsWith('http'))
    : []
  const coverImage = images[0]
  if (!coverImage) return { ok: false, code: 'NO_IMAGE', message: 'אין תמונה לנכס (נדרשת לכותרת ההודעה)' }
  if (property.rooms === null || property.rooms === undefined) return { ok: false, code: 'ROOMS_MISSING', message: 'אין מספר חדרים לנכס' }
  if (property.price === null || property.price === undefined) return { ok: false, code: 'PRICE_MISSING', message: 'אין מחיר לנכס' }
  if (!property.city) return { ok: false, code: 'CITY_MISSING', message: 'אין עיר לנכס' }

  // ---- Suppression ----
  const phone = normalizePhone(renter.phone)
  if (await isSuppressed(orgId, phone)) {
    return { ok: false, code: 'SUPPRESSED', message: 'הלקוח ברשימת הסירוב' }
  }

  // ---- Dedup ----
  if (matchId && !force) {
    const { data: m } = await sb.from('matches').select('renter_notified_at').eq('id', matchId).maybeSingle()
    if (m?.renter_notified_at) return { ok: false, code: 'ALREADY_NOTIFIED', message: 'כבר נשלחה התראה על התאמה זו' }
  }

  // ---- Template approval gate ----
  const { data: tpl } = await sb
    .from('whatsapp_templates')
    .select('status')
    .eq('name', TEMPLATE_NAME)
    .eq('language', TEMPLATE_LANG)
    .maybeSingle()
  if (!tpl) return { ok: false, code: 'TEMPLATE_MISSING', message: `תבנית ${TEMPLATE_NAME} חסרה במסד` }
  if (tpl.status !== 'approved') {
    return { ok: false, code: 'TEMPLATE_NOT_APPROVED', message: `תבנית ${TEMPLATE_NAME} עדיין בסטטוס ${tpl.status} ב-Meta` }
  }

  // ---- Share link for the button (renter-specific get-or-create) ----
  // A renter-linked token lets /share render this renter's personalized match
  // breakdown (score, what matches, what's missing) above the property details.
  const token = await ensureRenterShareToken(sb, orgId, propertyId, renterId, matchId)
  const shareUrl = `${appBaseUrl()}/share/${token}`

  // ---- Display labels (partial details only — no full street address) ----
  const firstName = (renter.first_name || '').trim() || 'שלום'
  const location = property.neighborhood
    ? `${property.city} · ${property.neighborhood}`
    : property.city
  const roomsLabel = Number(property.rooms) === 1 ? '1' : String(property.rooms).replace(/\.0$/, '')
  const priceLabel = Number(property.price).toLocaleString('en-US')

  // ---- Send template ----
  // (IMAGE header, 4 body params, 1 URL button param = the share token suffix.)
  const components = [
    { type: 'header', parameters: [{ type: 'image', image: { link: coverImage } }] },
    {
      type: 'body',
      parameters: [
        { type: 'text', text: firstName },
        { type: 'text', text: location },
        { type: 'text', text: roomsLabel },
        { type: 'text', text: priceLabel },
      ],
    },
    { type: 'button', sub_type: 'url', index: 0, parameters: [{ type: 'text', text: token }] },
  ]

  let sent
  try {
    sent = await sendTemplate({ to: phone, name: TEMPLATE_NAME, language: TEMPLATE_LANG, components: components as any })
  } catch (err) {
    return { ok: false, code: 'META_SEND_FAILED', message: err instanceof Error ? err.message : String(err) }
  }

  // ---- Record thread + message + dedupe stamp ----
  const thread = await upsertRenterThread(sb, orgId, phone, propertyId)

  await sb.from('messages').insert({
    org_id: orgId,
    thread_id: thread.id,
    property_id: propertyId,
    channel: 'whatsapp',
    direction: 'out',
    body: null,
    status: 'sent',
    external_id: sent.messageId,
    meta_message_type: 'template',
    template_name: TEMPLATE_NAME,
    template_params: {
      first_name: firstName,
      location,
      rooms: roomsLabel,
      price: priceLabel,
      renter_id: renterId,
      property_id: propertyId,
      share_token: token,
      cover_image_url: coverImage,
    },
  })

  const now = new Date().toISOString()
  await sb.from('threads').update({ last_outbound_at: now, last_message_at: now, property_id: propertyId }).eq('id', thread.id)

  const stamp = sb.from('matches').update({ renter_notified_at: now })
  if (matchId) {
    await stamp.eq('id', matchId)
  } else {
    await stamp.eq('org_id', orgId).eq('renter_id', renterId).eq('property_id', propertyId)
  }

  return { ok: true, messageId: sent.messageId, threadId: thread.id, phone, shareUrl }
}

/** Get this renter's share token for the property, or create one (no AI processing — cheap). */
async function ensureRenterShareToken(
  sb: ReturnType<typeof supabaseService>,
  orgId: string,
  propertyId: string,
  renterId: string,
  matchId?: string | undefined,
): Promise<string> {
  const { data: existing } = await sb
    .from('property_shares')
    .select('token')
    .eq('org_id', orgId)
    .eq('property_id', propertyId)
    .eq('renter_id', renterId)
    .maybeSingle()
  if (existing?.token) return existing.token

  const token = nanoid(12)
  const { data: created, error } = await sb
    .from('property_shares')
    .insert({ org_id: orgId, property_id: propertyId, token, renter_id: renterId, match_id: matchId ?? null, created_by: null, view_count: 0 })
    .select('token')
    .single()
  if (error) {
    // Lost a race — another insert created it; re-read.
    const { data: again } = await sb
      .from('property_shares')
      .select('token')
      .eq('org_id', orgId)
      .eq('property_id', propertyId)
      .eq('renter_id', renterId)
      .maybeSingle()
    if (again?.token) return again.token
    throw new Error(`ensureRenterShareToken failed: ${error.message}`)
  }
  return created!.token
}

/**
 * Upsert the renter's thread. Parked in `human_takeover` + tagged
 * `audience: 'renter'` so the landlord-outreach orchestrator skips it
 * (it only auto-replies to threads in active/awaiting_reply states).
 */
async function upsertRenterThread(
  sb: ReturnType<typeof supabaseService>,
  orgId: string,
  normalizedPhone: string,
  propertyId: string,
): Promise<{ id: string }> {
  const { data: existing } = await sb
    .from('threads')
    .select('id')
    .eq('org_id', orgId)
    .eq('phone', normalizedPhone)
    .maybeSingle()
  if (existing) return existing

  const { data: created } = await sb
    .from('threads')
    .insert({
      org_id: orgId,
      phone: normalizedPhone,
      channel: 'whatsapp',
      status: 'human_takeover',
      property_id: propertyId,
      tags: { audience: 'renter' },
    })
    .select('id')
    .single()
  return created!
}

/**
 * Single source of truth for dispatching the first-touch outreach template.
 *
 * Both `/api/v1/outreach/send-initial` (admin button) and
 * `/api/v1/outreach/batch-pending` (cron) call this — the validations and
 * side-effects must be identical regardless of trigger source.
 */

import { supabaseService } from '../supabase'
import { sendTemplate, normalizePhone } from '../whatsapp/meta-provider'
import { isSuppressed } from './suppression'
import {
  buildLandlordHookVariables,
  pickTemplateAndComponents,
  PersonalizationError,
  type TemplateChoice,
} from './personalization'
import { generateAndStorePersonalization } from '../ai/property-vision'

export type DispatchResult =
  | { ok: true; messageId: string; threadId: string; phone: string; templateName: string }
  | { ok: false; code: string; message: string }

const TEMPLATE_LANG = 'he'

export async function dispatchInitialOutreach(opts: {
  orgId: string
  propertyId: string
  /** Set true to bypass the `initial_message_sent` guard (e.g. admin force resend). */
  force?: boolean
  /** Which template to use: 'auto' (rich if hook), 'basic', 'rich', or 'auto_quality' (rich only if hook confidence is high enough — used by batch). */
  templateChoice?: TemplateChoice
  /** Live-generate the personal sentence for this property before sending (single/interactive sends). Off for batch. */
  ensurePersonalization?: boolean
}): Promise<DispatchResult> {
  const { orgId, propertyId, force } = opts
  const sb = supabaseService()

  const { data: property, error: propErr } = await sb
    .from('properties')
    .select('id, org_id, contact_phone, contact_name, initial_message_sent, outreach_blocked, images')
    .eq('id', propertyId)
    .eq('org_id', orgId)
    .maybeSingle()

  if (propErr) return { ok: false, code: 'DB_ERROR', message: propErr.message }
  if (!property) return { ok: false, code: 'NOT_FOUND', message: 'property not found in this org' }
  if (property.outreach_blocked) return { ok: false, code: 'BLOCKED', message: 'בעל הנכס ביקש שלא לקבל פניות' }
  if (property.initial_message_sent && !force) {
    return { ok: false, code: 'ALREADY_SENT', message: 'כבר נשלחה פנייה ראשונה' }
  }
  if (!property.contact_phone) return { ok: false, code: 'PHONE_MISSING', message: 'אין מספר טלפון' }

  // For interactive personalized sends, live-generate the personal sentence per property
  // (regenerates if missing or from an older prompt version). Batch skips this to stay
  // within the function timeout — it reuses what the preview already generated.
  if (opts.ensurePersonalization && (opts.templateChoice || 'auto') !== 'basic') {
    try { await generateAndStorePersonalization(propertyId) } catch { /* rich falls back to basic if none */ }
  }

  // Build personalization (throws PersonalizationError on bad data)
  let vars
  try {
    vars = await buildLandlordHookVariables(propertyId)
  } catch (err) {
    if (err instanceof PersonalizationError) {
      // Log the skip reason on the property so the cron doesn't keep retrying.
      await sb.from('properties').update({ outreach_skip_reason: err.reason }).eq('id', propertyId)
      return { ok: false, code: 'PERSONALIZATION', message: humanReasonForCode(err.reason) }
    }
    throw err
  }

  const normalized = normalizePhone(property.contact_phone)
  if (await isSuppressed(orgId, normalized)) {
    await sb.from('properties').update({ outreach_blocked: true, outreach_skip_reason: 'suppressed' }).eq('id', propertyId)
    return { ok: false, code: 'SUPPRESSED', message: 'הטלפון בעל הנכס ברשימת הסירוב' }
  }

  // Pick rich vs basic template — honoring an explicit choice / batch quality gate.
  const { templateName, components } = pickTemplateAndComponents(vars, opts.templateChoice || 'auto')

  // Verify the chosen template is approved at Meta.
  const { data: template } = await sb
    .from('whatsapp_templates')
    .select('name, status')
    .eq('name', templateName)
    .eq('language', TEMPLATE_LANG)
    .maybeSingle()
  if (!template) return { ok: false, code: 'TEMPLATE_MISSING', message: `תבנית ${templateName} חסרה במסד` }
  if (template.status !== 'approved') {
    return {
      ok: false,
      code: 'TEMPLATE_NOT_APPROVED',
      message: `תבנית ${templateName} עדיין בסטטוס ${template.status} ב-Meta.`,
    }
  }

  let sent
  try {
    sent = await sendTemplate({
      to: normalized,
      name: templateName,
      language: TEMPLATE_LANG,
      components: components as any,
    })
  } catch (err) {
    return { ok: false, code: 'META_SEND_FAILED', message: err instanceof Error ? err.message : String(err) }
  }

  // Upsert thread by (org_id, phone)
  const thread = await upsertThread(sb, orgId, normalized, property.id)

  // Insert outbound message row + flip property.initial_message_sent
  await sb.from('messages').insert({
    org_id: orgId,
    thread_id: thread.id,
    property_id: property.id,
    channel: 'whatsapp',
    direction: 'out',
    body: null,
    status: 'sent',
    external_id: sent.messageId,
    meta_message_type: 'template',
    template_name: templateName,
    template_params: {
      first_name: vars.first_name,
      rooms: vars.rooms_label,
      street_city: vars.street_city,
      personal_hook: vars.personal_hook,
      availability: vars.availability_label,
      cover_image_url: vars.cover_image_url,
    },
  })
  await sb.from('properties').update({ initial_message_sent: true, outreach_skip_reason: null }).eq('id', property.id)
  await sb.from('threads').update({
    last_outbound_at: new Date().toISOString(),
    last_message_at: new Date().toISOString(),
    property_id: property.id,
  }).eq('id', thread.id)

  return { ok: true, messageId: sent.messageId, threadId: thread.id, phone: normalized, templateName }
}

async function upsertThread(
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
      status: 'awaiting_reply',
      property_id: propertyId,
    })
    .select('id')
    .single()
  return created!
}

function humanReasonForCode(code: string): string {
  if (code.startsWith('name_invalid')) return 'השם של בעל הנכס לא תקין — בדוק ידנית'
  if (code === 'no_images') return 'אין תמונות לדירה — נדרשת לפחות תמונה אחת'
  if (code === 'phone_missing') return 'אין מספר טלפון'
  if (code === 'street_missing') return 'אין רחוב/כתובת'
  if (code === 'property_not_found') return 'הנכס לא נמצא'
  return 'נתון חסר'
}

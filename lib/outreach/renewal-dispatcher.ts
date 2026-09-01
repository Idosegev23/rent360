/**
 * Dispatcher for the renewal-outreach campaign — a landlord whose listing
 * came down roughly a year ago and never came back. This mirrors
 * `lib/outreach/dispatcher.ts` (`dispatchInitialOutreach`) in shape and
 * side-effect order: two dispatchers that diverge in ordering will drift
 * in behaviour, so any change here should be considered against that file
 * too.
 *
 * Two deliberate differences from the reference dispatcher, both load-bearing:
 *
 *  1. This module never touches `properties.initial_message_sent`. That flag
 *     means "we sent a first-touch about a *live listing*" and drives the
 *     landlord recruitment queue's filtering — stamping it here would
 *     silently corrupt that queue. Double-contact protection for renewal
 *     sends comes from `recipientMessageCounts` (lib/outreach/governance.ts),
 *     which already counts these sends because they go through the same
 *     `threads`/`messages` tables as everything else.
 *  2. `canSendNow()` is a hard gate INSIDE this dispatcher (the reference
 *     dispatcher leaves that to its callers), so no future caller of
 *     `dispatchRenewalOutreach` can accidentally bypass the send window.
 */

import { supabaseService } from '../supabase'
import { sendTemplate, normalizePhone } from '../whatsapp/meta-provider'
import { isSuppressed } from './suppression'
import { canSendNow } from '../time/send-window'
import { PersonalizationError } from './personalization'
import {
  buildRenewalVariables,
  pickRenewalTemplate,
  type RenewalSegment,
  type RenewalVars,
} from './renewal-templates'

export type RenewalDispatchResult =
  | { ok: true; messageId: string; threadId: string; phone: string; templateName: string }
  | { ok: false; code: string; message: string }

const TEMPLATE_LANG = 'he'

export async function dispatchRenewalOutreach(opts: {
  orgId: string
  leadId: string
  force?: boolean
}): Promise<RenewalDispatchResult> {
  const { orgId, leadId, force } = opts
  const sb = supabaseService()

  // --- Load lead (org-scoped) ------------------------------------------
  const { data: lead, error: leadErr } = await sb
    .from('renewal_leads')
    .select('id, org_id, property_id, segment, times_listed, status')
    .eq('id', leadId)
    .eq('org_id', orgId)
    .maybeSingle()

  if (leadErr) return { ok: false, code: 'DB_ERROR', message: leadErr.message }
  if (!lead) return { ok: false, code: 'NOT_FOUND', message: 'הליד לא נמצא' }
  if (lead.status === 'sent' && !force) {
    return { ok: false, code: 'ALREADY_SENT', message: 'כבר נשלחה פנייה עבור ליד זה' }
  }
  if (lead.status === 'skipped' && !force) {
    return { ok: false, code: 'SKIPPED', message: 'הליד סומן כלא רלוונטי לשליחה' }
  }

  // --- Load its property (org-scoped) -----------------------------------
  const { data: property, error: propErr } = await sb
    .from('properties')
    .select('id, org_id, contact_phone, outreach_blocked')
    .eq('id', lead.property_id)
    .eq('org_id', orgId)
    .maybeSingle()

  if (propErr) return { ok: false, code: 'DB_ERROR', message: propErr.message }
  if (!property) return { ok: false, code: 'NOT_FOUND', message: 'הנכס המשויך לליד לא נמצא' }

  if (property.outreach_blocked) {
    await stampLeadSkipped(sb, leadId, orgId, 'blocked')
    return { ok: false, code: 'BLOCKED', message: 'בעלי הנכס ביקשו שלא לפנות אליהם' }
  }

  const { data: approved, error: apErr } = await sb
    .from('approved_properties')
    .select('id')
    .eq('org_id', orgId)
    .eq('property_id', property.id)
    .maybeSingle()
  if (apErr) return { ok: false, code: 'DB_ERROR', message: apErr.message }
  if (approved) {
    await stampLeadSkipped(sb, leadId, orgId, 'approved_property')
    return { ok: false, code: 'APPROVED_PROPERTY', message: 'הנכס כבר מתווך דרכנו' }
  }

  if (!property.contact_phone) {
    return { ok: false, code: 'PHONE_MISSING', message: 'אין מספר טלפון לבעלי הנכס' }
  }

  // Hard send-window gate, checked inside the dispatcher itself (unlike the
  // reference dispatcher, which leaves this to its callers) so no future
  // caller of dispatchRenewalOutreach can bypass it. Transient — the lead
  // stays 'pending' and returns to the queue on the next attempt.
  const window = await canSendNow()
  if (!window.ok) {
    return { ok: false, code: 'SEND_WINDOW', message: 'מחוץ לשעות/לימי השליחה המותרים כרגע' }
  }

  const normalizedPhone = normalizePhone(property.contact_phone)
  if (await isSuppressed(orgId, normalizedPhone)) {
    await stampLeadSkipped(sb, leadId, orgId, 'suppressed')
    await sb.from('properties').update({ outreach_blocked: true }).eq('id', property.id)
    return { ok: false, code: 'SUPPRESSED', message: 'המספר נמצא ברשימת הסירוב' }
  }

  // Build personalization (throws PersonalizationError on bad data)
  let vars: RenewalVars
  try {
    vars = await buildRenewalVariables(property.id, lead.times_listed)
  } catch (err) {
    if (err instanceof PersonalizationError) {
      await stampLeadSkipped(sb, leadId, orgId, err.reason)
      return { ok: false, code: 'PERSONALIZATION', message: humanReasonForCode(err.reason) }
    }
    throw err
  }

  const segment = lead.segment as RenewalSegment
  const { templateName, components } = pickRenewalTemplate(segment, vars)

  // Verify the chosen template is approved at Meta before sending.
  const { data: template, error: templErr } = await sb
    .from('whatsapp_templates')
    .select('name, status')
    .eq('name', templateName)
    .eq('language', TEMPLATE_LANG)
    .maybeSingle()
  if (templErr) return { ok: false, code: 'DB_ERROR', message: templErr.message }
  if (!template) return { ok: false, code: 'TEMPLATE_MISSING', message: `תבנית ${templateName} חסרה במסד הנתונים` }
  if (template.status !== 'approved') {
    // Transient — the template may still get approved by Meta. Do NOT stamp
    // the lead; it must return to the queue on the next attempt.
    return {
      ok: false,
      code: 'TEMPLATE_NOT_APPROVED',
      message: `תבנית ${templateName} עדיין בסטטוס ${template.status} מול Meta`,
    }
  }

  let sent
  try {
    sent = await sendTemplate({
      to: normalizedPhone,
      name: templateName,
      language: TEMPLATE_LANG,
      components: components as any,
    })
  } catch (err) {
    // Transient — a Meta/network hiccup. Do NOT stamp the lead.
    return { ok: false, code: 'META_SEND_FAILED', message: err instanceof Error ? err.message : String(err) }
  }

  // --- Success: thread → message → lead, in that order -------------------
  const thread = await upsertThread(sb, orgId, normalizedPhone, property.id)

  const { data: msg } = await sb
    .from('messages')
    .insert({
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
        street_city: vars.street_city,
        times_listed: vars.times_listed,
      },
      metadata: { renewal_lead_id: leadId, segment: lead.segment },
    })
    .select('id')
    .single()

  await sb
    .from('threads')
    .update({
      last_outbound_at: new Date().toISOString(),
      last_message_at: new Date().toISOString(),
      property_id: property.id,
    })
    .eq('id', thread.id)

  await sb
    .from('renewal_leads')
    .update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      thread_id: thread.id,
      message_id: msg?.id ?? null,
    })
    .eq('id', leadId)
    .eq('org_id', orgId)

  return { ok: true, messageId: sent.messageId, threadId: thread.id, phone: normalizedPhone, templateName }
}

/** Mark a renewal lead permanently skipped (never for a transient failure). */
async function stampLeadSkipped(
  sb: ReturnType<typeof supabaseService>,
  leadId: string,
  orgId: string,
  reason: string,
): Promise<void> {
  await sb
    .from('renewal_leads')
    .update({ status: 'skipped', skip_reason: reason })
    .eq('id', leadId)
    .eq('org_id', orgId)
}

/**
 * Upsert-by-(org_id, phone) thread helper, copied from the reference
 * dispatcher's `upsertThread` (not exported there) rather than invented
 * as a variant — same shape, same behaviour.
 */
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
  if (code.startsWith('name_invalid')) return 'השם השמור לא תקין לשליחה — נדרשת בדיקה ידנית'
  if (code === 'phone_missing') return 'אין מספר טלפון'
  if (code === 'street_missing') return 'אין רחוב/כתובת'
  if (code === 'property_not_found') return 'הנכס לא נמצא'
  return 'נתון חסר לבניית ההודעה'
}
